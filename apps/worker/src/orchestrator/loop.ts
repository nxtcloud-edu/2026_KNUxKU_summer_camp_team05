import {
  executionCaps,
  type DispatchProposal,
  type LegalMove,
  type PlanningNodeId,
  type RoundId,
} from '@tm/contracts';
import {
  defaultRoundOrder as coreRoundOrder,
  validateProposal,
  type DispatchContext,
  type DispatchVerdict,
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
  /** 라운드 종료를 그래프에 기록하고 하위 노드에 STALE을 전파한다 */
  settleRound(roundId: RoundId): Promise<{ staled: PlanningNodeId[]; lockedDescendants: PlanningNodeId[] }>;
}

/**
 * TODO(orchestrator): LegalMove 산출을 Planning Graph 상태와 연결한다.
 * 지금은 다음에 실행할 라운드 하나만 만들어 파이프라인 형태를 고정한다.
 */
export function computeLegalMoves(state: RunState, allowed: RoundId[]): LegalMove[] {
  const pending = allowed.filter((round) => !state.completedRounds.includes(round));
  const next = pending[0];
  if (next === undefined) return [];

  const rerunUsed = state.rerunCountByRound[next] ?? 0;
  return [
    {
      moveId: `mv_${next}`,
      type: 'run_referee',
      target: { round: next },
      dependencies: { satisfied: state.completedRounds, missing: [] },
      guards: {
        roundRerunUsed: rerunUsed,
        roundRerunCap: executionCaps.rerunsPerRound,
        globalRecalcUsed: state.globalRecalcUsed,
        globalRecalcCap: executionCaps.globalRecalcs,
        turnsRemaining: state.turnsRemaining,
      },
      budget: { tokensRemaining: 0, usdRemaining: state.usdRemaining, toolCallsRemaining: {} },
      parallelGroup: null,
      estimated: { latencySec: 150, usd: 0.05 },
    },
  ];
}

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
    // TODO(orchestrator): Planning Graph를 붙이면 잠긴 노드·미검증 노드를
    // planning_nodes 테이블에서 읽는다. 지금은 실행 상태에 있는 것만 넘긴다.
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
  },
  state: RunState,
): Promise<RunState> {
  const allowed =
    payload.kind === 'full_run' ? [...defaultRoundOrder] : orderRerunRounds(payload.rerunRounds);
  const instruction = payload.kind === 'rerun_from_objection' ? payload.instruction : null;

  let current = state;
  for (;;) {
    // 잠긴 노드·미검증 노드는 DB의 Planning Graph에서 읽는다. RunState는 캐시일 뿐이다.
    if (ports.graph !== undefined) {
      const guards = await ports.graph.guards();
      current = {
        ...current,
        lockedNodes: guards.lockedNodes,
        unverifiedNodes: guards.unverifiedNodes,
      };
    }

    const moves = computeLegalMoves(current, allowed);
    if (moves.length === 0) break;

    const proposal = await ports.supervisor.propose(moves, current);
    let chosen = moves[0];

    if (proposal !== null) {
      const result = validateDispatch(proposal, moves, current);

      // V9 위반 노드는 BLOCKED로 넘긴다. 조용히 통과시키지 않는다.
      if (result.blockedNodes.length > 0) {
        current = {
          ...current,
          unverifiedNodes: [...new Set([...(current.unverifiedNodes ?? []), ...result.blockedNodes])],
        };
      }
      // V10 불일치는 프롬프트 회귀 추적 대상이다.
      for (const mismatch of result.reviewMismatch) {
        console.warn(`[orchestrator] REVIEW 판정 불일치 ${mismatch.roundId}: ${mismatch.detail}`);
      }

      if (result.accepted) {
        const target = moves.find((move) => move.moveId === proposal.sequence[0]?.moveId);
        if (target !== undefined) chosen = target;
      } else {
        current = { ...current, dispatchRejections: current.dispatchRejections + 1 };
        if (current.dispatchRejections >= 2) {
          current = { ...current, fallbackCount: current.fallbackCount + 1 };
        }
      }
    } else {
      current = { ...current, fallbackCount: current.fallbackCount + 1 };
    }

    const round = chosen?.target.round;
    if (round === undefined) break;

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
