import type { QueryClass } from '@tm/contracts';

/**
 * Data Agent 인스턴스 정의. agent-architecture.md 2장의 인벤토리 표.
 *
 * "Data Agent"는 하나가 아니고 LLM도 아니다. 카테고리마다 하나씩, 8종이다.
 * 각 인스턴스가 하는 일은 두 가지뿐이다:
 *   1. 어떤 queryClass를 담당하는가
 *   2. 라운드당 몇 번까지 호출할 수 있는가 (6.7 도구 호출 상한)
 *
 * 실제 API 호출은 그 아래 제공자 어댑터가 한다 (provider.ts).
 * 게이트웨이 코드는 인스턴스 수와 무관하게 한 벌이다 (gateway.ts).
 */

export const dataAgentIds = [
  'FlightData',
  'TransportData',
  'AccommodationData',
  'ActivityData',
  'DiningData',
  'GeoData',
  'RefData',
  'WebData',
] as const;

export type DataAgentId = (typeof dataAgentIds)[number];

export interface DataAgentSpec {
  id: DataAgentId;
  queryClasses: readonly QueryClass[];
  /** 라운드당 클래스별 호출 상한. 초과 시 QuotaExceededError → 심판은 현재 후보로 판결한다 */
  quotaPerRound: Partial<Record<QueryClass, number>>;
}

export const dataAgents: Record<DataAgentId, DataAgentSpec> = {
  FlightData: {
    id: 'FlightData',
    queryClasses: [
      'flight.cheapest_date',
      'flight.offers_search',
      'flight.offer_price',
      'flight.group_inventory',
      'flight.risk',
    ],
    // 항공 심판 상한: search 3, price 2, 기타 각 2
    quotaPerRound: {
      'flight.cheapest_date': 2,
      'flight.offers_search': 3,
      'flight.offer_price': 2,
      'flight.group_inventory': 2,
      'flight.risk': 2,
    },
  },

  TransportData: {
    id: 'TransportData',
    queryClasses: [
      'transit.route',
      'transit.airport_transfer',
      'transit.last_train',
      'transit.pass_rules',
      'transit.accessibility_route',
      'transit.realtime_route',
      'intercity.timetable',
      'driving.fuel_toll',
    ],
    // 교통 심판 상한: get_route 8, evaluate_transit_passes 2, 기타 각 3
    quotaPerRound: {
      'transit.route': 8,
      'transit.airport_transfer': 3,
      'transit.last_train': 3,
      'transit.pass_rules': 2,
      'transit.accessibility_route': 3,
      'transit.realtime_route': 3,
      'intercity.timetable': 3,
      'driving.fuel_toll': 3,
    },
  },

  AccommodationData: {
    id: 'AccommodationData',
    queryClasses: [
      'hotel.area_profile',
      'hotel.search',
      'hotel.vacancy_price',
      'hotel.room_combination',
      'hotel.all_in_price',
      'hotel.details',
      'hotel.price_band',
    ],
    // 숙소 심판 상한: search_hotels 4, get_hotel_details 8, evaluate_split_stay 3
    quotaPerRound: {
      'hotel.area_profile': 3,
      'hotel.search': 4,
      'hotel.vacancy_price': 8,
      'hotel.room_combination': 8,
      'hotel.all_in_price': 8,
      'hotel.details': 8,
      'hotel.price_band': 4,
    },
  },

  ActivityData: {
    id: 'ActivityData',
    queryClasses: ['poi.search', 'poi.hours', 'poi.ticket', 'weather.forecast'],
    // TODO(activity): 담당 팀 구현서에서 확정한다 (agent-architecture 14장 1번).
    quotaPerRound: { 'poi.search': 4, 'poi.hours': 12, 'poi.ticket': 8, 'weather.forecast': 3 },
  },

  DiningData: {
    id: 'DiningData',
    queryClasses: [
      'dining.search',
      'dining.hours',
      'dining.diet_support',
      'dining.reservation_slot',
    ],
    // 알레르기 대응 확인은 후보 수만큼 필요하므로 상한을 넉넉히 둔다.
    quotaPerRound: {
      'dining.search': 4,
      'dining.hours': 12,
      'dining.diet_support': 16,
      'dining.reservation_slot': 8,
    },
  },

  GeoData: {
    id: 'GeoData',
    queryClasses: ['geo.travel_time', 'geo.matrix', 'geo.place_details', 'geo.geocode'],
    // 숙소 심판의 measure_location 12를 포함한다.
    quotaPerRound: {
      'geo.travel_time': 12,
      'geo.matrix': 2,
      'geo.place_details': 12,
      'geo.geocode': 12,
    },
  },

  RefData: {
    id: 'RefData',
    queryClasses: ['ref.fx', 'ref.airport_codes', 'ref.airline_codes', 'ref.pack_config'],
    quotaPerRound: {
      'ref.fx': 2,
      'ref.airport_codes': 4,
      'ref.airline_codes': 4,
      'ref.pack_config': 2,
    },
  },

  WebData: {
    id: 'WebData',
    queryClasses: ['web.search', 'web.page', 'kb.retrieve'],
    // 웹은 보조 채널이다. 후보 조달원이 아니므로 상한을 낮게 둔다 (6.9).
    quotaPerRound: { 'web.search': 3, 'web.page': 5, 'kb.retrieve': 8 },
  },
};

const OWNER_BY_CLASS = new Map<QueryClass, DataAgentId>(
  Object.values(dataAgents).flatMap((spec) =>
    spec.queryClasses.map((queryClass) => [queryClass, spec.id] as const),
  ),
);

export function ownerOf(queryClass: QueryClass): DataAgentId {
  const owner = OWNER_BY_CLASS.get(queryClass);
  if (owner === undefined) throw new Error(`담당 Data Agent가 없는 queryClass: ${queryClass}`);
  return owner;
}

export function quotaFor(queryClass: QueryClass): number {
  return dataAgents[ownerOf(queryClass)].quotaPerRound[queryClass] ?? 2;
}
