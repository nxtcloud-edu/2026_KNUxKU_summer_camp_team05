import {
  executionCaps,
  type DispatchProposal,
  type LegalMove,
  type PlanningNodeId,
  type RoundId,
} from '@tm/contracts';
import {
  buildGraph,
  computeLegalMoves as computeGraphMoves,
  defaultRoundOrder as coreRoundOrder,
  emptyNode,
  nodeToRound,
  validateProposal,
  type DispatchContext,
  type DispatchVerdict,
  type Graph,
  type GraphNode,
  type MeterSnapshot,
} from '@tm/core';
import type { JobPayload } from '../queue.js';

/**
 * Orchestrator 루프 — 결정론. LLM을 호출하지 않는다.
 *
 * computeLegalMoves(코드) → Supervisor 제안(LLM) → validate(코드) → execute(코드)
 * Supervisor가 실패하거나 제안이 2회 거부되면 기본 위상 순서로 진행한다.
 * 근거: docs/agent-architecture.md 3장 · 4장
 */

/** 기본 위상 순서. 정의는 @tm/core에 있다 (agent-architecture.md 4.5) */
export const defaultRoundOrder: readonly RoundId[] = coreRoundOrder;

export interface RunState {
  runId: string;
  roomId: string;
  completedRounds: RoundId[];
  rerunCountByRound: Partial<Record<RoundId, number>>;
  globalRecalcUsed: number;
  turnsRemaining: number;
  usdRemaining: number;
  /** Supervisor 제안이 거부된 누적 횟수 */
  dispatchRejections: number;
  fallbackCount: number;
  /** 예약 완료·수동 확정 노드. 제안으로 변경할 수 없다 (V4) */
  lockedNodes?: PlanningNodeId[];
  /** fail-closed 검증을 통과하지 못한 노드. 승격할 수 없다 (V9) */
  unverifiedNodes?: PlanningNodeId[];
  /** 승인 대기 중인 노드. 자동 실행 대신 승인 요청으로만 진행한다 (V8) */
  pendingApprovalNodes?: PlanningNodeId[];
  /** 예산·턴 소진으로 축약 모드에 들어갔는가 (V6) */
  reducedMode?: boolean;
  /** run이 중간에 멈춘 이유. 조용히 끝내지 않는다 */
  stopReason?: string | null;
}

export interface SupervisorPort {
  /** 합법 수 집합 안에서 순서를 고른다. 실패하면 null을 반환해도 된다 */
  propose(moves: LegalMove[], state: RunState): Promise<DispatchProposal | null>;
}

export interface RefereePort {
  run(roundId: RoundId, instruction: string | null): Promise<void>;
}

export interface GraphPort {
  /** 현재 잠긴 노드·미검증 노드. V4·V9의 입력이며 DB가 원본이다 */
  guards(): Promise<{ lockedNodes: PlanningNodeId[]; unverifiedNodes: PlanningNodeId[] }>;
  /** 합법 수 산출의 재료. Planning Graph 자체를 읽는다 */
  load(): Promise<Graph>;
  /** 라운드 종료를 그래프에 기록하고 하위 노드에 STALE을 전파한다 */
  settleRound(roundId: RoundId): Promise<{ staled: PlanningNodeId[]; lockedDescendants: PlanningNodeId[] }>;
}

/** 원가·턴 잔량. 상한 집행은 코드가 한다 (INV-1) */
export interface MeterPort {
  snapshot(): MeterSnapshot;
}

/** 디스패치 결정 1건. `dispatch_decisions`에 그대로 들어간다 */
export interface DispatchRecord {
  seq: number;
  legalMoves: LegalMove[];
  proposal: DispatchProposal | null;
  validationResult: DispatchVerdict | null;
  rejectedRules: string[];
  fallbackUsed: boolean;
  decidedBy: 'supervisor' | 'default';
}

/**
 * 그래프가 없을 때의 대체 그래프.
 *
 * DB 없이 파이프라인 형태만 확인하는 경로다. 완료된 라운드의 노드를 VERIFIED로 채워
 * "다음에 열리는 라운드"가 그래프 규칙과 같은 방식으로 계산되게 한다.
 * 실제 실행에서는 항상 `GraphPort.load()`가 원본이다.
 */
function syntheticGraph(completedRounds: readonly RoundId[]): Graph {
  const done = new Set(completedRounds);
  const nodes: GraphNode[] = [];

  for (const [nodeId, round] of Object.entries(nodeToRound)) {
    if (round === undefined || !done.has(round)) continue;
    nodes.push({
      ...emptyNode(nodeId as PlanningNodeId),
      version: 1,
      status: 'VERIFIED',
      confidence: 'unknown',
    });
  }
  return buildGraph(nodes);
}

/**
 * 합법 수 산출. Planning Graph의 `readyNodes`를 재료로 삼는다 (@tm/core).
 *
 * 워커는 상태를 모아 넘기는 역할만 한다. 무엇이 합법인지의 판단은 코어에 있다.
 */
export function computeLegalMoves(
  state: RunState,
  allowed: RoundId[],
  graph: Graph = syntheticGraph(state.completedRounds),
): LegalMove[] {
  return moveSet(state, allowed, graph).moves;
}

function moveSet(
  state: RunState,
  allowed: RoundId[],
  graph: Graph = syntheticGraph(state.completedRounds),
): ReturnType<typeof computeGraphMoves> {
  return computeGraphMoves({
    graph,
    allowedRounds: allowed,
    completedRounds: state.completedRounds,
    rerunCountByRound: state.rerunCountByRound,
    globalRecalcUsed: state.globalRecalcUsed,
    turnsRemaining: state.turnsRemaining,
    usdRemaining: state.usdRemaining,
    ...(state.pendingApprovalNodes === undefined
      ? {}
      : { pendingApprovalNodes: state.pendingApprovalNodes }),
  });
}

/** 실행 가능한 라운드가 없는 종료 수 */
const TERMINAL_MOVES = new Set(['finalize_plan', 'block_run']);

/**
 * 디스패치 검증은 @tm/core가 한다 (V1~V10 전부 구현되어 있다).
 * 워커는 실행 상태를 컨텍스트로 넘기는 역할만 한다.
 */
export function validateDispatch(
  proposal: DispatchProposal,
  moves: LegalMove[],
  state: RunState,
): DispatchVerdict {
  const context: DispatchContext = {
    moves,
    // 잠긴 노드·미검증 노드는 GraphPort가 planning_nodes에서 읽어 RunState에 채운다.
    lockedNodes: state.lockedNodes,
    unverifiedNodes: state.unverifiedNodes,
    pendingRounds: defaultRoundOrder.filter((round) => !state.completedRounds.includes(round)),
    completedRounds: state.completedRounds,
    budgetExhausted: state.usdRemaining <= 0,
  };
  return validateProposal(proposal, context);
}

/**
 * 한 run을 끝까지 진행한다. 이의 재실행이면 대상 라운드만 다시 돈다.
 */
export async function runPipeline(
  payload: JobPayload,
  ports: {
    supervisor: SupervisorPort;
    referee: RefereePort;
    /** 라운드가 끝날 때마다 Planning Graph를 갱신한다. 없으면 그래프 없이 진행한다 */
    graph?: GraphPort;
    /** 원가·턴 잔량. 없으면 RunState의 값을 그대로 쓴다 */
    meter?: MeterPort;
    /** 디스패치 결정 기록. 폴백률 추적의 원본이다 (12.2) */
    recordDispatch?: (record: DispatchRecord) => Promise<void>;
    /** 라운드 시작 전 프리페치. 실패해도 라운드를 막지 않는다 */
    prefetch?: (roundId: RoundId) => Promise<void>;
    /** finalize_plan에 도달했을 때 계획서를 발행한다 */
    finalize?: () => Promise<void>;
  },
  state: RunState,
): Promise<RunState> {
  const allowed =
    payload.kind === 'full_run' ? [...defaultRoundOrder] : orderRerunRounds(payload.rerunRounds);
  const instruction = payload.kind === 'rerun_from_objection' ? payload.instruction : null;

  let current = { ...state, stopReason: state.stopReason ?? null };
  let dispatchSeq = 0;

  for (;;) {
    // 예산·턴은 코드가 집행한다. Supervisor가 "조금만 더"라고 해도 여기서 멈춘다.
    if (ports.meter !== undefined) {
      const snapshot = ports.meter.snapshot();
      current = {
        ...current,
        usdRemaining: snapshot.usdRemaining,
        turnsRemaining: snapshot.turnsRemaining,
        reducedMode: snapshot.mode !== 'normal',
      };
      if (snapshot.mode === 'exhausted') {
        current = {
          ...current,
          stopReason: `원가·턴 상한 소진 ($${snapshot.usdSpent.toFixed(4)} / $${snapshot.usdCap.toFixed(2)}, 턴 ${snapshot.turnsUsed}/${snapshot.turnsCap})`,
        };
        break;
      }
    }

    // 잠긴 노드·미검증 노드는 DB의 Planning Graph에서 읽는다. RunState는 캐시일 뿐이다.
    let graph: Graph | undefined;
    if (ports.graph !== undefined) {
      const guards = await ports.graph.guards();
      graph = await ports.graph.load();
      current = {
        ...current,
        lockedNodes: guards.lockedNodes,
        unverifiedNodes: guards.unverifiedNodes,
      };
    }

    const { moves, pendingRounds } = moveSet(current, allowed, graph);
    if (moves.length === 0) break;

    const proposal = await ports.supervisor.propose(moves, current);
    let chosen = moves[0];
    let verdict: DispatchVerdict | null = null;
    let decidedBy: 'supervisor' | 'default' = 'default';

    if (proposal !== null) {
      verdict = validateDispatch(proposal, moves, current);

      // V9 위반 노드는 BLOCKED로 넘긴다. 조용히 통과시키지 않는다.
      if (verdict.blockedNodes.length > 0) {
        current = {
          ...current,
          unverifiedNodes: [...new Set([...(current.unverifiedNodes ?? []), ...verdict.blockedNodes])],
        };
      }
      // V6 강등은 거부가 아니다. 축약 모드로 계속 간다.
      if (verdict.degradeToReduced) current = { ...current, reducedMode: true };
      // V10 불일치는 프롬프트 회귀 추적 대상이다.
      for (const mismatch of verdict.reviewMismatch) {
        console.warn(`[orchestrator] REVIEW 판정 불일치 ${mismatch.roundId}: ${mismatch.detail}`);
      }

      if (verdict.accepted) {
        const target = moves.find((move) => move.moveId === proposal.sequence[0]?.moveId);
        if (target !== undefined) {
          chosen = target;
          decidedBy = 'supervisor';
        }
      } else {
        current = { ...current, dispatchRejections: current.dispatchRejections + 1 };
        if (current.dispatchRejections >= 2) {
          current = { ...current, fallbackCount: current.fallbackCount + 1 };
        }
      }
    } else {
      current = { ...current, fallbackCount: current.fallbackCount + 1 };
    }

    dispatchSeq += 1;
    if (ports.recordDispatch !== undefined) {
      await ports.recordDispatch({
        seq: dispatchSeq,
        legalMoves: moves,
        proposal,
        validationResult: verdict,
        rejectedRules: [...new Set((verdict?.violations ?? []).map((violation) => violation.rule))],
        fallbackUsed: decidedBy === 'default',
        decidedBy,
      });
    }

    // 실행할 라운드가 없다는 뜻이다. finalize/block은 라운드 루프의 종료 조건이다.
    let fallbackRound: RoundId | undefined;
    if (chosen !== undefined && TERMINAL_MOVES.has(chosen.type)) {
      const unverified = current.unverifiedNodes ?? [];

      if (chosen.type === 'block_run' && unverified.length === 0 && pendingRounds.length > 0) {
        // 그래프가 라운드를 열지 못했지만 막는 노드도 없다. 심판이 노드를 VERIFIED로
        // 올리지 않는 단계(플레이스홀더)에서 정상적으로 생기는 상황이다.
        // Supervisor 실패와 같은 방식으로 기본 위상 순서로 진행하고, 그 사실을 남긴다 (4.4).
        fallbackRound = pendingRounds[0];
        current = { ...current, fallbackCount: current.fallbackCount + 1 };
        console.warn(
          `[orchestrator] 그래프가 실행 가능한 라운드를 내지 못했습니다 — 기본 위상 순서로 ${fallbackRound}를 진행합니다`,
        );
      } else {
        // 계획서 발행은 라운드가 아니라 종료 수다. 여기서 한 번만 부른다.
        if (chosen.type === 'finalize_plan' && ports.finalize !== undefined) {
          await ports.finalize();
        }
        // 남은 라운드가 없으면 정상 종료다. 사유를 남기면 정상 완료가 이상 종료로 보인다.
        const stoppedWithWorkLeft = chosen.type === 'block_run' && pendingRounds.length > 0;
        current = {
          ...current,
          stopReason: stoppedWithWorkLeft
            ? unverified.length > 0
              ? `미검증 노드가 남아 진행할 수 없습니다: ${unverified.join(', ')}`
              : `실행하지 못한 라운드가 남았습니다: ${pendingRounds.join(', ')}`
            : (current.stopReason ?? null),
        };
        break;
      }
    }

    const round = fallbackRound ?? chosen?.target.round;
    if (round === undefined) break;

    // 후보를 미리 받아 둔다. 실패는 로그로 남고 라운드는 그대로 진행한다.
    if (ports.prefetch !== undefined) await ports.prefetch(round);

    await ports.referee.run(round, instruction);

    if (ports.graph !== undefined) {
      const settled = await ports.graph.settleRound(round);
      // 잠겨서 STALE로 못 내린 하위 노드는 조용히 두지 않는다. 승인 요청 대상이다.
      if (settled.lockedDescendants.length > 0) {
        console.warn(
          `[orchestrator] ${round} 변경이 예약 완료 노드에 영향: ${settled.lockedDescendants.join(', ')} — 승인 필요`,
        );
      }
    }

    current = { ...current, completedRounds: [...current.completedRounds, round] };
  }

  return current;
}

/** 재실행 라운드를 의존성 순서대로 정렬한다. defaultRoundOrder가 이미 위상 순서다. */
function orderRerunRounds(rounds: RoundId[]): RoundId[] {
  return defaultRoundOrder.filter((round) => rounds.includes(round));
}
