import { z } from 'zod';
import { confidenceLevels } from './planning.js';

/**
 * Data Gateway 요청 목적. 캐시 사용 여부를 결정하는 핵심 스위치다.
 * 근거: agent-architecture.md 6.2 / 6.5
 */
export const dataPurposes = ['exploration', 'verification', 'booking_readiness'] as const;
export type DataPurpose = (typeof dataPurposes)[number];

/**
 * MVP 검증·예약 준비 단계의 공통 신선도 정책.
 * exploration 단계의 장기 캐시는 허용하되 최종 확정에는 이 상한을 적용한다.
 */
export const verificationFreshnessPolicyV1 = {
  flightPriceInventorySec: 10 * 60,
  accommodationPriceInventorySec: 15 * 60,
  reservationAvailabilitySec: 30 * 60,
  operatingHoursSec: 24 * 60 * 60,
  transitTimetableSec: 24 * 60 * 60,
  estimatedTravelTimeSec: 6 * 60 * 60,
  placeIdentitySec: 7 * 24 * 60 * 60,
  mediaReputationSec: 7 * 24 * 60 * 60,
  priceChangeRecomparisonThresholdBp: 500,
  maxRevalidationAttempts: 2,
} as const;

export const finalRevalidationRequiredData = [
  'flight_price_inventory',
  'accommodation_price_inventory',
  'reservation_availability',
  'operating_hours',
  'transit_timetable',
  'estimated_travel_time',
] as const;
export type FinalRevalidationRequiredData =
  (typeof finalRevalidationRequiredData)[number];

export const failClosedMissingFields = [
  'price',
  'availability',
  'operatingStatus',
  'serviceDate',
  'operatingHours',
  'location',
  'allergySafety',
  'accessibility',
] as const;
export type FailClosedMissingField = (typeof failClosedMissingFields)[number];

export const queryClasses = [
  'flight.cheapest_date',
  'flight.offers_search',
  'flight.offer_price',
  'flight.group_inventory',
  'flight.risk',
  'ref.airport_codes',
  'ref.airline_codes',
  'ref.fx',
  'ref.pack_config',
  'transit.airport_transfer',
  'transit.route',
  'transit.last_train',
  'transit.pass_rules',
  'transit.accessibility_route',
  'transit.realtime_route',
  'intercity.timetable',
  'driving.fuel_toll',
  'hotel.area_profile',
  'hotel.search',
  'hotel.vacancy_price',
  'hotel.room_combination',
  'hotel.all_in_price',
  'hotel.details',
  'hotel.price_band',
  'poi.search',
  'poi.hours',
  'poi.ticket',
  'dining.search',
  'dining.hours',
  'dining.diet_support',
  'dining.reservation_slot',
  'geo.travel_time',
  'geo.matrix',
  'geo.place_details',
  'geo.geocode',
  'weather.forecast',
] as const;

export type QueryClass = (typeof queryClasses)[number];

export const dataGatewayRequestSchema = z.object({
  requestId: z.string(),
  runId: z.string(),
  roundId: z.string(),
  /** 'referee:accommodation' | 'orchestrator:date_resolver' 형태 */
  callerId: z.string(),
  queryClass: z.enum(queryClasses),
  purpose: z.enum(dataPurposes),
  packId: z.string(),
  params: z.record(z.string(), z.unknown()),
  /** 호출자가 정책보다 더 엄격한 신선도를 요구할 때만 지정 */
  maxStalenessSec: z.number().int().positive().optional(),
});

export type DataGatewayRequest = z.infer<typeof dataGatewayRequestSchema>;

export const evidenceSchema = z.object({
  evidenceId: z.string(),
  source: z.string(),
  retrievedAt: z.string().datetime(),
  validUntil: z.string().datetime().nullable(),
  confidence: z.enum(confidenceLevels),
  termsRef: z.string(),
  cacheHit: z.boolean(),
  degraded: z.boolean(),
  /** queryClass 정책이 부여한다. Agent가 정하지 않는다. */
  authorityTier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  fallbackReason: z.string().optional(),
});

export type Evidence = z.infer<typeof evidenceSchema>;

export const providerResultStatuses = ['SUCCESS', 'PARTIAL', 'FAILED'] as const;
export type ProviderResultStatus = (typeof providerResultStatuses)[number];

export const providerErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
export type ProviderError = z.infer<typeof providerErrorSchema>;

/** Provider Connector의 공통 반환 형식. API 원본 응답은 이 경계를 넘지 않는다. */
export interface ProviderResult<T> {
  status: ProviderResultStatus;
  provider: string;
  fetchedAt: string;
  expiresAt: string | null;
  data: T;
  evidenceIds: string[];
  missingFields: string[];
  errors: ProviderError[];
}

export interface DataGatewayResponse<T> {
  status: ProviderResultStatus;
  payload: T;
  evidence: Evidence;
  missingFields: string[];
  errors: ProviderError[];
  quota: { classCallsUsed: number; classCallsCap: number };
}

/** 도구 호출 상한 초과 시 심판은 현재 후보로 판결한다. 무한 재조회 금지. */
export class QuotaExceededError extends Error {
  constructor(
    readonly queryClass: QueryClass,
    readonly cap: number,
  ) {
    super(`quota exceeded for ${queryClass} (cap ${cap})`);
    this.name = 'QuotaExceededError';
  }
}

/**
 * fail-closed 클래스의 검증이 불가능할 때 사용한다.
 * 해당 후보는 winner / VERIFIED / BOOKABLE 로 승격할 수 없다.
 */
export class VerificationUnavailableError extends Error {
  constructor(
    readonly queryClass: QueryClass,
    readonly reason: string,
  ) {
    super(`verification unavailable for ${queryClass}: ${reason}`);
    this.name = 'VerificationUnavailableError';
  }
}
