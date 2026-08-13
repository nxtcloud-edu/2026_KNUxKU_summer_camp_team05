import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { candidateSchema, type DataRequest } from '@tm/contracts';
import { ProviderError } from '../provider.js';
import { createAmadeusProvider } from './amadeus.js';
import { createOdsayProvider } from './odsay.js';
import { createTourApiProvider } from './tourapi.js';
import { providersFromEnv } from './registry.js';
import { isoDurationToMinutes } from './http.js';

/**
 * 제공자 어댑터 계약 테스트.
 *
 * 실제 API는 키가 있어야 하고 호출마다 돈이 든다. 여기서는 응답 형태를 고정해두고
 * **정규화가 계약을 지키는지**만 본다: 없는 값을 지어내지 않는가, 스키마를 통과하는가,
 * fail-closed 플래그를 함부로 올리지 않는가.
 *
 * 실제 호출 검증은 키를 넣고 sandbox에서 별도로 한다 (README 개발·협업 기준).
 */

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

interface StubRoute {
  match: string;
  status?: number;
  body: unknown;
}

/** URL 조각으로 응답을 고르는 fetch 스텁. 호출 기록도 남긴다 */
function stubFetch(routes: StubRoute[]): { calls: string[] } {
  const calls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);
    const route = routes.find((candidate) => url.includes(candidate.match));
    if (route === undefined) throw new Error(`스텁에 없는 URL: ${url}`);

    return {
      ok: (route.status ?? 200) < 400,
      status: route.status ?? 200,
      async json() {
        return route.body;
      },
      async text() {
        return JSON.stringify(route.body);
      },
    } as Response;
  }) as typeof fetch;

  return { calls };
}

const request = (overrides: Partial<DataRequest>): DataRequest =>
  ({
    requestId: 'rq_1',
    runId: 'run_1',
    roundId: 'r_1a',
    callerId: 'referee:flight',
    queryClass: 'flight.offers_search',
    purpose: 'exploration',
    packId: 'jp-osaka',
    params: {},
    ...overrides,
  }) as DataRequest;

const TOKEN_ROUTE: StubRoute = {
  match: '/v1/security/oauth2/token',
  body: { access_token: 'tok_1', expires_in: 1799 },
};

const amadeusOffer = {
  id: '1',
  itineraries: [
    {
      duration: 'PT2H5M',
      segments: [
        {
          carrierCode: 'KE',
          number: '723',
          departure: { iataCode: 'ICN', terminal: '2', at: '2026-10-16T09:00:00' },
          arrival: { iataCode: 'KIX', terminal: '1', at: '2026-10-16T11:05:00' },
        },
      ],
    },
    {
      duration: 'PT2H10M',
      segments: [
        {
          carrierCode: 'KE',
          number: '724',
          departure: { iataCode: 'KIX', at: '2026-10-18T12:00:00' },
          arrival: { iataCode: 'ICN', at: '2026-10-18T14:10:00' },
        },
      ],
    },
  ],
  price: { grandTotal: '1980000', currency: 'KRW' },
  numberOfBookableSeats: 9,
  travelerPricings: [
    {
      price: { total: '330000' },
      fareDetailsBySegment: [{ includedCheckedBags: { quantity: 1 } }],
    },
  ],
};

test('ISO duration을 분으로 바꾼다', () => {
  assert.equal(isoDurationToMinutes('PT2H5M'), 125);
  assert.equal(isoDurationToMinutes('PT45M'), 45);
  assert.equal(isoDurationToMinutes(undefined), null);
});

test('Amadeus 항공 응답이 정규화 Candidate 스키마를 통과한다', async () => {
  stubFetch([
    TOKEN_ROUTE,
    { match: '/v2/shopping/flight-offers', body: { data: [amadeusOffer], dictionaries: { carriers: { KE: 'KOREAN AIR' } } } },
  ]);

  const provider = createAmadeusProvider({ clientId: 'id', clientSecret: 'secret' });
  const result = await provider.fetch(
    request({ params: { origin: 'ICN', destination: 'KIX', departureDate: '2026-10-16', returnDate: '2026-10-18', pax: 6 } }),
  );

  const candidates = (result.payload as { candidates: unknown[] }).candidates;
  assert.equal(candidates.length, 1);

  const parsed = candidateSchema.safeParse(candidates[0]);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues?.slice(0, 3)));
});

test('Amadeus: 그룹 재고를 확인했다고 말하지 않는다', async () => {
  stubFetch([
    TOKEN_ROUTE,
    { match: '/v2/shopping/flight-offers', body: { data: [amadeusOffer], dictionaries: {} } },
  ]);

  const provider = createAmadeusProvider({ clientId: 'id', clientSecret: 'secret' });
  const result = await provider.fetch(request({ params: { origin: 'ICN', destination: 'KIX', pax: 6 } }));
  const candidate = (result.payload as { candidates: Record<string, unknown>[] }).candidates[0];

  // 표기 좌석 수(9)가 있어도 fail-closed 확인은 별개다.
  assert.equal(candidate?.['seatsAvailable'], 9);
  assert.equal(candidate?.['groupInventoryVerified'], false);
});

test('Amadeus: 수하물 정보가 없으면 null이지 "미포함"이 아니다', async () => {
  const withoutBags = {
    ...amadeusOffer,
    travelerPricings: [{ price: { total: '330000' }, fareDetailsBySegment: [{}] }],
  };
  stubFetch([
    TOKEN_ROUTE,
    { match: '/v2/shopping/flight-offers', body: { data: [withoutBags], dictionaries: {} } },
  ]);

  const provider = createAmadeusProvider({ clientId: 'id', clientSecret: 'secret' });
  const result = await provider.fetch(request({ params: { origin: 'ICN', destination: 'KIX' } }));
  const candidate = (result.payload as { candidates: Record<string, unknown>[] }).candidates[0];

  assert.equal((candidate?.['baggage'] as Record<string, unknown>)['checkedIncluded'], null);
});

test('Amadeus: 왕복 정보가 없는 응답은 후보로 만들지 않는다', async () => {
  const oneWay = { ...amadeusOffer, itineraries: [amadeusOffer.itineraries[0]] };
  stubFetch([
    TOKEN_ROUTE,
    { match: '/v2/shopping/flight-offers', body: { data: [oneWay], dictionaries: {} } },
  ]);

  const provider = createAmadeusProvider({ clientId: 'id', clientSecret: 'secret' });
  const result = await provider.fetch(request({ params: { origin: 'ICN', destination: 'KIX' } }));

  assert.equal((result.payload as { candidates: unknown[] }).candidates.length, 0);
});

test('Amadeus: 토큰은 재사용한다', async () => {
  const stub = stubFetch([
    TOKEN_ROUTE,
    { match: '/v2/shopping/flight-offers', body: { data: [], dictionaries: {} } },
  ]);

  const provider = createAmadeusProvider({ clientId: 'id', clientSecret: 'secret' });
  await provider.fetch(request({ params: { origin: 'ICN', destination: 'KIX' } }));
  await provider.fetch(request({ params: { origin: 'ICN', destination: 'KIX' } }));

  const tokenCalls = stub.calls.filter((url) => url.includes('oauth2/token'));
  assert.equal(tokenCalls.length, 1);
});

test('Amadeus: 날짜별 최저가는 확정가가 아니라 estimated다', async () => {
  stubFetch([
    TOKEN_ROUTE,
    { match: '/v1/shopping/flight-dates', body: { data: [{ departureDate: '2026-10-16', price: { total: '310000' } }] } },
  ]);

  const provider = createAmadeusProvider({ clientId: 'id', clientSecret: 'secret' });
  const result = await provider.fetch(
    request({ queryClass: 'flight.cheapest_date', params: { origin: 'ICN', destination: 'KIX', departureDate: '2026-10' } }),
  );

  assert.equal(result.confidence, 'estimated');
});

test('HTTP 5xx는 재시도 가능, 4xx는 아니다', async () => {
  stubFetch([TOKEN_ROUTE, { match: '/v2/shopping/flight-offers', status: 503, body: { error: 'down' } }]);
  const provider = createAmadeusProvider({ clientId: 'id', clientSecret: 'secret' });

  await assert.rejects(
    provider.fetch(request({ params: { origin: 'ICN' } })),
    (error: ProviderError) => error.retryable === true,
  );

  stubFetch([TOKEN_ROUTE, { match: '/v2/shopping/flight-offers', status: 400, body: { error: 'bad' } }]);
  await assert.rejects(
    provider.fetch(request({ params: { origin: 'ICN' } })),
    (error: ProviderError) => error.retryable === false,
  );
});

const odsayPath = {
  info: {
    totalTime: 52,
    payment: 1450,
    busTransitCount: 1,
    subwayTransitCount: 1,
    totalWalk: 620,
    firstStartStation: '서울역',
    lastEndStation: '강릉역',
  },
  subPath: [
    { trafficType: 3, sectionTime: 5, startName: '출발', endName: '서울역' },
    { trafficType: 1, sectionTime: 40, startName: '서울역', endName: '청량리', lane: [{ name: '1호선' }] },
  ],
};

const odsayParams = { startX: 127.02, startY: 37.5, endX: 128.9, endY: 37.76 };

test('ODsay 경로가 정규화 Candidate 스키마를 통과한다', async () => {
  stubFetch([{ match: 'searchPubTransPathT', body: { result: { path: [odsayPath] } } }]);

  const provider = createOdsayProvider({ apiKey: 'key' });
  const result = await provider.fetch(
    request({ queryClass: 'transit.route', roundId: 'r_1b', params: odsayParams }),
  );

  const candidates = (result.payload as { candidates: unknown[] }).candidates;
  const parsed = candidateSchema.safeParse(candidates[0]);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues?.slice(0, 3)));
});

test('ODsay: 접근성은 확인했다고 말하지 않는다', async () => {
  stubFetch([{ match: 'searchPubTransPathT', body: { result: { path: [odsayPath] } } }]);

  const provider = createOdsayProvider({ apiKey: 'key' });
  const result = await provider.fetch(
    request({ queryClass: 'transit.route', roundId: 'r_1b', params: odsayParams }),
  );
  const candidate = (result.payload as { candidates: Record<string, unknown>[] }).candidates[0];
  const accessibility = candidate?.['accessibility'] as Record<string, unknown>;

  assert.equal(accessibility['verified'], false);
  assert.equal(accessibility['stairsRequired'], null, '모르는 것은 null이다');
});

test('ODsay: 200으로 오는 오류 본문을 잡는다', async () => {
  stubFetch([{ match: 'searchPubTransPathT', body: { error: { code: '-8', msg: '요청 값 오류' } } }]);

  const provider = createOdsayProvider({ apiKey: 'key' });
  await assert.rejects(
    provider.fetch(request({ queryClass: 'transit.route', roundId: 'r_1b', params: odsayParams })),
    /요청 값 오류/,
  );
});

test('ODsay: 좌표가 없으면 호출하지 않는다', async () => {
  stubFetch([{ match: 'searchPubTransPathT', body: {} }]);

  const provider = createOdsayProvider({ apiKey: 'key' });
  await assert.rejects(
    provider.fetch(request({ queryClass: 'transit.route', roundId: 'r_1b', params: { startX: 127 } })),
    /필수 파라미터 누락/,
  );
});

test('TourAPI: 정규화 후보가 아니라 장소 목록을 준다', async () => {
  stubFetch([
    {
      match: 'areaBasedList1',
      body: {
        response: {
          header: { resultCode: '0000' },
          body: { totalCount: 1, items: { item: [{ contentid: '126508', title: '경포해변', addr1: '강릉시', mapx: '128.9', mapy: '37.79' }] } },
        },
      },
    },
  ]);

  const provider = createTourApiProvider({ serviceKey: 'key' });
  const result = await provider.fetch(
    request({ queryClass: 'poi.search', roundId: 'r_3', params: { areaCode: 32 } }),
  );
  const payload = result.payload as { places: Record<string, unknown>[] };

  assert.equal(payload.places.length, 1);
  assert.equal(payload.places[0]?.['externalId'], '126508');
  assert.equal(payload.places[0]?.['lat'], 37.79);
  assert.equal('candidates' in (result.payload as object), false, '스키마 밖이므로 후보로 올리지 않는다');
});

test('TourAPI: 200으로 오는 인증 실패를 잡는다', async () => {
  stubFetch([
    { match: 'areaBasedList1', body: { response: { header: { resultCode: '30', resultMsg: 'SERVICE KEY IS NOT REGISTERED' } } } },
  ]);

  const provider = createTourApiProvider({ serviceKey: 'wrong' });
  await assert.rejects(
    provider.fetch(request({ queryClass: 'poi.search', roundId: 'r_3', params: {} })),
    /SERVICE KEY/,
  );
});

test('TourAPI: 결과가 없으면 빈 문자열로 오는 items를 견딘다', async () => {
  stubFetch([
    { match: 'areaBasedList1', body: { response: { header: { resultCode: '0000' }, body: { totalCount: 0, items: '' } } } },
  ]);

  const provider = createTourApiProvider({ serviceKey: 'key' });
  const result = await provider.fetch(request({ queryClass: 'poi.search', roundId: 'r_3', params: {} }));

  assert.deepEqual((result.payload as { places: unknown[] }).places, []);
});

test('키가 없는 제공자는 만들지 않고 무엇이 빠졌는지 보고한다', () => {
  const setup = providersFromEnv({} as NodeJS.ProcessEnv);

  assert.equal(setup.adapters.length, 0);
  assert.deepEqual(
    setup.missing.map((row) => row.id),
    ['amadeus', 'odsay', 'tourapi'],
  );
  assert.ok(setup.missing[0]?.envVars.includes('AMADEUS_CLIENT_ID'));
});

test('키가 있으면 레지스트리에 실린다', () => {
  const setup = providersFromEnv({ ODSAY_API_KEY: 'key' } as NodeJS.ProcessEnv);

  assert.deepEqual(
    setup.adapters.map((adapter) => adapter.id),
    ['odsay'],
  );
  const chain = setup.registry().resolve('kr-gangneung', 'transit.route');
  assert.equal(chain[0]?.id, 'odsay');
});
