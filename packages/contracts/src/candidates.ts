import { z } from 'zod';
import { confidenceLevels } from './planning.js';

/**
 * 정규화 후보 스키마. 에이전트와 심판은 제공자 원본 형식을 절대 보지 않는다.
 * 근거: travel-mediation-plan.md 10.3
 */
const priceSchema = z.object({
  amount: z.number(),
  currency: z.string().length(3),
  confidence: z.enum(confidenceLevels),
});

export const candidateBaseSchema = z.object({
  id: z.string(),
  source: z.string(),
  fetchedAt: z.string().datetime(),
  disqualified: z.boolean().default(false),
  disqualifyReason: z.string().nullable().default(null),
});

/** 항공. 판결 기준은 항공료가 아니라 effectiveTotal 이다. */
export const flightCandidateSchema = candidateBaseSchema.extend({
  kind: z.literal('flight'),
  outbound: z.object({
    carrier: z.object({ code: z.string(), name: z.string() }),
    flightNumber: z.string(),
    departure: z.object({ airport: z.string(), terminal: z.string().nullable(), at: z.string() }),
    arrival: z.object({ airport: z.string(), terminal: z.string().nullable(), at: z.string() }),
    durationMin: z.number().int().positive(),
    connections: z.number().int().nonnegative(),
  }),
  inbound: z.object({
    carrier: z.object({ code: z.string(), name: z.string() }),
    flightNumber: z.string(),
    departure: z.object({ airport: z.string(), at: z.string() }),
    arrival: z.object({ airport: z.string(), at: z.string() }),
    durationMin: z.number().int().positive(),
    connections: z.number().int().nonnegative(),
  }),
  price: priceSchema.extend({ perPersonRoundTrip: z.number(), groupTotal: z.number() }),
  baggage: z.object({
    checkedIncluded: z.boolean().nullable(),
    checkedKg: z.number().nullable(),
    extraCheckedFeePerPerson: z.number().nullable(),
  }),
  seatsAvailable: z.number().int().nonnegative().nullable(),
  /** 확인 전에는 winner/BOOKABLE 승격 금지 (fail-closed) */
  groupInventoryVerified: z.boolean().default(false),
  effectiveTotal: z.object({ perPerson: z.number(), note: z.string() }),
  bookingUrl: z.string().url().nullable(),
});

export type FlightCandidate = z.infer<typeof flightCandidateSchema>;

/** 숙소. 비교 기준은 effectiveLodgingCost(식사 가치 차감) 이다. */
export const hotelCandidateSchema = candidateBaseSchema.extend({
  kind: z.literal('hotel'),
  name: z.string(),
  type: z.enum(['hotel', 'ryokan', 'apartment', 'guesthouse', 'pension', 'resort']),
  location: z.object({
    lat: z.number(),
    lng: z.number(),
    area: z.string(),
    address: z.string().nullable(),
  }),
  price: priceSchema.extend({
    perNightPerPerson: z.number(),
    totalPerPerson: z.number(),
    groupTotal: z.number(),
    taxesIncluded: z.boolean(),
  }),
  meals: z.object({
    breakfastIncluded: z.boolean().nullable(),
    dinnerIncluded: z.boolean().nullable(),
    mealValuePerPersonPerNight: z.number().nullable(),
    effectiveLodgingCost: z.number().nullable(),
    /** 알레르기·식이 대응 확인 전에는 식사 크레딧을 계산하지 않는다 */
    dietSupportVerified: z.boolean().default(false),
  }),
  capacity: z.object({
    maxGuests: z.number().int().positive(),
    roomOptions: z.array(
      z.object({
        config: z.string(),
        totalGuests: z.number().int().positive(),
        /**
         * 요금을 모르면 null이다. 0이 아니다.
         * 정원은 주면서 요금은 주지 않는 공급자가 실제로 있다(TourAPI 숙박).
         * 0으로 채우면 그 후보가 집합의 최저가가 되어 예산 비교를 전부 이긴다.
         */
        pricePerNight: z.number().nullable(),
      }),
    ),
  }),
  /** 총 수용 인원 표기와 객실 조합 동시 재고는 다르다 (fail-closed) */
  roomCombinationVerified: z.boolean().default(false),
  allInPriceVerified: z.boolean().default(false),
  amenities: z.array(z.string()),
  accessibility: z.object({
    wheelchair: z.boolean().nullable(),
    elevator: z.boolean().nullable(),
    stepFree: z.boolean().nullable(),
  }),
  locationMetrics: z.record(z.string(), z.object({ label: z.string(), minutes: z.number() })),
  rating: z.object({ score: z.number(), count: z.number().int() }).nullable(),
  cancelPolicy: z.object({ freeUntil: z.string().nullable(), penaltyAfter: z.string().nullable() }),
  bookingUrl: z.string().url().nullable(),
});

export type HotelCandidate = z.infer<typeof hotelCandidateSchema>;

/** 교통. 도시간·공항접근 후보와 '현지 이동 정책' 후보의 형태가 다르다. */
export const transportCandidateSchema = candidateBaseSchema.extend({
  kind: z.literal('transport'),
  variant: z.enum(['intercity', 'airport_transfer', 'local_policy']),
  label: z.string(),
  segments: z
    .array(
      z.object({
        mode: z.enum(['train', 'express_bus', 'car', 'rental_car', 'transit', 'walking', 'taxi']),
        operator: z.string().nullable(),
        from: z.string(),
        to: z.string(),
        departAt: z.string().nullable(),
        arriveAt: z.string().nullable(),
        durationMin: z.number().int().nonnegative(),
        farePerPersonKrw: z.number().nonnegative(),
      }),
    )
    .default([]),
  totals: z
    .object({
      durationMin: z.number().int().nonnegative(),
      farePerPersonKrw: z.number().nonnegative(),
      transfers: z.number().int().nonnegative(),
      walkMeters: z.number().nonnegative(),
    })
    .nullable(),
  policy: z
    .object({
      primaryMode: z.enum(['transit', 'taxi', 'car', 'walk']),
      taxiRule: z.string(),
      estimatedDailyWalkKm: z.number(),
      estimatedDailyCostPerPersonKrw: z.number(),
      contingencyPerPersonKrw: z.number(),
    })
    .nullable(),
  accessibility: z.object({
    stairsRequired: z.boolean().nullable(),
    elevatorAvailable: z.boolean().nullable(),
    luggageFriendly: z.boolean().nullable(),
    wheelchairOk: z.boolean().nullable(),
    /** 접근성·막차는 fail-closed */
    verified: z.boolean().default(false),
  }),
  bookingUrl: z.string().url().nullable(),
});

export type TransportCandidate = z.infer<typeof transportCandidateSchema>;

export const candidateSchema = z.discriminatedUnion('kind', [
  flightCandidateSchema,
  hotelCandidateSchema,
  transportCandidateSchema,
]);

export type Candidate = z.infer<typeof candidateSchema>;

/**
 * LLM 컨텍스트에 들어가는 투영. 제공자 원본 JSON은 절대 포함하지 않는다.
 * 근거: agent-architecture.md 6.6, travel-mediation-plan.md 19.10
 */
export interface CandidateCard {
  id: string;
  headline: string;
  /** 쟁점 관련 속성만 추린 값 */
  attributes: Record<string, string | number | boolean | null>;
  evidenceIds: string[];
  confidenceBadge: 'live' | 'estimated' | 'needs_check';
  disqualifyReason: string | null;
}
