import { categoryToNode, nodeToRound } from '@tm/core';
import {
  applyNodeUpdate,
  buildGraph,
  lockedNodesOf,
  unverifiedNodesOf,
  withChange,
  type Graph,
  type GraphNode,
  type NodeUpdate,
} from '@tm/core';
import type { PlanningNodeId, RefereeCategory, RoundId } from '@tm/contracts';
import type { Repositories } from '@tm/db';

/**
 * Planning Graph를 DB에 붙인다.
 *
 * 그래프를 RunState에만 들고 있으면 run이 끝날 때 사라진다. 그러면 V4(잠긴 노드)와
 * V9(미검증 노드)가 한 run 안에서만 작동하고, 이의로 재실행할 때는 이전 run이 무엇을
 * 예약했고 무엇이 검증에 실패했는지 알 수 없다.
 *
 * 근거: agent-architecture.md 5장 · 12.1 planning_nodes
 */

export async function loadGraph(repos: Repositories, runId: string): Promise<Graph> {
  const rows = await repos.planningNodes.listLatest(runId);
  return buildGraph(
    rows.map(
      (row): GraphNode => ({
        nodeId: row.nodeId,
        version: row.version,
        status: row.status,
        confidence: row.confidence,
        inputHash: row.inputHash,
        dependencyVersions: row.dependencyVersions,
        locked: row.locked,
        evidenceRefs: row.evidenceRefs,
      }),
    ),
  );
}

export interface RecordResult {
  graph: Graph;
  staled: PlanningNodeId[];
  /** 잠겨 있어 STALE로 내리지 못한 하위 노드. 승인 요청 대상이다 */
  lockedDescendants: PlanningNodeId[];
}

/**
 * 노드 갱신을 그래프에 반영하고 DB에 새 버전을 남긴다.
 * 하위 노드는 삭제하지 않고 STALE + 버전 상승으로 기록한다.
 */
export async function recordNodeUpdate(
  repos: Repositories,
  runId: string,
  graph: Graph,
  update: NodeUpdate,
): Promise<RecordResult> {
  const change = applyNodeUpdate(graph, update);

  await repos.planningNodes.appendVersions(
    runId,
    change.updated.map((node) => ({
      nodeId: node.nodeId,
      version: node.version,
      status: node.status,
      confidence: node.confidence,
      inputHash: node.inputHash,
      dependencyVersions: node.dependencyVersions,
      evidenceRefs: node.evidenceRefs,
      locked: node.locked,
    })),
  );

  return {
    graph: withChange(graph, change),
    staled: change.staled,
    lockedDescendants: change.lockedDescendants,
  };
}

/** 라운드가 산출하는 노드. 한 라운드가 여러 노드를 만들 수 있다 (R2 = 지역 + 숙소) */
export function nodesForRound(roundId: RoundId): PlanningNodeId[] {
  return (Object.keys(nodeToRound) as PlanningNodeId[]).filter(
    (nodeId) => nodeToRound[nodeId] === roundId,
  );
}

export function nodeForCategory(category: RefereeCategory): PlanningNodeId {
  return categoryToNode[category];
}

/** V4·V9 입력을 그래프에서 읽는다. RunState가 아니라 DB가 원본이다 */
export function guardsFromGraph(graph: Graph): {
  lockedNodes: PlanningNodeId[];
  unverifiedNodes: PlanningNodeId[];
} {
  return { lockedNodes: lockedNodesOf(graph), unverifiedNodes: unverifiedNodesOf(graph) };
}
