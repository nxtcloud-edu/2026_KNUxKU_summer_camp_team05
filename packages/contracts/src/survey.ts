import { z } from 'zod';

/**
 * 설문 제출 계약. 프론트엔드(`apps/web/src/formState.ts`)의 payload와 1:1로 대응한다.
 * 설문은 이 서비스의 유일한 입력이므로, 프론트와 서버가 같은 스키마를 공유해야 한다.
 * 근거: travel-mediation-plan.md 5.1 · 마무리 1번
 */

export const preferredNightsValues = ['1', '2', '3', '4+'] as const;
export const nightFlexibilityValues = ['fixed', 'plus-minus-one'] as const;
export const weekdayFlexibilityValues = ['weekends', 'friday-pto', 'weekdays'] as const;
export const flightTimeFlexibilityValues = ['early-morning', 'morning-onward', 'any-time'] as const;

/** ISO 날짜(YYYY-MM-DD) */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다');

export const availabilitySchema = z.object({
  availableDates: z.array(isoDate),
  unavailableDates: z.array(isoDate),
  preferredNights: z.enum(preferredNightsValues).nullable(),
  nightFlexibility: z.enum(nightFlexibilityValues).nullable(),
  weekdayFlexibility: z.enum(weekdayFlexibilityValues).nullable(),
  flightTimeFlexibility: z.enum(flightTimeFlexibilityValues).nullable(),
});

export type Availability = z.infer<typeof availabilitySchema>;

const constraintTag = z.string().trim().min(1).max(40);

/**
 * dietary와 allergies는 반드시 분리한다.
 * dietary는 절충 가능한 취향·신념 축, allergies는 협상 불가한 안전 축이다.
 * 근거: travel-mediation-plan.md 9.4 · 19.6 fail-closed
 */
export const hardConstraintsSchema = z.object({
  budgetLimit: z.string(),
  includesFlight: z.boolean(),
  dietary: z.array(constraintTag),
  allergies: z.array(constraintTag),
  beliefs: z.array(constraintTag),
  walkingDistanceKm: z.number().int().min(1).max(30).nullable(),
  mobilityNeeds: z.array(constraintTag),
  noGoItems: z.array(constraintTag),
});

export type HardConstraints = z.infer<typeof hardConstraintsSchema>;

/** 1~7 슬라이더. null은 미응답 */
const sliderValue = z.number().int().min(1).max(7).nullable();
/** 1~10 카드 선호도. null은 미응답 */
const cardScore = z.number().int().min(1).max(10).nullable();

export const surveyDraftSchema = z.object({
  availability: availabilitySchema,
  hardConstraints: hardConstraintsSchema,
  travelStyles: z.record(z.string(), sliderValue),
  activityScores: z.record(z.string(), cardScore),
  mustDo: z.string().max(200),
  avoid: z.string().max(200),
});

export type SurveyDraft = z.infer<typeof surveyDraftSchema>;

/** 방 생성. 방장은 목적지만 선택한다 (기획서 v1.2) */
export const roomSubmissionSchema = z.object({
  schemaVersion: z.literal(1),
  destinationId: z.string().min(1),
});

export type RoomSubmission = z.infer<typeof roomSubmissionSchema>;

/** v2: hardConstraints.diet(단일값) → dietary[] + allergies[] 분리 */
export const surveySubmissionSchema = surveyDraftSchema.extend({
  schemaVersion: z.literal(2),
  destinationId: z.string().min(1),
});

export type SurveySubmission = z.infer<typeof surveySubmissionSchema>;

/**
 * 설문 값에서 유도되는 정규화 결과.
 * 알레르기는 하드 실격 태그로, 예산은 숫자로 변환해 후속 라운드가 그대로 쓴다.
 */
export interface NormalizedMandate {
  userId: string;
  /** 협상 불가 */
  hard: string[];
  /** 안전 축. 코드 레벨 실격 + 대응 확인 실패 시 후보 BLOCKED */
  allergens: string[];
  budgetMaxPerPersonKrw: number | null;
  budgetIncludesFlight: boolean;
  maxWalkKmPerDay: number | null;
  /** 되돌리기 어렵거나 인적 관계에 영향을 주는 변경은 사전 승인이 필요하다 */
  approvalRequired: string[];
}

/** 예산 입력은 '1,200,000' 같은 형태로 들어온다. 숫자만 남긴다. */
export function parseBudgetKrw(budgetLimit: string): number | null {
  const digits = budgetLimit.replace(/[^0-9]/g, '');
  if (digits.length === 0) return null;
  const value = Number(digits);
  return Number.isFinite(value) && value > 0 ? value : null;
}
