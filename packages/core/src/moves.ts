import {
  executionCaps,
  nodeDependencies,
  planningNodeIds,
  type LegalMove,
  type PlanningNodeId,
  type RoundId,
} from '@tm/contracts';
import { canFinalize, nodeOf, readyNodes, type Graph } from './graph.js';
import { descendantsOf } from './planning-graph.js';
import { nodeToRound } from './round-map.js';
import { defaultRoundOrder } from './dispatch.js';

/**
 * LegalMove 산출 — 디스패치 프로토콜 1단계 (agent-architecture.md 4.1).
 *
 * 이전 구현은 "다음 라운드 하나"만 만들었다. 그러면 Supervisor에게 선택지가 없고,
 * 병렬 가능한 라운드가 있어도 항상 직렬로 돈다. 여기서는 Planning Graph의
 * `readyNodes`를 재료로 삼아 **지금 실행 가능한 라운드 전부**를 만들고,
 * 서로 의존하지 않는 것들을 같은 `parallelGroup`으로 묶는다.
 *
 * 합법 수 집합을 만드는 것은 코드다. Supervisor는 이 안에서 순서만 고른다 (INV-1).
 */

export interface MoveContext {
  graph: Graph;
  /** 이번 run에서 실행이 허용된 라운드. 이의 재실행이면 대상 라운드만 들어온다 */
  allowedRounds: readonly RoundId[];
  /** 이번 run에서 이미 끝낸 라운드 */
  completedRounds: readonly RoundId[];
  rerunCountByRound?: Partial<Record<RoundId, number>>;
  globalRecalcUsed?: number;
  turnsRemaining: number;
  usdRemaining: number;
  tokensRemaining?: number;
  toolCallsRemaining?: Record<string, number>;
  /**
   * 승인 대기 중인 노드. 예약 완료 노드에 영향이 가 승인을 기다리는 동안
   * 그 노드를 건드리는 수를 만들지 않는다 (INV-5 · V8).
   */
  pendingApprovalNodes?: readonly PlanningNodeId[];
  /** 라운드별 예상 비용·지연. 실측 전 기본값을 쓴다 */
  estimate?: (roundId: RoundId) => { latencySec: number; usd: number };
}

/** 실측 전 기본 추정. llm-runtime-config.md 3.3의 상한 계산과 같은 자리 */
const DEFAULT_ESTIMATE = { latencySec: 150, usd: 0.05 };

/** 한 라운드가 산출하는 노드 전부 */
function nodesOfRound(roundId: RoundId): PlanningNodeId[] {
  return planningNodeIds.filter((nodeId) => nodeToRound[nodeId] === roundId);
}

/**
 * 두 노드 집합 사이에 의존 관계가 있으면 병렬로 돌릴 수 없다.
 *
 * 비교 대상은 라운드의 **전체 노드**가 아니라 지금 계산할 노드(readyNodes)다.
 * 이미 확정된 노드까지 넣으면 거의 모든 라운드가 서로 의존하는 것으로 나와
 * 병렬 판정이 무의미해진다. 대신 심판은 이 라운드에서 ready 노드만 계산해야 한다 —
 * 확정된 상위 노드를 함께 갈아엎으면 병렬 전제가 깨진다.
 */
function dependent(a: readonly PlanningNodeId[], b: readonly PlanningNodeId[]): boolean {
  const aDescendants = new Set(descendantsOf(a));
  const bDescendants = new Set(descendantsOf(b));
  return b.some((nodeId) => aDescendants.has(nodeId)) || a.some((nodeId) => bDescendants.has(nodeId));
}

/**
 * 서로 의존하지 않는 라운드끼리 묶는다.
 * 그리디로 충분하다 — 라운드가 8개뿐이고, 잘못 묶으면 V3가 직렬화로 강등한다.
 */
function groupParallel(
  rounds: readonly RoundId[],
  readyByRound: Map<RoundId, PlanningNodeId[]>,
): Map<RoundId, string> {
  const groups: RoundId[][] = [];

  for (const round of rounds) {
    const nodes = readyByRound.get(round) ?? [];
    const target = groups.find((group) =>
      group.every((member) => !dependent(readyByRound.get(member) ?? [], nodes)),
    );
    if (target === undefined) groups.push([round]);
    else target.push(round);
  }

  const assignment = new Map<RoundId, string>();
  for (const [index, group] of groups.entries()) {
    for (const round of group) assignment.set(round, `pg_${index + 1}`);
  }
  return assignment;
}

/** 이 라운드가 이전에 판결을 낸 적이 있는가 (버전이 오른 노드가 있는가) */
function wasSettledBefore(graph: Graph, roundId: RoundId): boolean {
  return nodesOfRound(roundId).some((nodeId) => nodeOf(graph, nodeId).version > 0);
}

export interface LegalMoveSet {
  moves: LegalMove[];
  /** 아직 판결이 남지 않은 라운드. V7 입력이며 finalize 가능 여부를 가른다 */
  pendingRounds: RoundId[];
  /** 지금 실행할 수 있는 노드 (진단용) */
  readyNodes: PlanningNodeId[];
}

/**
 * 지금 둘 수 있는 수를 전부 만든다.
 *
 * 실행할 라운드가 없으면 `finalize_plan`(검증 통과) 또는 `block_run`(미검증 노드 잔존)을
 * 낸다. 빈 집합을 돌려주면 Supervisor는 아무것도 고를 수 없고 run이 조용히 멈춘다 —
 * 침묵 금지 원칙에 어긋난다 (11장).
 */
export function computeLegalMoves(context: MoveContext): LegalMoveSet {
  const ready = readyNodes(context.graph);
  const completed = new Set(context.completedRounds);
  const allowed = new Set(context.allowedRounds);
  const blockedByApproval = new Set(context.pendingApprovalNodes ?? []);
  const estimate = context.estimate ?? (() => DEFAULT_ESTIMATE);

  // readyNodes는 위상 순서다. 라운드 순서도 그대로 따른다.
  const candidateRounds: RoundId[] = [];
  const readyByRound = new Map<RoundId, PlanningNodeId[]>();
  for (const nodeId of ready) {
    if (blockedByApproval.has(nodeId)) continue;
    const round = nodeToRound[nodeId];
    if (round === undefined) continue;
    if (!allowed.has(round) || completed.has(round)) continue;
    if (!candidateRounds.includes(round)) candidateRounds.push(round);
    readyByRound.set(round, [...(readyByRound.get(round) ?? []), nodeId]);
  }

  const pendingRounds = defaultRoundOrder.filter(
    (round) => allowed.has(round) && !completed.has(round),
  );

  const parallelGroups = groupParallel(candidateRounds, readyByRound);
  const globalRecalcUsed = context.globalRecalcUsed ?? 0;

  const moves: LegalMove[] = candidateRounds.map((round) => {
    const rerunUsed = context.rerunCountByRound?.[round] ?? 0;
    const rerun = wasSettledBefore(context.graph, round);
    const nodes = readyByRound.get(round) ?? nodesOfRound(round);
    const satisfied = [
      ...new Set(nodes.flatMap((nodeId) => [...nodeDependencies[nodeId]])),
    ].filter((dep) => !nodes.includes(dep));

    return {
      moveId: `mv_${round}`,
      type: rerun ? 'rerun_round' : 'run_referee',
      target: { round, ...(nodes[0] === undefined ? {} : { nodeId: nodes[0] }) },
      dependencies: { satisfied, missing: [] },
      guards: {
        roundRerunUsed: rerunUsed,
        roundRerunCap: executionCaps.rerunsPerRound,
        globalRecalcUsed,
        globalRecalcCap: executionCaps.globalRecalcs,
        turnsRemaining: Math.max(0, context.turnsRemaining),
      },
      budget: {
        tokensRemaining: Math.max(0, context.tokensRemaining ?? 0),
        usdRemaining: Math.max(0, context.usdRemaining),
        toolCallsRemaining: context.toolCallsRemaining ?? {},
      },
      // 혼자면 병렬 그룹이 의미 없다. null이면 V3가 직렬로 다룬다.
      parallelGroup: candidateRounds.length > 1 ? (parallelGroups.get(round) ?? null) : null,
      estimated: estimate(round),
    };
  });

  // 승인 대기 노드는 자동 실행 대신 승인 요청으로만 진행할 수 있다 (V8).
  for (const nodeId of blockedByApproval) {
    moves.push({
      moveId: `mv_approval_${nodeId}`,
      type: 'raise_approval',
      target: { nodeId },
      dependencies: { satisfied: [], missing: [] },
      guards: {
        roundRerunUsed: 0,
        roundRerunCap: executionCaps.rerunsPerRound,
        globalRecalcUsed,
        globalRecalcCap: executionCaps.globalRecalcs,
        turnsRemaining: Math.max(0, context.turnsRemaining),
      },
      budget: {
        tokensRemaining: Math.max(0, context.tokensRemaining ?? 0),
        usdRemaining: Math.max(0, context.usdRemaining),
        toolCallsRemaining: {},
      },
      parallelGroup: null,
      estimated: { latencySec: 0, usd: 0 },
    });
  }

  if (moves.length === 0) {
    const finalizable = canFinalize(context.graph);
    const terminal: LegalMove = {
      moveId: finalizable.ok && pendingRounds.length === 0 ? 'mv_finalize' : 'mv_block',
      type: finalizable.ok && pendingRounds.length === 0 ? 'finalize_plan' : 'block_run',
      target: { nodeId: finalizable.ok ? 'document' : 'validation' },
      dependencies: { satisfied: [], missing: pendingRounds },
      guards: {
        roundRerunUsed: 0,
        roundRerunCap: executionCaps.rerunsPerRound,
        globalRecalcUsed,
        globalRecalcCap: executionCaps.globalRecalcs,
        turnsRemaining: Math.max(0, context.turnsRemaining),
      },
      budget: {
        tokensRemaining: Math.max(0, context.tokensRemaining ?? 0),
        usdRemaining: Math.max(0, context.usdRemaining),
        toolCallsRemaining: {},
      },
      parallelGroup: null,
      estimated: { latencySec: 30, usd: 0.01 },
    };
    moves.push(terminal);
  }

  return { moves, pendingRounds, readyNodes: ready };
}
