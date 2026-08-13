import { nodeDependencies, type PlanningNodeId } from '@tm/contracts';

/**
 * 상위 노드가 바뀌면 하위 노드는 삭제되지 않고 STALE로 전환된다.
 * 이 계산은 결정론이어야 한다 — LLM에 맡기면 재현성과 감사 기록이 무너진다.
 * 근거: travel-mediation-plan.md 19.3, agent-architecture.md 5.2
 */

/** node → 그 노드에 직접 의존하는 노드들 */
const reverseDependencies = ((): Record<PlanningNodeId, PlanningNodeId[]> => {
  const map = {} as Record<PlanningNodeId, PlanningNodeId[]>;
  for (const nodeId of Object.keys(nodeDependencies) as PlanningNodeId[]) {
    map[nodeId] ??= [];
  }
  for (const [nodeId, deps] of Object.entries(nodeDependencies) as Array<
    [PlanningNodeId, readonly PlanningNodeId[]]
  >) {
    for (const dep of deps) {
      (map[dep] ??= []).push(nodeId);
    }
  }
  return map;
})();

/** 주어진 노드들의 모든 하위 노드(전이적). 자신은 포함하지 않는다. */
export function descendantsOf(changed: readonly PlanningNodeId[]): PlanningNodeId[] {
  const seen = new Set<PlanningNodeId>();
  const queue = [...changed];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const next of reverseDependencies[current] ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  for (const node of changed) seen.delete(node);
  return [...seen];
}

/** 변경된 노드 + 그 하위 노드 전체. 재계산 대상 집합이다. */
export function computeStaleNodes(changed: readonly PlanningNodeId[]): PlanningNodeId[] {
  return [...new Set<PlanningNodeId>([...changed, ...descendantsOf(changed)])];
}

/** 의존성을 만족하는 실행 순서. 순환이 있으면 예외를 던진다. */
export function topologicalOrder(nodes: readonly PlanningNodeId[]): PlanningNodeId[] {
  const target = new Set(nodes);
  const ordered: PlanningNodeId[] = [];
  const visiting = new Set<PlanningNodeId>();
  const visited = new Set<PlanningNodeId>();

  const visit = (node: PlanningNodeId): void => {
    if (visited.has(node)) return;
    if (visiting.has(node)) throw new Error(`Planning Graph에 순환이 있습니다: ${node}`);
    visiting.add(node);
    for (const dep of nodeDependencies[node]) {
      if (target.has(dep)) visit(dep);
    }
    visiting.delete(node);
    visited.add(node);
    ordered.push(node);
  };

  for (const node of nodes) visit(node);
  return ordered;
}
