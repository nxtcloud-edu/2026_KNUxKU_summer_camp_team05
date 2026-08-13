import {
  nodeDependencies,
  planningNodeIds,
  type Confidence,
  type NodeStatus,
  type PlanningNodeId,
  type RoundId,
} from '@tm/contracts';
import { descendantsOf, topologicalOrder } from './planning-graph.js';
import { nodeToRound } from './round-map.js';

/**
 * Planning Graph 상태 연산 — 노드 버전, STALE 전파, 실행 가능 노드 판정.
 *
 * `planning-graph.ts`가 의존성 그래프의 순수 계산이라면, 여기는 **실제 노드 레코드**를
 * 다룬다. 노드는 삭제되지 않는다. 상위가 바뀌면 하위는 STALE로 전환되고 버전이 오른다.
 *
 * 잠긴 노드(BOOKED·수동 확정)는 자동으로 STALE이 되지 않는다. 이미 예약한 것을
 * 조용히 무효화하면 사용자는 취소 수수료를 나중에 발견한다 (INV-5).
 *
 * 근거: travel-mediation-plan.md 19.3 · agent-architecture.md 5.1 / 5.2
 */

export interface GraphNode {
  nodeId: PlanningNodeId;
  version: number;
  status: NodeStatus;
  confidence: Confidence;
  inputHash: string;
  /** 이 노드를 계산할 때 쓴 상위 노드들의 버전. 상위가 올라가면 이 노드는 낡았다 */
  dependencyVersions: Record<string, number>;
  locked: boolean;
  evidenceRefs: string[];
}

export type Graph = Map<PlanningNodeId, GraphNode>;

/** 판결이 끝나 하위 노드가 의존해도 되는 상태 */
const SETTLED: ReadonlySet<NodeStatus> = new Set<NodeStatus>(['VERIFIED', 'BOOKABLE', 'BOOKED']);

/** 다시 계산해야 하는 상태 */
const NEEDS_WORK: ReadonlySet<NodeStatus> = new Set<NodeStatus>(['PROVISIONAL', 'STALE', 'FAILED']);

export function buildGraph(nodes: readonly GraphNode[]): Graph {
  return new Map(nodes.map((node) => [node.nodeId, node]));
}

export function emptyNode(nodeId: PlanningNodeId): GraphNode {
  return {
    nodeId,
    version: 0,
    status: 'PROVISIONAL',
    confidence: 'unknown',
    inputHash: '',
    dependencyVersions: {},
    locked: false,
    evidenceRefs: [],
  };
}

/** 그래프에 없는 노드는 아직 계산되지 않은 것으로 본다 */
export function nodeOf(graph: Graph, nodeId: PlanningNodeId): GraphNode {
  return graph.get(nodeId) ?? emptyNode(nodeId);
}

export interface NodeUpdate {
  nodeId: PlanningNodeId;
  status: NodeStatus;
  confidence?: Confidence;
  inputHash?: string;
  evidenceRefs?: readonly string[];
  locked?: boolean;
}

export interface GraphChange {
  /** 새 버전이 기록될 노드들 (변경 노드 + STALE로 내려간 하위 노드) */
  updated: GraphNode[];
  /** STALE로 전환된 노드 */
  staled: PlanningNodeId[];
  /**
   * 잠겨 있어 STALE로 내리지 않은 하위 노드.
   * 조용히 두면 안 되고 취소 비용·영향 범위를 담은 승인 요청을 올려야 한다.
   */
  lockedDescendants: PlanningNodeId[];
}

/**
 * 노드 하나를 갱신하고 하위 노드에 STALE을 전파한다.
 * 변경 노드의 버전이 오르고, 하위 노드는 삭제되지 않고 STALE + 버전 상승으로 남는다.
 */
export function applyNodeUpdate(graph: Graph, update: NodeUpdate): GraphChange {
  const current = nodeOf(graph, update.nodeId);

  if (current.locked && update.status !== current.status) {
    // 잠긴 노드 자체를 바꾸려는 시도는 여기서 막지 않고 호출자(V4)가 막는다.
    // 여기서는 사실만 반영한다.
  }

  const next: GraphNode = {
    ...current,
    version: current.version + 1,
    status: update.status,
    confidence: update.confidence ?? current.confidence,
    inputHash: update.inputHash ?? current.inputHash,
    evidenceRefs: [...(update.evidenceRefs ?? current.evidenceRefs)],
    locked: update.locked ?? current.locked,
    dependencyVersions: Object.fromEntries(
      nodeDependencies[update.nodeId].map((dep) => [dep, nodeOf(graph, dep).version]),
    ),
  };

  const updated: GraphNode[] = [next];
  const staled: PlanningNodeId[] = [];
  const lockedDescendants: PlanningNodeId[] = [];

  for (const nodeId of descendantsOf([update.nodeId])) {
    const descendant = nodeOf(graph, nodeId);
    if (descendant.version === 0) continue; // 아직 계산된 적 없으면 낡을 것도 없다

    if (descendant.locked || descendant.status === 'BOOKED') {
      lockedDescendants.push(nodeId);
      continue;
    }
    if (descendant.status === 'STALE') continue; // 이미 낡았다

    staled.push(nodeId);
    updated.push({
      ...descendant,
      version: descendant.version + 1,
      status: 'STALE',
    });
  }

  return { updated, staled, lockedDescendants };
}

/** 그래프에 변경분을 적용한 새 그래프를 만든다 (원본은 건드리지 않는다) */
export function withChange(graph: Graph, change: GraphChange): Graph {
  const next = new Map(graph);
  for (const node of change.updated) next.set(node.nodeId, node);
  return next;
}

/** 의존성이 모두 판결 완료라 지금 계산할 수 있는 노드 */
export function readyNodes(graph: Graph): PlanningNodeId[] {
  const ready = planningNodeIds.filter((nodeId) => {
    const node = nodeOf(graph, nodeId);
    if (!NEEDS_WORK.has(node.status)) return false;
    if (node.locked) return false;
    return nodeDependencies[nodeId].every((dep) => SETTLED.has(nodeOf(graph, dep).status));
  });
  return topologicalOrder(ready);
}

/** 상위 버전이 올라가 낡은 노드. 재계산 대상이다 */
export function staleNodes(graph: Graph): PlanningNodeId[] {
  return planningNodeIds.filter((nodeId) => nodeOf(graph, nodeId).status === 'STALE');
}

/** V4 입력. 제안으로 변경할 수 없는 노드 */
export function lockedNodesOf(graph: Graph): PlanningNodeId[] {
  return planningNodeIds.filter((nodeId) => {
    const node = nodeOf(graph, nodeId);
    return node.locked || node.status === 'BOOKED';
  });
}

/**
 * V9 입력. fail-closed 검증을 통과하지 못한 노드.
 * BLOCKED이거나 FAILED인 노드는 승격할 수 없고 finalize를 막는다.
 */
export function unverifiedNodesOf(graph: Graph): PlanningNodeId[] {
  return planningNodeIds.filter((nodeId) => {
    const status = nodeOf(graph, nodeId).status;
    return status === 'BLOCKED' || status === 'FAILED';
  });
}

/** 아직 판결이 남지 않은 라운드. V7 입력 */
export function pendingRoundsOf(graph: Graph, allRounds: readonly RoundId[]): RoundId[] {
  const settledRounds = new Set<RoundId>();
  for (const nodeId of planningNodeIds) {
    const node = nodeOf(graph, nodeId);
    if (!SETTLED.has(node.status)) continue;
    const round = nodeToRound[nodeId];
    if (round !== undefined) settledRounds.add(round);
  }
  return allRounds.filter((round) => !settledRounds.has(round));
}

/** 그래프가 finalize 가능한가 — 미검증 노드가 없고 계산할 노드도 남지 않았는가 */
export function canFinalize(graph: Graph): { ok: boolean; reason: string | null } {
  const unverified = unverifiedNodesOf(graph);
  if (unverified.length > 0) {
    return { ok: false, reason: `미검증 노드: ${unverified.join(', ')}` };
  }
  const stale = staleNodes(graph);
  if (stale.length > 0) {
    return { ok: false, reason: `재계산이 필요한 노드: ${stale.join(', ')}` };
  }
  return { ok: true, reason: null };
}
