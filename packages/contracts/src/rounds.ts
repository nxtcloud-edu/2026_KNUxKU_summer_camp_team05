import { z } from 'zod';

/** 라운드 식별자. R1은 심판 2개(항공 → 교통)가 순차 실행된다. */
export const roundIds = ['r_0', 'r_1a', 'r_1b', 'r_2', 'r_3', 'r_4', 'r_5', 'r_6'] as const;
export type RoundId = (typeof roundIds)[number];

export const refereeCategories = [
  'flight',
  'transport',
  'accommodation',
  'activity',
  'dining',
  'scheduler',
  'budget',
] as const;
export type RefereeCategory = (typeof refereeCategories)[number];

/** 라운드 내부 상태머신. 사용자 VOTING 단계는 없고 Proxy 투표는 PROPOSAL 평가 데이터다. */
export const roundPhases = [
  'PENDING',
  'SOURCING',
  'STATEMENT',
  'CLASH',
  'FACTCHECK',
  'PROPOSAL',
  'VERDICT',
  'REVIEW',
  'SETTLED',
] as const;
export type RoundPhase = (typeof roundPhases)[number];

/** Chief 자동 재심 조건. C5·C7은 재심이 아니라 즉시 재조달이다. */
export const reviewTriggers = ['C1', 'C2', 'C4', 'C5', 'C6', 'C7'] as const;
export type ReviewTrigger = (typeof reviewTriggers)[number];

export const reviewThresholds = {
  /** C1: 최소 만족도 하한 */
  minSatisfaction: 5.0,
  /** C2: 0~10000bp 만족도 격차 상한. 경계값 2500bp는 통과한다. */
  maxSatisfactionGapBp: 2_500,
  /** C4: 배정 예산 초과 허용률 */
  budgetOverrunRatio: 0.15,
  /** 강도 0.8 이상 반대자에게 부여하는 만족도 하한 */
  strongOpposeSatisfactionFloor: 5.5,
} as const;

/** C2는 낮은 점수 자체를 다루는 C1과 분리해 만족도 손실의 편중만 검사한다. */
export const satisfactionGapPolicyV1 = {
  thresholdBp: 2_500,
  minimumScoredParticipants: 2,
  maxFairnessRedebates: 1,
  triggerComparison: 'STRICTLY_GREATER_THAN_THRESHOLD',
  notApplicableHandling: 'EXCLUDE',
  unresolvedHandling: 'KEEP_BEST_VERIFIED_PLAN_AND_REPORT_CONCESSIONS',
} as const;

export const participantSatisfactionForGapSchema = z.discriminatedUnion('status', [
  z.object({
    participantId: z.string().min(1),
    status: z.literal('SCORED'),
    valueBp: z.number().int().min(0).max(10_000),
  }),
  z.object({
    participantId: z.string().min(1),
    status: z.literal('NOT_APPLICABLE'),
    reason: z.string().min(1),
  }),
]);
export type ParticipantSatisfactionForGap = z.infer<typeof participantSatisfactionForGapSchema>;

export const satisfactionGapReviewStatuses = [
  'SKIPPED',
  'PASS',
  'REDEBATE',
  'REPORT_UNRESOLVED',
] as const;
export type SatisfactionGapReviewStatus = (typeof satisfactionGapReviewStatuses)[number];

export type SatisfactionGapReviewResult = {
  status: SatisfactionGapReviewStatus;
  scoredParticipantCount: number;
  gapBp: number | null;
  minimumSatisfactionBp: number | null;
  maximumSatisfactionBp: number | null;
  affectedParticipantIds: string[];
};

/** 같은 입력과 재토론 횟수에는 항상 같은 C2 판정을 반환한다. */
export function evaluateSatisfactionGap(
  participants: readonly ParticipantSatisfactionForGap[],
  fairnessRedebateCount: number,
): SatisfactionGapReviewResult {
  const scored = participants.filter(
    (participant): participant is Extract<ParticipantSatisfactionForGap, { status: 'SCORED' }> =>
      participant.status === 'SCORED',
  );
  if (scored.length < satisfactionGapPolicyV1.minimumScoredParticipants) {
    return {
      status: 'SKIPPED',
      scoredParticipantCount: scored.length,
      gapBp: null,
      minimumSatisfactionBp: null,
      maximumSatisfactionBp: null,
      affectedParticipantIds: [],
    };
  }

  const values = scored.map(({ valueBp }) => valueBp);
  const minimumSatisfactionBp = Math.min(...values);
  const maximumSatisfactionBp = Math.max(...values);
  const gapBp = maximumSatisfactionBp - minimumSatisfactionBp;
  const affectedParticipantIds = scored
    .filter(({ valueBp }) => valueBp === minimumSatisfactionBp)
    .map(({ participantId }) => participantId)
    .sort();

  const status: SatisfactionGapReviewStatus =
    gapBp <= satisfactionGapPolicyV1.thresholdBp
      ? 'PASS'
      : fairnessRedebateCount < satisfactionGapPolicyV1.maxFairnessRedebates
        ? 'REDEBATE'
        : 'REPORT_UNRESOLVED';

  return {
    status,
    scoredParticipantCount: scored.length,
    gapBp,
    minimumSatisfactionBp,
    maximumSatisfactionBp,
    affectedParticipantIds,
  };
}

/** 일반 취향의 실효 중요도 계층 내 동급 판정. 500bp = 5%p이며 경계값도 동급이다. */
export const preferenceTiePolicy = {
  tierToleranceBp: 500,
} as const;

/** 모든 선호 계층이 동급인 후보의 비용·이동시간 비교 정책. 경계값도 동급이다. */
export const costTravelTiePolicy = {
  budgetUtilizationToleranceBp: 500,
  maxDailyTravelDifferenceToleranceMinutes: 30,
} as const;

/** Proxy Agent가 협상안에 제출하는 구조화된 투표다. 사용자 투표와 구분한다. */
export const proxyVoteDecisions = [
  'SUPPORT',
  'ACCEPTABLE',
  'OPPOSE',
  'USER_CONFIRMATION_REQUIRED',
] as const;
export type ProxyVoteDecision = (typeof proxyVoteDecisions)[number];

export const proxyVoteReasonCodes = [
  'NONE',
  'HARD_CONSTRAINT',
  'PROTECTED_OBJECTIVE',
  'MIN_SATISFACTION',
  'FIVE_POINT_PREFERENCE',
  'SOFT_PREFERENCE',
  'ALTERNATIVE_PREFERENCE',
] as const;
export type ProxyVoteReasonCode = (typeof proxyVoteReasonCodes)[number];

export const proxyVoteSchema = z
  .object({
    participantId: z.string().min(1),
    proposalId: z.string().min(1),
    decision: z.enum(proxyVoteDecisions),
    reasonCode: z.enum(proxyVoteReasonCodes),
    affectedPreferenceIds: z.array(z.string()).default([]),
    evidenceIds: z.array(z.string()).default([]),
    explanation: z.string().min(1),
  })
  .superRefine((vote, context) => {
    if (
      (vote.decision === 'OPPOSE' || vote.decision === 'USER_CONFIRMATION_REQUIRED') &&
      vote.reasonCode === 'NONE'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reasonCode'],
        message: '반대 또는 사용자 확인 요청에는 reasonCode가 필요합니다.',
      });
    }
  });
export type ProxyVote = z.infer<typeof proxyVoteSchema>;

/** 최초 협상안 1회 + 수정안 2회 = 최대 3회 투표한다. */
export const debateConsensusPolicyV1 = {
  maxProposalRevisions: 2,
  maxVoteAttempts: 3,
  maxUserRequestedReopensPerIssue: 2,
  unanimousAcceptingDecisions: ['SUPPORT', 'ACCEPTABLE'],
  deterministicFallbackReasonCodes: ['SOFT_PREFERENCE', 'ALTERNATIVE_PREFERENCE'],
  userConfirmationReasonCodes: [
    'PROTECTED_OBJECTIVE',
    'MIN_SATISFACTION',
    'FIVE_POINT_PREFERENCE',
  ],
} as const;

export const executionCaps = {
  turnsPerRound: 32,
  rerunsPerRound: 2,
  globalRecalcs: 3,
  runWallclockSec: 1800,
  maxUtteranceTokens: 120,
  maxVerdictChars: 400,
} as const;

export const roundIdToCategory: Record<RoundId, RefereeCategory | 'supervisor'> = {
  r_0: 'supervisor',
  r_1a: 'flight',
  r_1b: 'transport',
  r_2: 'accommodation',
  r_3: 'activity',
  r_4: 'dining',
  r_5: 'scheduler',
  r_6: 'budget',
};

export const stanceSchema = z.object({
  stance: z.enum(['support', 'oppose', 'conditional']),
  candidateIds: z.array(z.string()).min(1),
  condition: z.string().nullable(),
  message: z.string(),
});

export type Stance = z.infer<typeof stanceSchema>;

/**
 * 주장 강도. 최종 후보 선택에는 절대 사용하지 않는다.
 * 쟁점 식별·절충 설계·만족도 하한·동점 타이브레이크에만 쓴다.
 * 근거: flight-referee-implementation.md 11.4
 */
export const intensityEntrySchema = z.object({
  userId: z.string(),
  target: z.string(),
  stance: z.enum(['support', 'oppose', 'conditional']),
  rawIntensity: z.number().min(0).max(1),
  personaSupport: z.union([z.literal(1), z.literal(0.5), z.literal(0.25)]),
  adjusted: z.number().min(0).max(1),
  signals: z.array(z.enum(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'])),
  basis: z.string(),
  evidence: z.string().optional(),
});

export type IntensityEntry = z.infer<typeof intensityEntrySchema>;
