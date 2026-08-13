import { z } from 'zod';

/**
 * 설문 v3 초안 — 4단계 중요도 척도.
 *
 * ⚠️ 확정 전이다. v2(슬라이더 12 + 카드 1~10)와 병존하며, 확정 시 v2를 대체한다.
 * 설계 출처: 팀 설문 스케치 (docs/survey-v3-proposal.md)
 *
 * 기존 v2와의 차이: 연속값 슬라이더가 아니라 이산 4단계 + 동일 단계 내 랭킹이다.
 * 이산 척도는 응답 부담이 낮고 "불가"를 명시적으로 표현할 수 있다.
 * 대신 단계 내 해상도가 낮아 랭킹으로 보완한다.
 */

export const importanceLabels = ['purpose', 'preferred', 'whatever', 'forbidden'] as const;
export type ImportanceLabel = (typeof importanceLabels)[number];

/** 설문 UI에 표시되는 점수. 스코어링 가중치와 같지 않다 (deriveItemWeights 참조) */
export const importancePoints: Record<ImportanceLabel, 0 | 1 | 3 | 5> = {
  /** 목적 — 이것 때문에 여행 간다 */
  purpose: 5,
  /** 선호, 협의 가능 */
  preferred: 3,
  /** 아무거나 */
  whatever: 1,
  /** 불가 — 하드 제약. 가중치가 아니라 실격 사유다 */
  forbidden: 0,
};

export const importanceEntrySchema = z.object({
  itemId: z.string().min(1),
  level: z.enum(importanceLabels),
  /** 같은 단계 안에서의 순위. 1이 가장 높다. 미지정이면 동순위 */
  rankWithinLevel: z.number().int().positive().nullable().default(null),
  /** 사용자가 직접 추가한 항목인지 */
  userAdded: z.boolean().default(false),
});

export type ImportanceEntry = z.infer<typeof importanceEntrySchema>;

/** 여행 컨셉. 음식·액티비티·숙소 중 무엇을 우선하는가 */
export const conceptIds = ['gourmet', 'resort', 'activity'] as const;
export type ConceptId = (typeof conceptIds)[number];

/**
 * 컨셉이 카테고리 가중치를 정한다. 예산 배분과 라운드별 만족도 가중에 쓴다.
 * 합은 1.0이다.
 */
export const conceptWeights: Record<ConceptId, { dining: number; activity: number; accommodation: number }> = {
  /** 식도락: 음식 우선 */
  gourmet: { dining: 0.5, activity: 0.25, accommodation: 0.25 },
  /** 호캉스: 숙소 우선 */
  resort: { dining: 0.25, activity: 0.25, accommodation: 0.5 },
  /** 액티비티 우선 */
  activity: { dining: 0.25, activity: 0.5, accommodation: 0.25 },
};

export const paceIds = ['relaxed', 'balanced', 'packed'] as const;
export type PaceId = (typeof paceIds)[number];

export const transportModes = ['plane', 'ship', 'train', 'bus', 'car'] as const;
export type TransportMode = (typeof transportModes)[number];

/** 방장이 방 생성 시 정하는 값 (Setting 단계) */
export const roomSettingSchema = z.object({
  packId: z.string().min(1),
  transportModes: z.array(z.enum(transportModes)).min(1),
  pace: z.enum(paceIds),
  /** 1인 예산 한도 (KRW). 방장이 제시하는 기준값 */
  budgetPerPersonKrw: z.number().int().positive(),
  /**
   * ⚠️ 미해결: 날짜를 방장이 고정하면 기획서 v1.2의 DateResolver와 충돌한다.
   * docs/survey-v3-proposal.md 4장 참조. 확정까지 optional로 둔다.
   */
  dateRange: z
    .object({ start: z.string(), end: z.string() })
    .nullable()
    .default(null),
});

export type RoomSetting = z.infer<typeof roomSettingSchema>;

export const preferenceSectionSchema = z.object({
  entries: z.array(importanceEntrySchema).default([]),
  /** 아무것도 적지 않으면 이 카테고리는 취향 반영에서 제외된다 */
  skipped: z.boolean().default(false),
});

export const surveyV3Schema = z.object({
  schemaVersion: z.literal(3),
  roomId: z.string().min(1),
  concept: z.enum(conceptIds),
  dining: preferenceSectionSchema,
  activity: preferenceSectionSchema,
  accommodation: preferenceSectionSchema,
  /** 안전 축. 해당 음식을 후보에서 제외한다. 협상 대상이 아니다 */
  allergies: z.array(z.string().trim().min(1).max(40)).default([]),
  /** 액티비티 제외 사유 (예: 고소공포증 → 고공 액티비티 제외) */
  activityExclusions: z.array(z.string().trim().min(1).max(40)).default([]),
});

export type SurveyV3 = z.infer<typeof surveyV3Schema>;

export interface DerivedWeights {
  /** itemId → 가중치 [0,1] */
  weights: Record<string, number>;
  /** forbidden으로 표시된 항목. 스코어링 이전에 실격 처리한다 */
  excludedItemIds: string[];
  /** 이 카테고리에 응답이 없으면 true. 만족도 계산에서 중립 처리한다 */
  skipped: boolean;
}

const LEVEL_BASE: Record<Exclude<ImportanceLabel, 'forbidden'>, number> = {
  purpose: 1.0,
  preferred: 0.6,
  whatever: 0.2,
};

/** 같은 단계 내 랭킹이 만드는 최대 보정폭. 단계 간 간격(0.4)보다 작아야 한다. */
const RANK_SPREAD = 0.15;

/**
 * 중요도 응답을 스코어링 가중치로 변환한다.
 *
 * 단계가 주 신호이고 랭킹은 보정이다. 랭킹 보정폭(0.15)이 단계 간 간격(0.4)보다
 * 작으므로, 'preferred 1순위'가 'purpose 최하위'를 넘어서지 않는다.
 * 이 순서가 뒤집히면 사용자가 단계를 고른 의미가 사라진다.
 */
export function deriveItemWeights(section: {
  entries: ImportanceEntry[];
  skipped: boolean;
}): DerivedWeights {
  const weights: Record<string, number> = {};
  const excludedItemIds: string[] = [];

  const byLevel = new Map<ImportanceLabel, ImportanceEntry[]>();
  for (const entry of section.entries) {
    const bucket = byLevel.get(entry.level) ?? [];
    bucket.push(entry);
    byLevel.set(entry.level, bucket);
  }

  for (const [level, entries] of byLevel) {
    if (level === 'forbidden') {
      for (const entry of entries) excludedItemIds.push(entry.itemId);
      continue;
    }

    const base = LEVEL_BASE[level];
    const ranked = entries.filter((entry) => entry.rankWithinLevel !== null);
    const maxRank = ranked.reduce((max, entry) => Math.max(max, entry.rankWithinLevel ?? 0), 0);

    for (const entry of entries) {
      const rank = entry.rankWithinLevel;
      if (rank === null || maxRank <= 1) {
        weights[entry.itemId] = base;
        continue;
      }
      // rank 1 → +RANK_SPREAD/2, 최하위 → −RANK_SPREAD/2
      const factor = (maxRank - rank) / (maxRank - 1);
      const adjusted = base + (factor - 0.5) * RANK_SPREAD;
      weights[entry.itemId] = Math.min(1, Math.max(0, Number(adjusted.toFixed(4))));
    }
  }

  return {
    weights,
    excludedItemIds,
    skipped: section.skipped || section.entries.length === 0,
  };
}
