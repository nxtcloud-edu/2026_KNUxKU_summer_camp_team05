import { z } from 'zod';

/**
 * 전역 Planning Graph 노드.
 * 근거: travel-mediation-plan.md 19.3, agent-architecture.md 5장
 */
export const planningNodeIds = [
  'date',
  'flight',
  'transport_policy',
  'accommodation_area',
  'accommodation',
  'transit_pass',
  'activity',
  'dining',
  'schedule',
  'budget',
  'booking_readiness',
  'validation',
  'document',
] as const;

export type PlanningNodeId = (typeof planningNodeIds)[number];

/** 노드 상태 전이: PROVISIONAL → VERIFIED → BOOKABLE → BOOKED, 이탈은 BLOCKED/STALE/FAILED */
export const nodeStatuses = [
  'PROVISIONAL',
  'VERIFIED',
  'BOOKABLE',
  'BOOKED',
  'BLOCKED',
  'STALE',
  'FAILED',
] as const;

export type NodeStatus = (typeof nodeStatuses)[number];

export const confidenceLevels = ['unknown', 'estimated', 'live'] as const;
export type Confidence = (typeof confidenceLevels)[number];

export const schedulePaces = ['REST', 'BALANCED', 'ACTIVE'] as const;
export type SchedulePace = (typeof schedulePaces)[number];

/** MVP ScheduleOptimizer의 결정론적 Beam Search 정책. */
export const scheduleOptimizationPolicyV1 = {
  algorithm: 'CONSTRAINT_FIRST_BEAM_SEARCH',
  timeSlotMinutes: 15,
  beamWidth: 30,
  outputPlanCount: 3,
  candidateLimitPerCategoryPerDay: 10,
  transitBufferMinimumMinutes: 10,
  transitBufferRatioBp: 2000,
  mainContentLimitByPace: {
    REST: 1,
    BALANCED: 2,
    ACTIVE: 3,
  },
} as const;

/** 식사·숙소 체크인·단순 이동은 하루 주요 콘텐츠 개수에서 제외한다. */
export const nonMainContentKinds = ['MEAL', 'ACCOMMODATION_CHECK', 'TRANSIT'] as const;
export type NonMainContentKind = (typeof nonMainContentKinds)[number];

export const planningNodeSchema = z.object({
  nodeId: z.enum(planningNodeIds),
  version: z.number().int().nonnegative(),
  inputHash: z.string(),
  dependencyVersions: z.record(z.string(), z.number().int().nonnegative()),
  status: z.enum(nodeStatuses),
  confidence: z.enum(confidenceLevels),
  evidenceRefs: z.array(z.string()),
  locked: z.boolean().default(false),
  updatedAt: z.string().datetime(),
});

export type PlanningNode = z.infer<typeof planningNodeSchema>;

export const allowedNodeStatusTransitions: Record<NodeStatus, readonly NodeStatus[]> = {
  PROVISIONAL: ['VERIFIED', 'BLOCKED', 'STALE', 'FAILED'],
  VERIFIED: ['BOOKABLE', 'BLOCKED', 'STALE', 'FAILED'],
  BOOKABLE: ['BOOKED', 'PROVISIONAL', 'BLOCKED', 'STALE', 'FAILED'],
  BOOKED: ['STALE', 'FAILED'],
  BLOCKED: ['PROVISIONAL', 'STALE', 'FAILED'],
  STALE: ['PROVISIONAL', 'VERIFIED', 'BLOCKED', 'FAILED'],
  FAILED: ['PROVISIONAL'],
};

/** 저장 직전 호출하는 결정론적 상태 전이 가드. 잠긴 노드는 BOOKED 외 자동 승격할 수 없다. */
export function assertPlanningNodeTransition(previous: PlanningNode, next: PlanningNode): void {
  const safePrevious = planningNodeSchema.parse(previous);
  const safeNext = planningNodeSchema.parse(next);
  if (safePrevious.nodeId !== safeNext.nodeId) throw new Error('nodeId가 다른 상태 전이는 허용되지 않습니다.');
  if (safeNext.version !== safePrevious.version + 1) throw new Error('계획 노드 version은 정확히 1 증가해야 합니다.');
  if (!allowedNodeStatusTransitions[safePrevious.status].includes(safeNext.status)) {
    throw new Error(safePrevious.status + ' → ' + safeNext.status + ' 전이는 허용되지 않습니다.');
  }
  if (safePrevious.locked && safeNext.status !== 'BOOKED' && safeNext.status !== 'STALE') {
    throw new Error('잠긴 노드는 BOOKED 또는 STALE 이외 상태로 자동 전이할 수 없습니다.');
  }
  if (safeNext.status === 'BOOKABLE' && safeNext.confidence !== 'live') {
    throw new Error('BOOKABLE 노드는 live confidence가 필요합니다.');
  }
}

/**
 * 노드 의존성. 상위 노드가 바뀌면 하위 노드는 삭제되지 않고 STALE로 전환된다.
 * 근거: agent-architecture.md 5.1 / 5.2
 */
export const nodeDependencies: Record<PlanningNodeId, readonly PlanningNodeId[]> = {
  date: [],
  flight: ['date'],
  transport_policy: ['date', 'flight'],
  accommodation_area: ['transport_policy'],
  accommodation: ['accommodation_area'],
  activity: ['accommodation'],
  transit_pass: ['transport_policy', 'activity'],
  dining: ['accommodation', 'activity'],
  schedule: ['accommodation', 'activity', 'dining', 'transit_pass'],
  budget: ['flight', 'transport_policy', 'accommodation', 'activity', 'dining', 'schedule'],
  booking_readiness: ['schedule', 'budget'],
  validation: ['budget', 'schedule'],
  document: ['validation', 'booking_readiness'],
};
