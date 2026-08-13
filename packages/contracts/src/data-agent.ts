import { z } from 'zod';
import { confidenceLevels } from './planning.js';

/**
 * Data Agent 요청 목적. 캐시 사용 여부를 결정하는 핵심 스위치다.
 * 근거: agent-architecture.md 6.2 / 6.5
 */
export const dataPurposes = ['exploration', 'verification', 'booking_readiness'] as const;
export type DataPurpose = (typeof dataPurposes)[number];

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
  /**
   * 웹 조달·RAG. 개인(페르소나) 에이전트는 이 클래스를 호출할 수 없다.
   * 웹검색도 심판이 Data Agent를 통해서만 조달하고, RAG는 캐시 DB 위에서 돈다.
   * 근거: agent-architecture.md 6.9 · survey-v3-proposal.md C4
   */
  'web.search',
  'web.page',
  'kb.retrieve',
] as const;

export type QueryClass = (typeof queryClasses)[number];

/**
 * 호출자 종류. 페르소나 에이전트는 Data Agent를 직접 호출하지 않는다 —
 * 후보 밖 항목 주장, 참여자 간 정보 비대칭, 인원수만큼 곱해지는 비용을 막는다.
 */
export const allowedCallerPrefixes = ['referee:', 'orchestrator:', 'supervisor:'] as const;

export function isAllowedCaller(callerId: string): boolean {
  return allowedCallerPrefixes.some((prefix) => callerId.startsWith(prefix));
}

/** 웹·RAG 결과는 사실 확정에 쓸 수 없다. 이 클래스는 예약·검증 판정의 근거가 되지 못한다. */
export const advisoryOnlyQueryClasses = ['web.search', 'web.page', 'kb.retrieve'] as const;

export function isAdvisoryOnly(queryClass: QueryClass): boolean {
  return (advisoryOnlyQueryClasses as readonly string[]).includes(queryClass);
}

export const dataRequestSchema = z.object({
  requestId: z.string(),
  runId: z.string(),
  roundId: z.string(),
  /**
   * 'referee:accommodation' | 'orchestrator:date_resolver' 형태.
   * 페르소나 에이전트(`persona:*`)는 조달 권한이 없다 — 그라운딩 경계다.
   */
  callerId: z.string().refine(isAllowedCaller, {
    message: 'Data Agent는 심판·오케스트레이터·Supervisor만 호출할 수 있습니다',
  }),
  queryClass: z.enum(queryClasses),
  purpose: z.enum(dataPurposes),
  packId: z.string(),
  params: z.record(z.string(), z.unknown()),
  /** 호출자가 정책보다 더 엄격한 신선도를 요구할 때만 지정 */
  maxStalenessSec: z.number().int().positive().optional(),
});

export type DataRequest = z.infer<typeof dataRequestSchema>;

export const evidenceSchema = z.object({
  evidenceId: z.string(),
  source: z.string(),
  retrievedAt: z.string().datetime(),
  validUntil: z.string().datetime().nullable(),
  confidence: z.enum(confidenceLevels),
  termsRef: z.string(),
  cacheHit: z.boolean(),
  degraded: z.boolean(),
  /** 웹·RAG 결과. 판정 근거가 될 수 없고 VERIFIED/BOOKABLE 승격에 쓸 수 없다 */
  advisory: z.boolean().default(false),
  fallbackReason: z.string().optional(),
});

export type Evidence = z.infer<typeof evidenceSchema>;

export interface DataResponse<T> {
  payload: T;
  evidence: Evidence;
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
