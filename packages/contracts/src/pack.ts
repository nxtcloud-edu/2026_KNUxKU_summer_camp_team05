import { z } from 'zod';

/**
 * Destination Pack — 목적지 하나에 필요한 모든 설정을 묶은 데이터 패키지.
 * 코드 배포 없이 DB/JSON 추가만으로 신규 목적지를 오픈한다.
 *
 * 지역 의존 로직을 코드에 넣지 않는다. `if (country === 'JP')` 를 쓰는 순간 확장은 끝난다.
 * 근거: travel-mediation-plan.md 4.1 · 18.4
 */

export const coverageGrades = ['A', 'B', 'C'] as const;
export type CoverageGrade = (typeof coverageGrades)[number];

export const roundPresets = ['standard_domestic', 'standard_overseas', 'europe_multicity'] as const;
export type RoundPreset = (typeof roundPresets)[number];

/** 조회 시점과 출처를 남기지 않은 값은 검증된 값이 아니다. */
export const sourceRefSchema = z.object({
  field: z.string(),
  status: z.enum(['unverified', 'verified', 'estimated']),
  source: z.string().optional(),
  checkedAt: z.string().optional(),
  note: z.string().optional(),
});

export type SourceRef = z.infer<typeof sourceRefSchema>;

/** 교통패스 룰. 공개 API가 없어 직접 구축해야 하는 자산이다 (교통 4.2) */
export const transitPassSchema = z.object({
  id: z.string(),
  name: z.string(),
  priceMinor: z.number().int().positive(),
  currency: z.string().length(3),
  validity: z.string(),
  coverage: z.array(z.string()),
  includedAttractions: z.array(z.string()).default([]),
  excludes: z.array(z.string()).default([]),
  purchaseUrl: z.string().url().optional(),
  /** 연속/비연속 사용, 구매·교환 장소, 시간대 제약 (교통 19.2) */
  usageConditions: z.string().optional(),
  notes: z.string().optional(),
});

export type TransitPass = z.infer<typeof transitPassSchema>;

/** 실시간 가격을 못 얻는 지역의 가격 밴드 (숙소 5.2 · 20.5) */
export const priceBandSchema = z.object({
  area: z.string(),
  type: z.string(),
  season: z.string(),
  weekday: z.object({ min: z.number().int(), max: z.number().int() }),
  weekend: z.object({ min: z.number().int(), max: z.number().int() }),
  sampleSize: z.number().int().nonnegative(),
  samplePeriod: z.string(),
  updatedAt: z.string(),
  errorP50: z.number().optional(),
  errorP95: z.number().optional(),
});

export type PriceBand = z.infer<typeof priceBandSchema>;

export const destinationPackSchema = z.object({
  packId: z.string().regex(/^[a-z]{2}-[a-z-]+$/, 'kr-gangneung 형태여야 합니다'),
  displayName: z.string(),
  country: z.string().length(2),
  coverage: z.enum(coverageGrades),
  active: z.boolean().default(false),
  center: z.object({ lat: z.number(), lng: z.number() }),
  areas: z.array(z.string()).min(2),
  /** 도착 공항 후보. 해외 Pack과 kr-jeju에서 항공 심판이 쓴다 */
  airports: z.array(z.string()).default([]),
  requiresAirTravel: z.boolean().default(false),
  cardDeck: z.string(),
  providers: z.object({
    hotel: z.array(z.string()).min(1),
    dining: z.array(z.string()).min(1),
    poi: z.array(z.string()).min(1),
    transit: z.array(z.string()).min(1),
    flight: z.array(z.string()).default([]),
  }),
  config: z.object({
    currency: z.string().length(3),
    displayCurrency: z.string().length(3),
    mealTimes: z.object({ lunch: z.string(), dinner: z.string() }),
    tipping: z.boolean(),
    defaultTransit: z.string(),
    commonClosedDay: z.string().nullable(),
    reservationCulture: z.string().nullable(),
    /** 현지 통화 최소 단위 기준 평균 단가 */
    avgCosts: z.object({
      mealMid: z.number().int(),
      subwayRide: z.number().int(),
      taxiBase: z.number().int(),
    }),
    /** IANA timezone. 일정 실행 가능성 판정에 필수 (기획서 19.4) */
    timezone: z.string(),
  }),
  typicalDurations: z.array(z.number().int().positive()).min(1),
  recommendedNights: z.number().int().positive(),
  peakSeasons: z.array(z.string()).default([]),
  avoidDates: z.array(z.string()).default([]),
  weatherProfile: z.object({
    bestMonths: z.array(z.number().int().min(1).max(12)),
    rainyMonths: z.array(z.number().int().min(1).max(12)),
  }),
  roundPreset: z.enum(roundPresets),
  transitPasses: z.array(transitPassSchema).default([]),
  priceBands: z.array(priceBandSchema).default([]),
  /** 아직 확인하지 못한 값의 목록. 비어 있지 않으면 coverage A로 승격할 수 없다 */
  verification: z.array(sourceRefSchema).default([]),
});

export type DestinationPack = z.infer<typeof destinationPackSchema>;

/**
 * 등급 A는 숙소 가격·로컬 미식·대중교통 상세가 모두 현재 데이터로 검증 가능할 때만 쓴다.
 * 가격이 밴드 추정인 Pack은 기본 B다 (기획서 19.1).
 */
export function maxAllowedCoverage(pack: DestinationPack): CoverageGrade {
  const unverified = pack.verification.filter((ref) => ref.status !== 'verified');
  if (unverified.length > 0) return 'B';
  const hasEstimatedLodging = pack.priceBands.length > 0;
  return hasEstimatedLodging ? 'B' : 'A';
}

export function assertCoverageIsHonest(pack: DestinationPack): void {
  const allowed = maxAllowedCoverage(pack);
  const rank: Record<CoverageGrade, number> = { A: 3, B: 2, C: 1 };
  if (rank[pack.coverage] > rank[allowed]) {
    throw new Error(
      `${pack.packId}: coverage ${pack.coverage}로 표기했지만 검증 상태가 ${allowed}입니다`,
    );
  }
}
