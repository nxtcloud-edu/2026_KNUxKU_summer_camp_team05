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
