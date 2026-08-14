import type { Candidate, DataRequest, QueryClass } from '@tm/contracts';
import type { ProviderAdapter, ProviderResult } from '../provider.js';
import { readParam } from '../provider-request.js';

/**
 * 데모 제공자 — API 키 없이 파이프라인을 끝까지 돌리기 위한 어댑터.
 *
 * 실제 제공자 어댑터와 **같은 인터페이스**를 만족하므로, 키가 생기면 이 어댑터를
 * 빼는 것만으로 실데이터로 전환된다. 게이트웨이·캐시·정책·심판은 전혀 바뀌지 않는다.
 *
 * 데이터가 가짜라는 사실을 숨기지 않는다:
 *   · 제공자 id가 `demo-fixture`이고 후보 id가 `demo_`로 시작한다
 *   · 이름에 "(데모)"가 붙는다
 *   · confidence가 항상 `estimated`이므로 화면 배지가 실데이터와 구분된다
 *   · 예약 URL이 없다 — 예약 행동을 유도할 수 없다
 *
 * 가격·시간은 요청 파라미터에서 결정론적으로 만든다. 같은 요청이면 같은 후보가
 * 나와야 재현 가능한 검증이 된다.
 */

/**
 * 데모가 채우는 슬롯.
 *
 * 앞의 6개는 실제 제공자가 있어도 키가 없을 때를 위한 폴백이고,
 * 뒤의 5개는 **2026-08-14 재조사 기준 무료 공급자가 아예 없는 슬롯**이다:
 *
 *   · `flight.offers_search`      Amadeus 종료(2026-07-17) 이후 무료 실운임 없음
 *   · `dining.reservation_slot`   HotPepper에 예약 슬롯 필드가 없음
 *   · `poi.hours`                 카카오 로컬·TourAPI 모두 영업시간을 안 줌
 *   · `transit.last_train`        막차 정보를 주는 무료 API 없음
 *   · 일본 `transit.route`        ODPT는 간사이 커버리지 없음, Google Routes는 결제 필요
 *
 * 이 슬롯들을 비워두면 오늘 발표에서 화면이 빈다. 그래서 채우되, 채웠다는 사실을
 * 숨기지 않는다 — 아래 어댑터의 모든 출력에 `demo_` id와 "(데모)" 이름이 붙고
 * confidence가 `estimated`이며 fail-closed 플래그는 하나도 올리지 않는다.
 */
const SUPPORTED: readonly QueryClass[] = [
  'flight.offers_search',
  'flight.cheapest_date',
  'transit.airport_transfer',
  'transit.route',
  'transit.last_train',
  'hotel.search',
  'hotel.vacancy_price',
  'hotel.room_combination',
  'poi.search',
  'poi.hours',
  'dining.search',
  'dining.hours',
  'dining.reservation_slot',
];

/** 문자열 → 결정론적 정수. 같은 요청이면 같은 값이 나온다 */
function hash(value: string): number {
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    total = (total * 31 + value.charCodeAt(index)) % 100_000;
  }
  return total;
}

const asString = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback;

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** 날짜에 시각을 붙인다. 날짜를 모르면 null을 그대로 둔다 */
function at(date: string | null, hour: number): string | null {
  if (date === null) return null;
  return `${date}T${String(hour).padStart(2, '0')}:00:00+09:00`;
}

function flights(request: DataRequest, now: string): Candidate[] {
  const params = request.params;
  const origin = asString(params['origin'], 'ICN');
  const destination = asString(params['destination'], 'KIX');
  const departureDate = typeof params['departureDate'] === 'string' ? params['departureDate'] : null;
  const returnDate = typeof params['returnDate'] === 'string' ? params['returnDate'] : null;
  const pax = asNumber(readParam(params, 'guests', ['pax']), 4);
  const seed = hash(`${origin}${destination}${departureDate ?? ''}`);

  return [0, 1, 2].map((index): Candidate => {
    const perPerson = 240_000 + ((seed + index * 47_000) % 180_000);
    const connections = index === 2 ? 1 : 0;
    const departHour = 8 + index * 4;

    return {
      kind: 'flight',
      id: `demo_flight_${index + 1}`,
      source: 'demo-fixture',
      fetchedAt: now,
      disqualified: false,
      disqualifyReason: null,
      outbound: {
        carrier: { code: ['KE', 'OZ', 'LJ'][index] ?? 'KE', name: `${['대한항공', '아시아나', '진에어'][index] ?? '대한항공'} (데모)` },
        flightNumber: `DM${100 + index}`,
        departure: { airport: origin, terminal: null, at: at(departureDate, departHour) ?? `${now}` },
        arrival: { airport: destination, terminal: null, at: at(departureDate, departHour + 2) ?? `${now}` },
        durationMin: 120 + connections * 90,
        connections,
      },
      inbound: {
        carrier: { code: ['KE', 'OZ', 'LJ'][index] ?? 'KE', name: `${['대한항공', '아시아나', '진에어'][index] ?? '대한항공'} (데모)` },
        flightNumber: `DM${200 + index}`,
        departure: { airport: destination, at: at(returnDate, 15) ?? `${now}` },
        arrival: { airport: origin, at: at(returnDate, 17) ?? `${now}` },
        durationMin: 120,
        connections: 0,
      },
      price: {
        amount: perPerson,
        currency: 'KRW',
        confidence: 'estimated',
        perPersonRoundTrip: perPerson,
        groupTotal: perPerson * pax,
      },
      baggage: {
        checkedIncluded: index !== 2,
        checkedKg: index === 2 ? null : 23,
        extraCheckedFeePerPerson: index === 2 ? 60_000 : null,
      },
      seatsAvailable: 9,
      // 데모 데이터는 그룹 재고를 확인해줄 수 없다. fail-closed로 남는다.
      groupInventoryVerified: false,
      effectiveTotal: {
        perPerson: index === 2 ? perPerson + 60_000 : perPerson,
        note: index === 2 ? '수하물 별도 6만원 포함' : '수하물 포함',
      },
      bookingUrl: null,
    };
  });
}

function hotels(request: DataRequest, now: string): Candidate[] {
  const params = request.params;
  const area = asString(params['area'], '중심가');
  const nights = asNumber(params['nights'], 2);
  const pax = asNumber(readParam(params, 'guests', ['pax']), 4);
  const seed = hash(`${area}${nights}`);

  const areas = ['난바', '우메다', '신사이바시'];

  return [0, 1, 2].map((index): Candidate => {
    const perNight = 70_000 + ((seed + index * 23_000) % 90_000);
    const total = perNight * nights;

    return {
      kind: 'hotel',
      id: `demo_hotel_${index + 1}`,
      source: 'demo-fixture',
      fetchedAt: now,
      disqualified: false,
      disqualifyReason: null,
      name: `${areas[index] ?? area} 스테이 (데모)`,
      type: index === 2 ? 'guesthouse' : 'hotel',
      location: {
        lat: 34.66 + index * 0.01,
        lng: 135.5 + index * 0.01,
        area: areas[index] ?? area,
        address: null,
      },
      price: {
        amount: total,
        currency: 'KRW',
        confidence: 'estimated',
        perNightPerPerson: perNight,
        totalPerPerson: total,
        groupTotal: total * pax,
        taxesIncluded: index !== 2,
      },
      meals: {
        breakfastIncluded: index === 0,
        dinnerIncluded: false,
        mealValuePerPersonPerNight: index === 0 ? 12_000 : null,
        effectiveLodgingCost: index === 0 ? total - 12_000 * nights : null,
        // 데모는 알레르기 대응을 확인해줄 수 없다.
        dietSupportVerified: false,
      },
      capacity: {
        maxGuests: index === 2 ? 4 : 6,
        roomOptions: [
          { config: '트윈 x2', totalGuests: 4, pricePerNight: perNight * 4 },
          { config: '트리플 x2', totalGuests: 6, pricePerNight: perNight * 6 },
        ].slice(0, index === 2 ? 1 : 2),
      },
      roomCombinationVerified: false,
      allInPriceVerified: false,
      amenities: ['wifi', index === 1 ? 'onsen' : 'laundry'],
      accessibility: {
        wheelchair: index === 0 ? true : null,
        elevator: index === 2 ? false : true,
        stepFree: index === 0 ? true : null,
      },
      locationMetrics: { station: { label: '가까운 역', minutes: 4 + index * 5 } },
      rating: { score: 8.6 - index * 0.7, count: 120 + index * 80 },
      cancelPolicy: { freeUntil: null, penaltyAfter: null },
      bookingUrl: null,
    };
  });
}

function transports(request: DataRequest, now: string): Candidate[] {
  const seed = hash(JSON.stringify(request.params));
  const variants: { label: string; mode: 'train' | 'express_bus' | 'taxi'; fare: number; minutes: number; transfers: number; walk: number }[] = [
    { label: '공항철도 + 지하철 (데모)', mode: 'train', fare: 1_200 + (seed % 800), minutes: 65, transfers: 1, walk: 450 },
    { label: '리무진 버스 (데모)', mode: 'express_bus', fare: 1_800 + (seed % 600), minutes: 80, transfers: 0, walk: 150 },
    { label: '택시 (데모)', mode: 'taxi', fare: 6_500 + (seed % 2_000), minutes: 45, transfers: 0, walk: 0 },
  ];

  return variants.map((variant, index): Candidate => ({
    kind: 'transport',
    id: `demo_transport_${index + 1}`,
    source: 'demo-fixture',
    fetchedAt: now,
    disqualified: false,
    disqualifyReason: null,
    variant: 'airport_transfer',
    label: variant.label,
    segments: [
      {
        mode: variant.mode,
        operator: null,
        from: '공항',
        to: '숙소 인근',
        departAt: null,
        arriveAt: null,
        durationMin: variant.minutes,
        farePerPersonKrw: variant.fare,
      },
    ],
    totals: {
      durationMin: variant.minutes,
      farePerPersonKrw: variant.fare,
      transfers: variant.transfers,
      walkMeters: variant.walk,
    },
    policy: null,
    accessibility: {
      stairsRequired: variant.mode === 'train' ? true : false,
      elevatorAvailable: variant.mode === 'train' ? true : null,
      luggageFriendly: variant.mode !== 'train',
      wheelchairOk: variant.mode === 'taxi' ? null : false,
      // 막차·접근성은 데모가 확인해줄 수 없다. fail-closed로 남는다.
      verified: false,
    },
    bookingUrl: null,
  }));
}

/**
 * 장소 목록. `poi.*` · `dining.*`은 정규화 Candidate 스키마가 없어서
 * 실제 제공자(TourAPI·카카오·HotPepper)와 같은 `places` 형태로 돌려준다.
 *
 * 영업시간을 데모가 채우는 이유: 무료 공급자 중 영업시간을 주는 곳이 없다.
 * 카카오 로컬은 place_url만, TourAPI는 자유서술, HotPepper만 `open`/`close`가 있다.
 */
function places(request: DataRequest, now: string): Record<string, unknown>[] {
  const dining = request.queryClass.startsWith('dining.');
  const area = asString(request.params['area'], '난바');
  const seed = hash(`${request.queryClass}${area}`);

  const dishes = ['오코노미야키', '라멘', '카이센동', '쿠시카츠'];
  const spots = ['오사카성', '도톤보리', '우메다 공중정원', '시텐노지'];
  const names = dining ? dishes : spots;

  return names.slice(0, 4).map((name, index) => ({
    externalId: `demo_${dining ? 'dining' : 'poi'}_${index + 1}`,
    name: `${name} (데모)`,
    address: `${area} 일대`,
    lat: 34.66 + index * 0.008,
    lng: 135.5 + index * 0.008,
    tel: null,
    category: dining ? '음식점' : '관광명소',
    // 실제 무료 공급자가 못 주는 값이다. 데모라서 채운다.
    openHours: dining ? '11:30-14:00, 17:30-22:00' : '09:00-17:00',
    closedDays: index === 3 ? '화요일' : '연중무휴',
    budgetBand: dining ? `${1_200 + ((seed + index * 300) % 1_800)}엔대` : null,
    totalSeats: dining ? 24 + ((seed + index) % 40) : null,
    partyCapacity: dining ? 8 + ((seed + index) % 12) : null,
    // 데모는 예약을 확인해줄 수 없다. 실제 제공자도 마찬가지다.
    reservationVerified: false,
    url: null,
    fetchedAt: now,
  }));
}

/**
 * 예약 슬롯. **무료 API로는 어디서도 얻을 수 없는 데이터다.**
 * HotPepper에도 예약 슬롯 필드가 없고 타베로그는 약관상 제외했다.
 * 발표에서 "몇 시에 몇 명 자리가 있다"를 보여주기 위한 순수 목업이다.
 */
function diningSlots(request: DataRequest, now: string): Record<string, unknown>[] {
  const pax = asNumber(readParam(request.params, 'guests', ['pax']), 4);
  const date = typeof request.params['date'] === 'string' ? request.params['date'] : null;
  const seed = hash(`${date ?? ''}${pax}`);

  return ['17:30', '18:30', '19:30', '20:30'].map((time, index) => ({
    externalId: `demo_slot_${index + 1}`,
    time,
    date,
    seatsForParty: pax,
    // 4개 중 하나는 만석으로 둔다 — 전부 가능하면 제약 검증이 아무것도 안 한다.
    available: (seed + index) % 4 !== 0,
    depositRequired: index >= 2,
    // 데모 슬롯으로 예약을 확정할 수 없다.
    reservationVerified: false,
    fetchedAt: now,
  }));
}

/**
 * 날짜별 최저가. Travelpayouts가 있으면 그쪽이 우선이고, 없을 때 이 데모가 채운다.
 * 실제 API와 같은 `quotes` 형태를 유지해 프리페치·심판 코드가 갈라지지 않게 한다.
 */
function flightQuotes(request: DataRequest, now: string): Record<string, unknown>[] {
  const origin = asString(request.params['origin'], 'ICN');
  const destination = asString(request.params['destination'], 'KIX');
  const base = typeof request.params['departureDate'] === 'string' ? request.params['departureDate'] : null;
  const seed = hash(`${origin}${destination}${base ?? ''}`);

  return [0, 1, 2, 3].map((index) => ({
    externalId: `demo_quote_${index + 1}`,
    origin,
    destination,
    pricePerPerson: 260_000 + ((seed + index * 31_000) % 150_000),
    currency: 'KRW',
    airline: ['KE', 'OZ', 'LJ', '7C'][index] ?? 'KE',
    flightNumber: `DM${300 + index}`,
    departureAt: base === null ? null : `${base}T${String(8 + index * 3).padStart(2, '0')}:00:00+09:00`,
    returnAt: null,
    expiresAt: null,
    seatsAvailable: null,
    // 데모도 실제 무료 API도 그룹 좌석을 확인해주지 못한다. 여기서 거짓말하지 않는다.
    groupInventoryVerified: false,
    fetchedAt: now,
  }));
}

/**
 * 데모 어댑터를 만든다.
 *
 * 실제 제공자와 함께 등록해도 된다 — `createStaticRegistry`가 Pack의 제공자
 * 우선순위를 따르므로, 실제 제공자가 성공하면 데모는 호출되지 않는다.
 */
export function createDemoProvider(): ProviderAdapter {
  return {
    id: 'demo-fixture',
    supports(queryClass) {
      return SUPPORTED.includes(queryClass);
    },
    async fetch(request): Promise<ProviderResult> {
      const now = new Date().toISOString();
      const queryClass = request.queryClass;

      // 정규화 Candidate가 되는 클래스와 그렇지 않은 클래스의 payload 키가 다르다.
      // 실제 제공자와 같은 형태를 유지해야 프리페치가 갈라지지 않는다.
      if (queryClass === 'flight.cheapest_date') {
        return result({ quotes: flightQuotes(request, now) });
      }
      if (queryClass === 'dining.reservation_slot') {
        return result({ slots: diningSlots(request, now) });
      }
      if (queryClass.startsWith('poi.') || queryClass.startsWith('dining.')) {
        const rows = places(request, now);
        return result({ places: rows, totalCount: rows.length });
      }

      const candidates = queryClass.startsWith('flight.')
        ? flights(request, now)
        : queryClass.startsWith('hotel.')
          ? hotels(request, now)
          : queryClass.startsWith('transit.')
            ? transports(request, now)
            : [];

      return result({ candidates });
    },
  };
}

/** 데모 응답의 공통 봉투. 어느 슬롯을 채우든 가짜라는 표시는 같다 */
function result(payload: Record<string, unknown>): ProviderResult {
  return {
    payload,
    // 데모 데이터는 절대 live가 아니다. 배지가 실데이터와 구분되어야 한다.
    confidence: 'estimated',
    validUntil: null,
    termsRef: 'demo-fixture (실제 데이터 아님)',
    rawRef: null,
    costUsd: 0,
  };
}

/**
 * 데모 제공자를 쓸 것인가.
 *
 * 기본은 **실제 키가 하나도 없을 때만** 켜진다. 키가 있는데도 데모가 섞이면
 * 어느 후보가 진짜인지 알 수 없게 된다. 강제로 켜려면 `USE_DEMO_PROVIDER=true`.
 */
export function shouldUseDemoProvider(
  env: NodeJS.ProcessEnv = process.env,
  realAdapterCount = 0,
): boolean {
  const flag = env['USE_DEMO_PROVIDER'];
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return realAdapterCount === 0;
}
