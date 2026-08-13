import { z } from 'zod';

export const changeAuthorityDecisions = [
  'AUTO_REPLAN',
  'PROXY_DELEGATED',
  'USER_CONFIRMATION_REQUIRED',
  'NEW_SURVEY_SNAPSHOT',
] as const;
export type ChangeAuthorityDecision = (typeof changeAuthorityDecisions)[number];

export const changeReasonCodes = [
  'UNBOOKED_EQUIVALENT_REPLACEMENT',
  'SCHEDULE_REORDER',
  'PRICE_CHANGE_WITHIN_PERSONAL_CAP',
  'ONE_POINT_PREFERENCE_ADJUSTMENT',
  'THREE_POINT_CONDITIONAL_YIELD',
  'FIVE_POINT_PARTIAL_ADJUSTMENT',
  'PROTECTED_OBJECTIVE_DEGRADED',
  'ALL_FIVE_POINT_PREFERENCES_UNMET',
  'MINIMUM_SATISFACTION_UNMET',
  'COST_SHARING_CHANGE',
  'MATERIAL_PUBLISHED_PLAN_CHANGE',
  'BOOKED_ITEM_CHANGE',
  'CANCELLATION_OR_DUPLICATE_BOOKING_RISK',
  'CORE_TIME_ATTRIBUTE_CHANGE',
  'VERIFICATION_DOWNGRADE',
  'PERSONAL_BUDGET_CAP_CHANGE',
  'TRIP_DATE_CHANGE',
  'TRIP_DURATION_CHANGE',
  'DESTINATION_CHANGE',
  'ACTIVE_PARTICIPANTS_CHANGE',
  'HARD_CONSTRAINT_CHANGE',
  'PROTECTED_OBJECTIVE_CHANGE',
  'FULL_REPLAN_FROM_BOOKED_ITEM',
] as const;
export type ChangeReasonCode = (typeof changeReasonCodes)[number];

const autoReplanReasons = [
  'UNBOOKED_EQUIVALENT_REPLACEMENT',
  'SCHEDULE_REORDER',
  'PRICE_CHANGE_WITHIN_PERSONAL_CAP',
  'ONE_POINT_PREFERENCE_ADJUSTMENT',
] as const satisfies readonly ChangeReasonCode[];

const proxyDelegatedReasons = [
  'THREE_POINT_CONDITIONAL_YIELD',
  'FIVE_POINT_PARTIAL_ADJUSTMENT',
] as const satisfies readonly ChangeReasonCode[];

const userConfirmationReasons = [
  'PROTECTED_OBJECTIVE_DEGRADED',
  'ALL_FIVE_POINT_PREFERENCES_UNMET',
  'MINIMUM_SATISFACTION_UNMET',
  'COST_SHARING_CHANGE',
  'MATERIAL_PUBLISHED_PLAN_CHANGE',
  'BOOKED_ITEM_CHANGE',
  'CANCELLATION_OR_DUPLICATE_BOOKING_RISK',
  'CORE_TIME_ATTRIBUTE_CHANGE',
  'VERIFICATION_DOWNGRADE',
] as const satisfies readonly ChangeReasonCode[];

const newSurveySnapshotReasons = [
  'PERSONAL_BUDGET_CAP_CHANGE',
  'TRIP_DATE_CHANGE',
  'TRIP_DURATION_CHANGE',
  'DESTINATION_CHANGE',
  'ACTIVE_PARTICIPANTS_CHANGE',
  'HARD_CONSTRAINT_CHANGE',
  'PROTECTED_OBJECTIVE_CHANGE',
  'FULL_REPLAN_FROM_BOOKED_ITEM',
] as const satisfies readonly ChangeReasonCode[];

/**
 * 높은 권한 단계의 사유가 하나라도 있으면 그 단계가 전체 변경을 지배한다.
 * 이 정책은 "승인으로 하드 제약이나 fail-closed 검증을 우회"하는 권한을 부여하지 않는다.
 */
export const changeAuthorityPolicyV1 = {
  version: 1,
  precedence: changeAuthorityDecisions,
  reasons: {
    AUTO_REPLAN: autoReplanReasons,
    PROXY_DELEGATED: proxyDelegatedReasons,
    USER_CONFIRMATION_REQUIRED: userConfirmationReasons,
    NEW_SURVEY_SNAPSHOT: newSurveySnapshotReasons,
  },
  autoReplanPreconditions: [
    'UNBOOKED',
    'HARD_CONSTRAINTS_SATISFIED',
    'WITHIN_PERSONAL_BUDGET_CAP',
    'PROTECTED_OBJECTIVE_CORE_ATTRIBUTES_RETAINED',
    'MINIMUM_SATISFACTION_RETAINED',
    'NO_VERIFICATION_DOWNGRADE',
    'AFFECTED_NODES_REVALIDATED',
  ],
  userConfirmationCannotOverride: ['HARD_CONSTRAINT', 'FAIL_CLOSED_VERIFICATION'],
} as const;

export const changeAuthorityRequestSchema = z.object({
  changeId: z.string().min(1),
  tripId: z.string().min(1),
  surveySnapshotVersion: z.number().int().positive(),
  planVersion: z.number().int().nonnegative(),
  reasonCodes: z.array(z.enum(changeReasonCodes)).min(1),
  affectedParticipantIds: z.array(z.string().min(1)),
  affectedPlanNodeIds: z.array(z.string().min(1)),
  requestedAt: z.string().datetime(),
});
export type ChangeAuthorityRequest = z.infer<typeof changeAuthorityRequestSchema>;

export const changeImpactDiffSchema = z.object({
  previousCostAmount: z.number().nonnegative().nullable(),
  latestCostAmount: z.number().nonnegative().nullable(),
  previousTravelMinutes: z.number().int().nonnegative().nullable(),
  latestTravelMinutes: z.number().int().nonnegative().nullable(),
  previousSatisfactionBpByParticipant: z.record(z.string(), z.number().int().min(0).max(10_000)),
  latestSatisfactionBpByParticipant: z.record(z.string(), z.number().int().min(0).max(10_000)),
  bookingImpact: z.enum(['NONE', 'REBOOK', 'CANCELLATION_FEE_RISK', 'DUPLICATE_BOOKING_RISK']),
});
export type ChangeImpactDiff = z.infer<typeof changeImpactDiffSchema>;

export const changeAuthorityRecordSchema = z.object({
  request: changeAuthorityRequestSchema,
  decision: z.enum(changeAuthorityDecisions),
  status: z.enum(['CLASSIFIED', 'AWAITING_USER', 'APPROVED', 'REJECTED', 'APPLIED']),
  impactDiff: changeImpactDiffSchema.optional(),
  decidedBy: z.literal('ORCHESTRATOR_POLICY_V1'),
  decidedAt: z.string().datetime(),
});
export type ChangeAuthorityRecord = z.infer<typeof changeAuthorityRecordSchema>;

/** LLM의 자연어 판단이 아니라 사유 코드 집합에 대해 결정론적으로 실행한다. */
export function classifyChangeAuthority(reasonCodes: readonly ChangeReasonCode[]): ChangeAuthorityDecision {
  const reasonSet = new Set<ChangeReasonCode>(reasonCodes);
  if (newSurveySnapshotReasons.some((reason) => reasonSet.has(reason))) return 'NEW_SURVEY_SNAPSHOT';
  if (userConfirmationReasons.some((reason) => reasonSet.has(reason))) {
    return 'USER_CONFIRMATION_REQUIRED';
  }
  if (proxyDelegatedReasons.some((reason) => reasonSet.has(reason))) return 'PROXY_DELEGATED';
  return 'AUTO_REPLAN';
}
