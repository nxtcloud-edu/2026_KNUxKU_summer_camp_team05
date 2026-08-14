import { z } from 'zod';

/** 분야·세부 5·3·1과 분리해 일정 구성과 동급 후보 비교에만 사용하는 축이다. */
export const travelStyleAxes = [
  'PACE',
  'PLANNING',
  'NATURE_VS_CITY',
  'HISTORY_VS_TREND',
  'LOCAL_VS_PROVEN_DINING',
  'TOGETHERNESS',
  'DAILY_RHYTHM',
  'EVENING_STYLE',
  'TRANSPORT_STYLE',
  'PHOTO_PRIORITY',
  'ACTIVITY_RISK',
] as const;
export type TravelStyleAxis = (typeof travelStyleAxes)[number];

export const travelStyleValueSchema = z.number().int().min(1).max(7);
export type TravelStyleValue = z.infer<typeof travelStyleValueSchema>;

/** Zod 3의 enum record는 partial이므로 모든 축을 명시한 strict object로 고정한다. */
export const travelStyleProfileSchema = z
  .object({
    PACE: travelStyleValueSchema.nullable(),
    PLANNING: travelStyleValueSchema.nullable(),
    NATURE_VS_CITY: travelStyleValueSchema.nullable(),
    HISTORY_VS_TREND: travelStyleValueSchema.nullable(),
    LOCAL_VS_PROVEN_DINING: travelStyleValueSchema.nullable(),
    TOGETHERNESS: travelStyleValueSchema.nullable(),
    DAILY_RHYTHM: travelStyleValueSchema.nullable(),
    EVENING_STYLE: travelStyleValueSchema.nullable(),
    TRANSPORT_STYLE: travelStyleValueSchema.nullable(),
    PHOTO_PRIORITY: travelStyleValueSchema.nullable(),
    ACTIVITY_RISK: travelStyleValueSchema.nullable(),
  })
  .strict();
export type TravelStyleProfile = z.infer<typeof travelStyleProfileSchema>;

export const styleFitPolicyV1 = {
  minValue: 1,
  maxValue: 7,
  neutralValue: 4,
  denominator: 6,
  comparisonOrder: ['MIN_PARTICIPANT_STYLE_FIT', 'MEAN_STYLE_FIT'],
  scoreRole: 'TIE_BREAK_ONLY',
} as const;

/**
 * 1~7 사용자 값과 검증된 후보·Plan 태그의 거리로 0~10000bp 적합도를 계산한다.
 * 미응답은 호출 전에 NOT_APPLICABLE로 제외해야 한다.
 */
export function calculateStyleFitBp(
  userValue: TravelStyleValue,
  candidateValue: TravelStyleValue,
): number {
  const safeUserValue = travelStyleValueSchema.parse(userValue);
  const safeCandidateValue = travelStyleValueSchema.parse(candidateValue);
  return Math.round(10_000 * (1 - Math.abs(safeUserValue - safeCandidateValue) / 6));
}

/** 분야 우선순위와 중복되어 MVP 입력에서 제거한 구버전 축이다. */
export const deprecatedTravelStyleAxes = ['ACCOMMODATION_SPEND'] as const;
