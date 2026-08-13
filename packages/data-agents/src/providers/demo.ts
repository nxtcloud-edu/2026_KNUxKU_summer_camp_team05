import type { Candidate, DataRequest, QueryClass } from '@tm/contracts';
import type { ProviderAdapter, ProviderResult } from '../provider.js';

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

const SUPPORTED: readonly QueryClass[] = [
  'flight.offers_search',
  'transit.airport_transfer',
  'transit.route',
  'hotel.search',
  'hotel.vacancy_price',
  'poi.search',
  'dining.search',
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
  const pax = asNumber(params['pax'], 4);
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
  const pax = asNumber(params['pax'], 4);
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
      const candidates =
        request.queryClass.startsWith('flight.')
          ? flights(request, now)
          : request.queryClass.startsWith('hotel.')
            ? hotels(request, now)
            : request.queryClass.startsWith('transit.')
              ? transports(request, now)
              : [];

      return {
        payload: { candidates },
        // 데모 데이터는 절대 live가 아니다. 배지가 실데이터와 구분되어야 한다.
        confidence: 'estimated',
        validUntil: null,
        termsRef: 'demo-fixture (실제 데이터 아님)',
        rawRef: null,
        costUsd: 0,
      };
    },
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
