import type { PlanningNodeId, RefereeCategory, RoundId } from '@tm/contracts';

/** 카테고리 심판이 산출하는 Planning Graph 노드 */
export const categoryToNode: Record<RefereeCategory, PlanningNodeId> = {
  flight: 'flight',
  transport: 'transport_policy',
  accommodation: 'accommodation',
  activity: 'activity',
  dining: 'dining',
  scheduler: 'schedule',
  budget: 'budget',
};

/** 노드를 산출하는 라운드. 기본 위상 순서와 일치한다 (agent-architecture.md 4.5) */
export const nodeToRound: Partial<Record<PlanningNodeId, RoundId>> = {
  date: 'r_0',
  flight: 'r_1a',
  transport_policy: 'r_1b',
  accommodation_area: 'r_2',
  accommodation: 'r_2',
  activity: 'r_3',
  transit_pass: 'r_1b',
  dining: 'r_4',
  schedule: 'r_5',
  budget: 'r_6',
};

const roundOrder: RoundId[] = ['r_0', 'r_1a', 'r_1b', 'r_2', 'r_3', 'r_4', 'r_5', 'r_6'];

/** 재계산 대상 노드 집합을 다시 실행해야 하는 라운드 목록으로 바꾼다. */
export function roundsForNodes(nodes: readonly PlanningNodeId[]): RoundId[] {
  const rounds = new Set<RoundId>();
  for (const node of nodes) {
    const round = nodeToRound[node];
    if (round !== undefined) rounds.add(round);
  }
  return roundOrder.filter((round) => rounds.has(round));
}
