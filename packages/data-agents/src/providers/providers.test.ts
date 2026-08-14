import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { candidateSchema, type DataRequest } from '@tm/contracts';
import { ProviderError } from '../provider.js';
import { createHotPepperProvider } from './hotpepper.js';
import { createKakaoProvider } from './kakao.js';
import { createOdsayProvider } from './odsay.js';
import { createRakutenProvider } from './rakuten.js';
import { createTourApiProvider } from './tourapi.js';
import { createTravelpayoutsProvider } from './travelpayouts.js';
import { providersFromEnv } from './registry.js';
import { isoDurationToMinutes } from './http.js';

/**
 * 제공자 어댑터 계약 테스트.
 *
 * 실제 API는 키가 있어야 하고 호출마다 쿼터를 쓴다. 여기서는 응답 형태를 고정해두고
 * **정규화가 계약을 지키는지**만 본다: 없는 값을 지어내지 않는가, 스키마를 통과하는가,
 * fail-closed 플래그를 함부로 올리지 않는가.
 *
 * 실제 호출 검증은 키를 넣고 별도로 한다 (README 개발·협업 기준).
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
    queryClass: 'flight.cheapest_date',
    purpose: 'exploration',
    packId: 'jp-osaka',
    params: {},
    ...overrides,
  }) as DataRequest;

const payloadOf = <T>(result: { payload: unknown }, key: string): T =>
  (result.payload as Record<string, T>)[key] as T;

test('ISO duration을 분으로 바꾼다', () => {
  assert.equal(isoDurationToMinutes('PT2H5M'), 125);
  assert.equal(isoDurationToMinutes('PT45M'), 45);
  assert.equal(isoDurationToMinutes(undefined), null);
});

// ── 라쿠텐 트래블 ────────────────────────────────────────────────────────────

/**
 * 실호출로 확인한 응답 형태 (2026-08-14, VacantHotelSearch).
 *
 * 두 가지가 직관과 다르다.
 *   1. 좌표가 **십진 도**다. 초(秒)가 아니다.
 *   2. `roomInfo`는 한 칸에 플랜과 요금이 같이 있지 않고
 *      `[{roomBasicInfo}, {dailyCharge}]`처럼 번갈아 온다.
 */
const rakutenHotel = {
  hotel: [
    {
      hotelBasicInfo: {
        hotelNo: 191842,
        hotelName: 'アパホテル＆リゾート〈大阪なんば駅前タワー〉',
        latitude: 34.66605673472163,
        longitude: 135.49597188561378,
        address1: '大阪府',
        address2: '大阪市浪速区湊町1-2-13',
        nearestStation: 'ＪＲ難波',
        reviewAverage: 4.34,
        reviewCount: 2048,
      },
    },
    {
      roomInfo: [
        {
          roomBasicInfo: {
            roomClass: 'tr',
            roomName: 'スタンダードトリプルルーム 全室禁煙',
            planId: 5940730,
            planName: '【素泊まり・事前決済限定】非接触1秒チェックイン体験',
            withBreakfastFlag: 0,
            withDinnerFlag: 0,
            reserveUrl: 'https://img.travel.rakuten.co.jp/image/tr/api/re/IdsCY/?f_no=191842',
          },
        },
        {
          dailyCharge: { stayDate: '2026-10-13', rakutenCharge: 7650, total: 22950, chargeFlag: 0 },
        },
      ],
    },
  ],
};

const rakutenParams = {
  checkinDate: '2026-10-16',
  checkoutDate: '2026-10-19',
  adultNum: 3,
  roomNum: 1,
};

test('라쿠텐 공실 응답이 정규화 Candidate 스키마를 통과한다', async () => {
  stubFetch([{ match: 'VacantHotelSearch', body: { hotels: [rakutenHotel] } }]);

  const provider = createRakutenProvider({ applicationId: 'app', accessKey: 'ak' });
  const result = await provider.fetch(
    request({ queryClass: 'hotel.vacancy_price', roundId: 'r_2', params: rakutenParams }),
  );

  const candidates = payloadOf<unknown[]>(result, 'candidates');
  assert.equal(candidates.length, 1);

  const parsed = candidateSchema.safeParse(candidates[0]);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues?.slice(0, 3)));
});

test('라쿠텐: 좌표는 십진 도 그대로다', async () => {
  const stub = stubFetch([{ match: 'VacantHotelSearch', body: { hotels: [rakutenHotel] } }]);

  const provider = createRakutenProvider({ applicationId: 'app', accessKey: 'ak' });
  const result = await provider.fetch(
    request({
      queryClass: 'hotel.vacancy_price',
      roundId: 'r_2',
      params: { ...rakutenParams, latitude: 34.6659, longitude: 135.5017, searchRadius: 2 },
    }),
  );

  // 요청에 3600을 곱하면 wrong_parameter로 거절당한다.
  assert.match(stub.calls[0] ?? '', /latitude=34\.6659/);
  const location = payloadOf<Record<string, unknown>[]>(result, 'candidates')[0]?.['location'] as Record<string, number>;
  // 응답도 도 단위다. 3600으로 나누면 적도 근처로 무너진다.
  assert.ok(Math.abs(location['lat']! - 34.666) < 0.01, `lat=${location['lat']}`);
  assert.ok(Math.abs(location['lng']! - 135.496) < 0.01, `lng=${location['lng']}`);
});

test('라쿠텐: roomBasicInfo와 dailyCharge가 따로 오는 배열을 짝지운다', async () => {
  stubFetch([{ match: 'VacantHotelSearch', body: { hotels: [rakutenHotel] } }]);

  const provider = createRakutenProvider({ applicationId: 'app', accessKey: 'ak' });
  const result = await provider.fetch(
    request({ queryClass: 'hotel.vacancy_price', roundId: 'r_2', params: rakutenParams }),
  );
  const candidate = payloadOf<Record<string, unknown>[]>(result, 'candidates')[0];

  // 한 칸에 둘 다 있다고 가정하면 후보가 0건이 된다.
  assert.notEqual(candidate, undefined, '짝짓기에 실패하면 후보가 사라진다');
  const rooms = (candidate?.['capacity'] as Record<string, unknown>)['roomOptions'] as { config: string }[];
  assert.equal(rooms.length, 1);
  assert.match(rooms[0]?.config ?? '', /トリプル/);
});

test('라쿠텐: chargeFlag=0은 1실당 요금이라 인원수로 곱하지 않는다', async () => {
  stubFetch([{ match: 'VacantHotelSearch', body: { hotels: [rakutenHotel] } }]);

  const provider = createRakutenProvider({ applicationId: 'app', accessKey: 'ak' });
  const result = await provider.fetch(
    request({ queryClass: 'hotel.vacancy_price', roundId: 'r_2', params: rakutenParams }),
  );
  const price = payloadOf<Record<string, unknown>[]>(result, 'candidates')[0]?.['price'] as Record<string, number>;

  // 1실 22,950엔 × 1실 = 22,950엔. 3명이라고 68,850엔이 되면 안 된다.
  assert.equal(price['groupTotal'], 22_950);
  assert.equal(price['totalPerPerson'], 7_650);
  // 3박이므로 1인 1박 2,550엔.
  assert.equal(price['perNightPerPerson'], 2_550);
});

test('라쿠텐: 정확한 인원·객실로 물었을 때만 객실 조합을 확인했다고 한다', async () => {
  stubFetch([{ match: 'VacantHotelSearch', body: { hotels: [rakutenHotel] } }]);
  const provider = createRakutenProvider({ applicationId: 'app', accessKey: 'ak' });

  const exact = await provider.fetch(
    request({ queryClass: 'hotel.room_combination', roundId: 'r_2', params: rakutenParams }),
  );
  assert.equal(
    payloadOf<Record<string, unknown>[]>(exact, 'candidates')[0]?.['roomCombinationVerified'],
    true,
  );

  stubFetch([{ match: 'VacantHotelSearch', body: { hotels: [rakutenHotel] } }]);
  const vague = await provider.fetch(
    request({
      queryClass: 'hotel.search',
      roundId: 'r_2',
      params: { checkinDate: '2026-10-16', checkoutDate: '2026-10-19' },
    }),
  );
  assert.equal(
    payloadOf<Record<string, unknown>[]>(vague, 'candidates')[0]?.['roomCombinationVerified'],
    false,
    '인원을 안 주고 물었으면 확인된 것이 아니다',
  );
});

test('라쿠텐: 취소 조건은 응답에 없으므로 null이고 총액도 확정하지 않는다', async () => {
  stubFetch([{ match: 'VacantHotelSearch', body: { hotels: [rakutenHotel] } }]);

  const provider = createRakutenProvider({ applicationId: 'app', accessKey: 'ak' });
  const result = await provider.fetch(
    request({ queryClass: 'hotel.vacancy_price', roundId: 'r_2', params: rakutenParams }),
  );
  const candidate = payloadOf<Record<string, unknown>[]>(result, 'candidates')[0]!;
  const cancel = candidate['cancelPolicy'] as Record<string, unknown>;

  assert.equal(cancel['freeUntil'], null);
  assert.equal(cancel['penaltyAfter'], null);
  assert.equal(candidate['allInPriceVerified'], false, '취소 조건 없이 총액을 확정할 수 없다');
});

test('라쿠텐: 공실 없음(404)은 오류가 아니라 빈 결과다', async () => {
  stubFetch([
    { match: 'VacantHotelSearch', status: 404, body: { error: 'not_found', error_description: 'vacant_room_not_found' } },
  ]);

  const provider = createRakutenProvider({ applicationId: 'app', accessKey: 'ak' });
  const result = await provider.fetch(
    request({ queryClass: 'hotel.vacancy_price', roundId: 'r_2', params: rakutenParams }),
  );

  assert.deepEqual(payloadOf<unknown[]>(result, 'candidates'), []);
});

test('라쿠텐: 2026 개편 엔드포인트와 accessKey를 쓴다', async () => {
  const stub = stubFetch([{ match: 'VacantHotelSearch', body: { hotels: [rakutenHotel] } }]);

  const provider = createRakutenProvider({ applicationId: 'app', accessKey: 'ak' });
  await provider.fetch(
    request({ queryClass: 'hotel.vacancy_price', roundId: 'r_2', params: rakutenParams }),
  );

  const url = stub.calls[0] ?? '';
  // 구 도메인은 2026-05-14에 폐지됐다. 폴백하지 않는다.
  assert.match(url, /openapi\.rakuten\.co\.jp/);
  assert.doesNotMatch(url, /app\.rakuten\.co\.jp/);
  assert.match(url, /accessKey=ak/, '앱 ID만으로는 호출되지 않는다');
});

test('라쿠텐: Web 앱 타입이면 등록 도메인과 같은 Referer를 보낸다', async () => {
  let sentReferer: string | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sentReferer = (init?.headers as Record<string, string> | undefined)?.['referer'];
    return {
      ok: true,
      status: 200,
      async json() {
        return { hotels: [rakutenHotel] };
      },
      async text() {
        return '';
      },
    } as Response;
  }) as typeof fetch;

  const provider = createRakutenProvider({
    applicationId: 'app',
    accessKey: 'ak',
    referer: 'http://localhost/',
  });
  await provider.fetch(
    request({ queryClass: 'hotel.vacancy_price', roundId: 'r_2', params: rakutenParams }),
  );

  // Referer는 브라우저 전용이 아니다. 서버에서도 붙일 수 있어 Web 앱 타입을 쓸 수 있다.
  assert.equal(sentReferer, 'http://localhost/');
});

test('라쿠텐: 서버 앱 타입이면 Referer를 붙이지 않는다', async () => {
  let hadReferer = true;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    hadReferer = 'referer' in ((init?.headers as Record<string, string> | undefined) ?? {});
    return {
      ok: true,
      status: 200,
      async json() {
        return { hotels: [] };
      },
      async text() {
        return '';
      },
    } as Response;
  }) as typeof fetch;

  const provider = createRakutenProvider({ applicationId: 'app', accessKey: 'ak', referer: null });
  await provider.fetch(
    request({ queryClass: 'hotel.vacancy_price', roundId: 'r_2', params: rakutenParams }),
  );

  assert.equal(hadReferer, false, '서버 앱 타입은 IP로 검사한다');
});

test('라쿠텐: Referer 없이 Webアプリ 403이 오면 무엇을 넣어야 하는지 알려준다', async () => {
  stubFetch([
    {
      match: 'VacantHotelSearch',
      status: 403,
      body: { errorCode: 403, errorMessage: 'REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING' },
    },
  ]);

  const provider = createRakutenProvider({ applicationId: 'app', accessKey: 'ak' });
  await assert.rejects(
    provider.fetch(request({ queryClass: 'hotel.vacancy_price', roundId: 'r_2', params: rakutenParams })),
    /RAKUTEN_REFERER/,
  );
});

test('라쿠텐: 허용되지 않은 IP의 403도 원인을 알려준다', async () => {
  stubFetch([
    { match: 'VacantHotelSearch', status: 403, body: { errorCode: 403, errorMessage: 'CLIENT_IP_NOT_ALLOWED' } },
  ]);

  const provider = createRakutenProvider({ applicationId: 'app', accessKey: 'ak' });
  await assert.rejects(
    provider.fetch(request({ queryClass: 'hotel.vacancy_price', roundId: 'r_2', params: rakutenParams })),
    /ipify|허용 IP/,
  );
});

test('라쿠텐: accessKey가 없으면 어댑터를 만들지 않는다', () => {
  const setup = providersFromEnv({ RAKUTEN_APPLICATION_ID: 'app' } as NodeJS.ProcessEnv);

  assert.deepEqual(setup.adapters, [], '앱 ID만으로는 2026 개편 이후 호출되지 않는다');
  assert.ok(
    setup.missing.find((row) => row.id === 'rakuten_travel')?.envVars.includes('RAKUTEN_ACCESS_KEY'),
  );
});

test('라쿠텐: 날짜가 없으면 오늘로 채우지 않고 거절한다', async () => {
  stubFetch([{ match: 'VacantHotelSearch', body: { hotels: [] } }]);

  const provider = createRakutenProvider({ applicationId: 'app', accessKey: 'ak' });
  await assert.rejects(
    provider.fetch(request({ queryClass: 'hotel.vacancy_price', roundId: 'r_2', params: { adultNum: 3 } })),
    /필수 파라미터 누락/,
  );
});

// ── HotPepper ────────────────────────────────────────────────────────────────

const hotpepperShop = {
  id: 'J001234567',
  name: '串カツ田中 難波店',
  address: '大阪府大阪市中央区難波',
  station_name: '難波',
  lat: 34.6659,
  lng: 135.5017,
  genre: { code: 'G008', name: '居酒屋' },
  budget: { code: 'B002', name: '2001~3000円', average: '2500円' },
  capacity: 48,
  party_capacity: 20,
  open: '月～金 17:00～23:00',
  close: '火',
  private_room: 'あり',
  non_smoking: 'あり（全席禁煙）',
  course: 'あり',
  card: '利用可',
  urls: { pc: 'https://example.test/shop' },
};

test('HotPepper: 총 좌석수와 연회 정원을 구분해 남긴다', async () => {
  stubFetch([{ match: 'hotpepper/gourmet', body: { results: { results_available: 1, shop: [hotpepperShop] } } }]);

  const provider = createHotPepperProvider({ apiKey: 'key' });
  const result = await provider.fetch(
    request({ queryClass: 'dining.search', roundId: 'r_4', params: { largeArea: 'Z011', pax: 3 } }),
  );
  const place = payloadOf<Record<string, unknown>[]>(result, 'places')[0]!;

  assert.equal(place['totalSeats'], 48, '총 좌석수');
  assert.equal(place['partyCapacity'], 20, '최대 연회 인원');
  assert.equal(place['reservationVerified'], false, '예약 슬롯 필드가 없으므로 확인할 수 없다');
  assert.equal('candidates' in (result.payload as object), false, '스키마 밖이므로 후보로 올리지 않는다');
});

test('HotPepper: 예약 슬롯 클래스를 지원한다고 말하지 않는다', () => {
  const provider = createHotPepperProvider({ apiKey: 'key' });

  assert.equal(provider.supports('dining.search'), true);
  assert.equal(provider.supports('dining.reservation_slot'), false);
});

test('HotPepper: 크레딧 표시 의무를 termsRef에 남긴다', async () => {
  stubFetch([{ match: 'hotpepper/gourmet', body: { results: { shop: [hotpepperShop] } } }]);

  const provider = createHotPepperProvider({ apiKey: 'key' });
  const result = await provider.fetch(request({ queryClass: 'dining.search', roundId: 'r_4', params: {} }));

  assert.match(result.termsRef ?? '', /크레딧 표시 의무/);
});

test('HotPepper: 빈 문자열 숫자 필드를 0으로 만들지 않는다', async () => {
  const noCapacity = { ...hotpepperShop, capacity: '', party_capacity: '' };
  stubFetch([{ match: 'hotpepper/gourmet', body: { results: { shop: [noCapacity] } } }]);

  const provider = createHotPepperProvider({ apiKey: 'key' });
  const result = await provider.fetch(request({ queryClass: 'dining.search', roundId: 'r_4', params: {} }));
  const place = payloadOf<Record<string, unknown>[]>(result, 'places')[0]!;

  assert.equal(place['totalSeats'], null, '모르는 것은 0이 아니라 null이다');
});

test('HotPepper: 200으로 오는 오류 본문을 잡는다', async () => {
  stubFetch([
    { match: 'hotpepper/gourmet', body: { results: { error: [{ code: '2000', message: 'APIキーが不正です' }] } } },
  ]);

  const provider = createHotPepperProvider({ apiKey: 'wrong' });
  await assert.rejects(
    provider.fetch(request({ queryClass: 'dining.search', roundId: 'r_4', params: {} })),
    /APIキー/,
  );
});

// ── Travelpayouts ────────────────────────────────────────────────────────────

const travelpayoutsBody = {
  success: true,
  currency: 'krw',
  data: {
    KIX: {
      '0': { price: 289_000, airline: 'LJ', flight_number: 231, departure_at: '2026-10-16T09:10:00Z', expires_at: '2026-08-15T00:00:00Z' },
      '1': { price: 341_000, airline: 'KE', flight_number: 723, departure_at: '2026-10-16T13:00:00Z', expires_at: '2026-08-16T00:00:00Z' },
    },
  },
};

test('Travelpayouts: 캐시 가격은 estimated이고 후보가 아니다', async () => {
  stubFetch([{ match: 'prices/cheap', body: travelpayoutsBody }]);

  const provider = createTravelpayoutsProvider({ token: 'tok' });
  const result = await provider.fetch(
    request({ params: { origin: 'ICN', destination: 'KIX', departureDate: '2026-10' } }),
  );

  assert.equal(result.confidence, 'estimated');
  assert.equal('candidates' in (result.payload as object), false, 'Candidate 스키마를 채울 수 없다');
  assert.equal(payloadOf<unknown[]>(result, 'quotes').length, 2);
});

test('Travelpayouts: 싼 순으로 주고 그룹 재고를 확인했다고 하지 않는다', async () => {
  stubFetch([{ match: 'prices/cheap', body: travelpayoutsBody }]);

  const provider = createTravelpayoutsProvider({ token: 'tok' });
  const result = await provider.fetch(request({ params: { origin: 'ICN', destination: 'KIX' } }));
  const quotes = payloadOf<Record<string, unknown>[]>(result, 'quotes');

  assert.equal(quotes[0]?.['pricePerPerson'], 289_000);
  assert.equal(quotes[0]?.['seatsAvailable'], null);
  assert.equal(quotes[0]?.['groupInventoryVerified'], false);
});

test('Travelpayouts: 가장 이른 만료 시각을 validUntil로 쓴다', async () => {
  stubFetch([{ match: 'prices/cheap', body: travelpayoutsBody }]);

  const provider = createTravelpayoutsProvider({ token: 'tok' });
  const result = await provider.fetch(request({ params: { origin: 'ICN', destination: 'KIX' } }));

  assert.equal(result.validUntil, '2026-08-15T00:00:00Z');
});

test('Travelpayouts: 예약 가능성 클래스를 지원한다고 말하지 않는다', () => {
  const provider = createTravelpayoutsProvider({ token: 'tok' });

  assert.equal(provider.supports('flight.cheapest_date'), true);
  assert.equal(provider.supports('flight.offers_search'), false);
  assert.equal(provider.supports('flight.offer_price'), false);
  assert.equal(provider.supports('flight.group_inventory'), false);
});

// ── 카카오 로컬 ──────────────────────────────────────────────────────────────

const kakaoBody = {
  meta: { total_count: 1 },
  documents: [
    {
      id: '26338954',
      place_name: '광안리해수욕장',
      category_name: '여행 > 관광,명소 > 해수욕장',
      category_group_name: '관광명소',
      phone: '051-610-4000',
      address_name: '부산 수영구 광안2동',
      road_address_name: '부산 수영구 광안해변로 219',
      x: '129.1183',
      y: '35.1531',
      place_url: 'http://place.map.kakao.com/26338954',
      distance: '820',
    },
  ],
};

test('카카오: x가 경도, y가 위도다', async () => {
  stubFetch([{ match: 'search/keyword.json', body: kakaoBody }]);

  const provider = createKakaoProvider({ restApiKey: 'key' });
  const result = await provider.fetch(
    request({ queryClass: 'poi.search', roundId: 'r_3', params: { keyword: '광안리' } }),
  );
  const place = payloadOf<Record<string, unknown>[]>(result, 'places')[0]!;

  assert.equal(place['lat'], 35.1531);
  assert.equal(place['lng'], 129.1183);
});

test('카카오: 영업시간을 주지 않으므로 지어내지 않는다', async () => {
  stubFetch([{ match: 'search/keyword.json', body: kakaoBody }]);

  const provider = createKakaoProvider({ restApiKey: 'key' });
  const result = await provider.fetch(
    request({ queryClass: 'poi.search', roundId: 'r_3', params: { keyword: '광안리' } }),
  );

  assert.equal(payloadOf<Record<string, unknown>[]>(result, 'places')[0]?.['openHours'], null);
  assert.equal(provider.supports('poi.hours'), false, '영업시간 클래스를 지원한다고 말하지 않는다');
});

test('카카오: 키워드도 좌표도 없으면 전국을 긁지 않는다', async () => {
  stubFetch([{ match: 'search/keyword.json', body: kakaoBody }]);

  const provider = createKakaoProvider({ restApiKey: 'key' });
  await assert.rejects(
    provider.fetch(request({ queryClass: 'poi.search', roundId: 'r_3', params: {} })),
    /필수 파라미터 누락/,
  );
});

test('카카오: 키워드가 없으면 카테고리 검색으로 간다', async () => {
  const stub = stubFetch([{ match: 'search/category.json', body: kakaoBody }]);

  const provider = createKakaoProvider({ restApiKey: 'key' });
  await provider.fetch(
    request({ queryClass: 'dining.search', roundId: 'r_4', params: { lat: 35.15, lng: 129.11, radius: 1000 } }),
  );

  assert.match(stub.calls[0] ?? '', /category_group_code=FD6/);
});

// ── ODsay ────────────────────────────────────────────────────────────────────

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

  const candidates = payloadOf<unknown[]>(result, 'candidates');
  const parsed = candidateSchema.safeParse(candidates[0]);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues?.slice(0, 3)));
});

test('ODsay: 접근성은 확인했다고 말하지 않는다', async () => {
  stubFetch([{ match: 'searchPubTransPathT', body: { result: { path: [odsayPath] } } }]);

  const provider = createOdsayProvider({ apiKey: 'key' });
  const result = await provider.fetch(
    request({ queryClass: 'transit.route', roundId: 'r_1b', params: odsayParams }),
  );
  const candidate = payloadOf<Record<string, unknown>[]>(result, 'candidates')[0];
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

// ── TourAPI ──────────────────────────────────────────────────────────────────

const tourPlace = {
  contentid: '126508',
  title: '경포해변',
  addr1: '강릉시',
  mapx: '128.9',
  mapy: '37.79',
};

test('TourAPI: KorService2 오퍼레이션을 부른다', async () => {
  const stub = stubFetch([
    {
      match: 'areaBasedList2',
      body: {
        response: {
          header: { resultCode: '0000' },
          body: { totalCount: 1, items: { item: [tourPlace] } },
        },
      },
    },
  ]);

  const provider = createTourApiProvider({ serviceKey: 'key' });
  const result = await provider.fetch(
    request({ queryClass: 'poi.search', roundId: 'r_3', params: { areaCode: 32 } }),
  );
  const places = payloadOf<Record<string, unknown>[]>(result, 'places');

  // KorService1은 종료됐다. 구 경로로 폴백하지 않는다.
  assert.match(stub.calls[0] ?? '', /KorService2/);
  assert.equal(places[0]?.['externalId'], '126508');
  assert.equal(places[0]?.['lat'], 37.79);
  assert.equal('candidates' in (result.payload as object), false, '스키마 밖이므로 후보로 올리지 않는다');
});

test('TourAPI: 숙박은 객실 정원으로 후보를 만든다', async () => {
  stubFetch([
    {
      match: 'areaBasedList2',
      body: { response: { header: { resultCode: '0000' }, body: { totalCount: 1, items: { item: [tourPlace] } } } },
    },
    {
      match: 'detailInfo2',
      body: {
        response: {
          header: { resultCode: '0000' },
          body: {
            items: {
              item: [
                { roomcode: 'R1', roomtitle: '스탠다드 트윈', roombasecount: '2', roommaxcount: '3', roomoffseasonminfee1: '90000' },
                { roomcode: 'R2', roomtitle: '패밀리', roombasecount: '4', roommaxcount: '6', roomoffseasonminfee1: '150000' },
              ],
            },
          },
        },
      },
    },
  ]);

  const provider = createTourApiProvider({ serviceKey: 'key' });
  const result = await provider.fetch(
    request({ queryClass: 'hotel.room_combination', roundId: 'r_2', params: { areaCode: 32, pax: 6, nights: 2 } }),
  );
  const candidates = payloadOf<Record<string, unknown>[]>(result, 'candidates');

  const parsed = candidateSchema.safeParse(candidates[0]);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues?.slice(0, 3)));

  const capacity = candidates[0]?.['capacity'] as Record<string, unknown>;
  assert.equal(capacity['maxGuests'], 6, 'roommaxcount의 최대값');
  assert.equal((capacity['roomOptions'] as unknown[]).length, 2);
  assert.equal(candidates[0]?.['roomCombinationVerified'], false, '날짜별 재고를 주지 않는다');
  assert.equal(result.confidence, 'estimated', '시즌 밴드 요금이지 실가격이 아니다');
});

test('TourAPI: 정원을 모르는 객실은 후보 계산에 넣지 않는다', async () => {
  stubFetch([
    {
      match: 'areaBasedList2',
      body: { response: { header: { resultCode: '0000' }, body: { items: { item: [tourPlace] } } } },
    },
    {
      match: 'detailInfo2',
      body: {
        response: {
          header: { resultCode: '0000' },
          body: { items: { item: [{ roomcode: 'R1', roomtitle: '문의', roommaxcount: '' }] } },
        },
      },
    },
  ]);

  const provider = createTourApiProvider({ serviceKey: 'key' });
  const result = await provider.fetch(
    request({ queryClass: 'hotel.room_combination', roundId: 'r_2', params: { areaCode: 32 } }),
  );

  assert.deepEqual(payloadOf<unknown[]>(result, 'candidates'), [], '정원 미상은 "들어갈 수 있다"가 아니다');
});

test('TourAPI: 200으로 오는 인증 실패를 잡는다', async () => {
  stubFetch([
    { match: 'areaBasedList2', body: { response: { header: { resultCode: '30', resultMsg: 'SERVICE KEY IS NOT REGISTERED' } } } },
  ]);

  const provider = createTourApiProvider({ serviceKey: 'wrong' });
  await assert.rejects(
    provider.fetch(request({ queryClass: 'poi.search', roundId: 'r_3', params: {} })),
    /SERVICE KEY/,
  );
});

test('TourAPI: 결과가 없으면 빈 문자열로 오는 items를 견딘다', async () => {
  stubFetch([
    { match: 'areaBasedList2', body: { response: { header: { resultCode: '0000' }, body: { totalCount: 0, items: '' } } } },
  ]);

  const provider = createTourApiProvider({ serviceKey: 'key' });
  const result = await provider.fetch(request({ queryClass: 'poi.search', roundId: 'r_3', params: {} }));

  assert.deepEqual(payloadOf<unknown[]>(result, 'places'), []);
});

// ── 레지스트리 ───────────────────────────────────────────────────────────────

test('키가 없는 제공자는 만들지 않고 무엇이 빠졌는지 보고한다', () => {
  const setup = providersFromEnv({} as NodeJS.ProcessEnv);

  assert.equal(setup.adapters.length, 0);
  assert.deepEqual(
    setup.missing.map((row) => row.id),
    ['kakao', 'odsay', 'tourapi', 'rakuten_travel', 'hotpepper', 'travelpayouts'],
  );
});

test('종료된 제공자는 레지스트리에 남아 있지 않다', () => {
  const setup = providersFromEnv({
    AMADEUS_CLIENT_ID: 'id',
    AMADEUS_CLIENT_SECRET: 'secret',
    NAVITIME_API_KEY: 'key',
  } as NodeJS.ProcessEnv);

  // Amadeus Self-Service는 2026-07-17에 종료됐다. 키가 있어도 어댑터가 없다.
  assert.deepEqual(setup.adapters, []);
  assert.equal(
    setup.missing.some((row) => row.id === 'amadeus'),
    false,
  );
});

test('키가 있으면 레지스트리에 실린다', () => {
  const setup = providersFromEnv({
    ODSAY_API_KEY: 'key',
    RAKUTEN_APPLICATION_ID: 'app',
    RAKUTEN_ACCESS_KEY: 'ak',
  } as NodeJS.ProcessEnv);

  assert.deepEqual(
    setup.adapters.map((adapter) => adapter.id),
    ['odsay', 'rakuten_travel'],
  );

  const chain = setup
    .registry({ 'jp-osaka': { hotel: ['rakuten_travel'] } })
    .resolve('jp-osaka', 'hotel.vacancy_price');
  assert.equal(chain[0]?.id, 'rakuten_travel');
});

test('HTTP 5xx는 재시도 가능, 4xx는 아니다', async () => {
  stubFetch([{ match: 'prices/cheap', status: 503, body: { error: 'down' } }]);
  const provider = createTravelpayoutsProvider({ token: 'tok' });

  await assert.rejects(
    provider.fetch(request({ params: { origin: 'ICN', destination: 'KIX' } })),
    (error: ProviderError) => error.retryable === true,
  );

  stubFetch([{ match: 'prices/cheap', status: 400, body: { error: 'bad' } }]);
  await assert.rejects(
    provider.fetch(request({ params: { origin: 'ICN', destination: 'KIX' } })),
    (error: ProviderError) => error.retryable === false,
  );
});
