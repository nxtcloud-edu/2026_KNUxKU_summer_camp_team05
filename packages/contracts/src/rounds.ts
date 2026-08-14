import { z } from 'zod';

/** 라운드 식별자. R1은 심판 2개(항공 → 교통)가 순차 실행된다. */
export const roundIds = ['r_0', 'r_1a', 'r_1b', 'r_2', 'r_3', 'r_4', 'r_5', 'r_6'] as const;
export type RoundId = (typeof roundIds)[number];

export const legacyRefereeCategories = [
  'flight',
  'transport',
  'accommodation',
  'activity',
  'dining',
  'scheduler',
  'budget',
] as const;
export type LegacyRefereeCategory = (typeof legacyRefereeCategories)[number];

/** @deprecated 공식 카테고리는 agentCategories 다섯 종류다. 이 alias는 R0~R6 migration 전용이다. */
export const refereeCategories = legacyRefereeCategories;
/** @deprecated 공식 카테고리 타입은 AgentCategory다. */
export type RefereeCategory = LegacyRefereeCategory;

/** 라운드 내부 상태머신. VOTING은 없다(v1.1에서 REVIEW로 대체). */
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
export const reviewTriggers = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'] as const;
export type ReviewTrigger = (typeof reviewTriggers)[number];

export const reviewThresholds = {
  /** C1: 최소 만족도 하한 */
  minSatisfaction: 5.0,
  /** C2: 만족도 격차 상한 */
  maxSatisfactionGap: 4.0,
  /** C3: 연속 최하위 라운드 수 */
  consecutiveLastPlace: 3,
  /** C4: 배정 예산 초과 허용률 */
  budgetOverrunRatio: 0.15,
  /** 강도 0.8 이상 반대자에게 부여하는 만족도 하한 */
  strongOpposeSatisfactionFloor: 5.5,
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
  ccFactor: z.number().min(0.6).max(1.3),
  adjusted: z.number().min(0).max(1),
  signals: z.array(z.enum(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'])),
  basis: z.string(),
  evidence: z.string().optional(),
});

export type IntensityEntry = z.infer<typeof intensityEntrySchema>;
