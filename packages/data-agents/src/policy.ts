import type { Confidence, DataPurpose, QueryClass } from '@tm/contracts';

/**
 * queryClass 정책 카탈로그. agent-architecture.md 6.5 표를 코드로 옮긴 것이다.
 *
 * 이 파일은 로직이 아니라 **데이터**다. 캐시를 쓸지 말지, 얼마나 신선해야 하는지,
 * 검증 실패 시 후보를 승격시킬 수 있는지가 전부 여기서 결정된다.
 * 게이트웨이는 이 표를 읽을 뿐 예외를 두지 않는다.
 */

export type CacheMode = 'never' | 'ttl' | 'permanent' | 'pack';

export interface ClassPolicy {
  /** never = 저장도 조회도 하지 않는다. pack = Pack 갱신 주기를 따른다 */
  cache: CacheMode;
  ttlSec: number | null;
  /** 이 목적으로 호출되면 캐시를 우회하고 실시간 호출한다 */
  liveOnlyPurposes: readonly DataPurpose[];
  /** 목적별 최소 신뢰도. 미달이면 캐시 히트라도 재조회한다 */
  minConfidence: Record<DataPurpose, Confidence>;
  /** 검증 불가 시 후보를 winner/VERIFIED/BOOKABLE로 승격할 수 없다 */
  failClosed: boolean;
  /** 판정 근거가 될 수 없다. 웹·RAG (6.9) */
  advisory: boolean;
  /**
   * 캐시 키에 반드시 들어가야 하는 파라미터.
   * 인원수를 빼면 1인 기준 캐시를 6인 조회에 재사용해 재고 부족을 놓친다 (항공 4.1).
   */
  keyParams: readonly string[];
}

const HOUR = 3600;
const DAY = 24 * HOUR;

const CONF_ANY: Record<DataPurpose, Confidence> = {
  exploration: 'unknown',
  verification: 'estimated',
  booking_readiness: 'estimated',
};

const CONF_LIVE: Record<DataPurpose, Confidence> = {
  exploration: 'estimated',
  verification: 'live',
  booking_readiness: 'live',
};

const VERIFY_PURPOSES = ['verification', 'booking_readiness'] as const;
const ALL_PURPOSES = ['exploration', 'verification', 'booking_readiness'] as const;

/** 표를 짧게 쓰기 위한 빌더. 기본값은 "탐색·검증 모두 캐시 허용, 안전 축 아님" */
function policy(input: Partial<ClassPolicy> & { keyParams: readonly string[] }): ClassPolicy {
  return {
    cache: 'ttl',
    ttlSec: DAY,
    liveOnlyPurposes: [],
    minConfidence: CONF_ANY,
    failClosed: false,
    advisory: false,
    ...input,
  };
}

/** 캐시 금지 클래스. 확정가·그룹 재고·객실 조합·알레르기 대응 (D3) */
function never(keyParams: readonly string[], failClosed = false): ClassPolicy {
  return {
    cache: 'never',
    ttlSec: null,
    liveOnlyPurposes: ALL_PURPOSES,
    minConfidence: CONF_LIVE,
    failClosed,
    advisory: false,
    keyParams,
  };
}

export const CLASS_POLICY: Record<QueryClass, ClassPolicy> = {
  // ── 항공 (항공 심판 15.1) ────────────────────────────────────────────────
  'flight.cheapest_date': policy({ ttlSec: DAY, keyParams: ['origin', 'month'] }),
  'flight.offers_search': policy({
    ttlSec: 2 * HOUR,
    keyParams: ['origin', 'destination', 'departureDate', 'returnDate', 'pax', 'cabin'],
  }),
  'flight.offer_price': never(['offerId', 'pax']),
  'flight.group_inventory': never(['offerId', 'pax']),
  'flight.risk': policy({ ttlSec: 7 * DAY, keyParams: ['carrier', 'route', 'month'] }),

  // ── 참조 데이터 ──────────────────────────────────────────────────────────
  'ref.airport_codes': policy({ cache: 'permanent', ttlSec: null, keyParams: ['query'] }),
  'ref.airline_codes': policy({ cache: 'permanent', ttlSec: null, keyParams: ['query'] }),
  'ref.fx': policy({ ttlSec: 6 * HOUR, keyParams: ['pair'] }),
  'ref.pack_config': policy({ cache: 'pack', ttlSec: null, keyParams: ['packId'] }),

  // ── 교통 (교통 15 · 19.2) ────────────────────────────────────────────────
  'transit.airport_transfer': policy({ ttlSec: 30 * DAY, keyParams: ['airport', 'area', 'mode'] }),
  'transit.route': policy({ ttlSec: 7 * DAY, keyParams: ['from', 'to', 'mode', 'departAt'] }),
  'transit.last_train': policy({
    ttlSec: 30 * DAY,
    liveOnlyPurposes: VERIFY_PURPOSES,
    minConfidence: CONF_LIVE,
    keyParams: ['from', 'to'],
  }),
  'transit.pass_rules': policy({ cache: 'pack', ttlSec: null, keyParams: ['packId', 'passId'] }),
  'transit.accessibility_route': policy({
    ttlSec: 7 * DAY,
    liveOnlyPurposes: VERIFY_PURPOSES,
    minConfidence: CONF_LIVE,
    failClosed: true,
    keyParams: ['from', 'to', 'mode'],
  }),
  'transit.realtime_route': policy({
    ttlSec: HOUR,
    liveOnlyPurposes: VERIFY_PURPOSES,
    keyParams: ['from', 'to', 'departAt'],
  }),
  'intercity.timetable': policy({
    ttlSec: 7 * DAY,
    liveOnlyPurposes: VERIFY_PURPOSES,
    keyParams: ['origin', 'destination', 'date'],
  }),
  'driving.fuel_toll': policy({ ttlSec: DAY, keyParams: ['route'] }),

  // ── 숙소 (숙소 16 · 20.1 · 20.5) ────────────────────────────────────────
  'hotel.area_profile': policy({ cache: 'pack', ttlSec: null, keyParams: ['packId', 'area'] }),
  'hotel.search': policy({ ttlSec: 7 * DAY, keyParams: ['packId', 'area', 'type', 'guests'] }),
  'hotel.vacancy_price': policy({
    ttlSec: 2 * HOUR,
    liveOnlyPurposes: VERIFY_PURPOSES,
    minConfidence: CONF_LIVE,
    keyParams: ['hotelId', 'checkIn', 'checkOut', 'guests'],
  }),
  'hotel.room_combination': never(['hotelId', 'checkIn', 'checkOut', 'guests', 'rooms'], true),
  'hotel.all_in_price': never(['hotelId', 'checkIn', 'checkOut', 'guests', 'rooms']),
  'hotel.details': policy({ ttlSec: 30 * DAY, keyParams: ['hotelId'] }),
  /** 한국 숙박 데이터 공백 대응. 추정 밴드이므로 BOOKABLE 승격 금지 (숙소 20.5) */
  'hotel.price_band': policy({
    cache: 'ttl',
    ttlSec: 90 * DAY,
    minConfidence: CONF_ANY,
    failClosed: false,
    advisory: true,
    keyParams: ['packId', 'area', 'type', 'season'],
  }),

  // ── 관광지 (기획서 9.3 · 19.6) ──────────────────────────────────────────
  'poi.search': policy({ ttlSec: 7 * DAY, keyParams: ['packId', 'area', 'category'] }),
  'poi.hours': policy({
    ttlSec: DAY,
    liveOnlyPurposes: VERIFY_PURPOSES,
    minConfidence: CONF_LIVE,
    failClosed: true,
    keyParams: ['placeId', 'date'],
  }),
  'poi.ticket': policy({
    ttlSec: DAY,
    liveOnlyPurposes: VERIFY_PURPOSES,
    keyParams: ['placeId', 'date'],
  }),

  // ── 식사 (기획서 9.4 · 19.6) ────────────────────────────────────────────
  'dining.search': policy({ ttlSec: 7 * DAY, keyParams: ['packId', 'area', 'genre', 'pax'] }),
  'dining.hours': policy({ ttlSec: DAY, keyParams: ['placeId', 'date'] }),
  /** 알레르기 대응 확인. 어떤 경우에도 캐시로 통과할 수 없다 */
  'dining.diet_support': never(['placeId', 'allergens'], true),
  'dining.reservation_slot': policy({
    ttlSec: HOUR,
    liveOnlyPurposes: VERIFY_PURPOSES,
    minConfidence: CONF_LIVE,
    keyParams: ['placeId', 'datetime', 'pax'],
  }),

  // ── 지리 (교통 19.1 · 숙소 16) ──────────────────────────────────────────
  'geo.travel_time': policy({ ttlSec: 30 * DAY, keyParams: ['from', 'to', 'mode'] }),
  'geo.matrix': policy({ ttlSec: 30 * DAY, keyParams: ['packId', 'matrixVersion'] }),
  'geo.place_details': policy({ ttlSec: 30 * DAY, keyParams: ['placeId'] }),
  'geo.geocode': policy({ cache: 'permanent', ttlSec: null, keyParams: ['query'] }),

  'weather.forecast': policy({ ttlSec: 3 * HOUR, keyParams: ['area', 'date'] }),

  // ── 웹·RAG (6.9) — advisory 전용 ────────────────────────────────────────
  // 캐시에 쌓이고 uncertainties에는 오르지만, 후보를 만들거나 승격시키지 못한다.
  'web.search': policy({
    ttlSec: DAY,
    minConfidence: CONF_ANY,
    advisory: true,
    keyParams: ['packId', 'query'],
  }),
  'web.page': policy({ ttlSec: 7 * DAY, advisory: true, keyParams: ['url'] }),
  'kb.retrieve': policy({
    // 코퍼스는 pack_cache다. TTL은 원본 레코드에서 상속되므로 자체 만료가 없다.
    cache: 'ttl',
    ttlSec: HOUR,
    advisory: true,
    keyParams: ['packId', 'queryClass', 'query', 'embeddingVersion'],
  }),
};

/** 캐시를 조회·저장해도 되는가 */
export function isCacheable(policyEntry: ClassPolicy, purpose: DataPurpose): boolean {
  return policyEntry.cache !== 'never' && !policyEntry.liveOnlyPurposes.includes(purpose);
}

const CONFIDENCE_RANK: Record<Confidence, number> = { unknown: 0, estimated: 1, live: 2 };

export function meetsConfidence(
  policyEntry: ClassPolicy,
  purpose: DataPurpose,
  confidence: Confidence,
): boolean {
  return CONFIDENCE_RANK[confidence] >= CONFIDENCE_RANK[policyEntry.minConfidence[purpose]];
}
