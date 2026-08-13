import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  QuotaExceededError,
  VerificationUnavailableError,
  type DataRequest,
  type QueryClass,
} from '@tm/contracts';
import { createMemoryRepositories } from '@tm/db';
import { createDataAgent } from './gateway.js';
import { createStaticRegistry } from './provider.js';
import { createFixtureProvider } from './providers/fixture.js';

/**
 * 게이트웨이 동작 검증. agent-architecture.md 6.3 read-through + 테스트 A10~A13, A21~A22.
 * 제공자는 픽스처라 키 없이 돈다.
 */

const request = (
  queryClass: QueryClass,
  params: Record<string, unknown>,
  overrides: Partial<DataRequest> = {},
): DataRequest =>
  ({
    requestId: 'rq_1',
    runId: 'run_1',
    roundId: 'r_2',
    callerId: 'referee:accommodation',
    queryClass,
    purpose: 'exploration',
    packId: 'jp-osaka',
    params,
    ...overrides,
  }) as DataRequest;

const HOTEL_PARAMS = {
  hotelId: 'H1',
  checkIn: '2026-10-16',
  checkOut: '2026-10-18',
  guests: 6,
};

function setup(options: { failing?: QueryClass[]; secondary?: boolean } = {}) {
  const primary = createFixtureProvider({
    id: 'rakuten_travel',
    queryClasses: ['hotel.vacancy_price', 'hotel.search', 'hotel.room_combination', 'web.search'],
    responses: {
      'hotel.vacancy_price': { payload: { pricePerNight: 18000 }, confidence: 'live' },
      'hotel.search': { payload: { hotels: ['H1', 'H2'] }, confidence: 'live' },
      'hotel.room_combination': { payload: { rooms: [2, 2, 2] }, confidence: 'live' },
      'web.search': { payload: { results: ['임시 휴업 공지'] }, confidence: 'live' },
    },
    ...(options.failing === undefined ? {} : { failing: options.failing }),
  });

  const secondary = createFixtureProvider({
    id: 'amadeus_hotel',
    queryClasses: ['hotel.vacancy_price', 'hotel.search', 'hotel.room_combination'],
    responses: {
      'hotel.vacancy_price': { payload: { pricePerNight: 19500 }, confidence: 'estimated' },
      'hotel.search': { payload: { hotels: ['H3'] }, confidence: 'estimated' },
      'hotel.room_combination': { payload: { rooms: [3, 3] }, confidence: 'estimated' },
    },
  });

  const repos = createMemoryRepositories();
  const adapters = options.secondary === true ? [primary, secondary] : [primary];
  const agent = createDataAgent({
    cache: repos.cache,
    providers: createStaticRegistry(adapters, {
      'jp-osaka': { hotel: ['rakuten_travel', 'amadeus_hotel'] },
    }),
  });

  return { agent, primary, secondary, repos };
}

test('탐색은 캐시 히트로 제공자를 다시 부르지 않는다', async () => {
  const { agent, primary } = setup();
  const first = await agent.resolve(request('hotel.search', { packId: 'jp-osaka', area: '난바', type: 'hotel', guests: 6 }));
  assert.equal(first.evidence.cacheHit, false);

  const second = await agent.resolve(
    request('hotel.search', { packId: 'jp-osaka', area: '난바', type: 'hotel', guests: 6 }, { requestId: 'rq_2' }),
  );
  assert.equal(second.evidence.cacheHit, true);
  assert.equal(primary.calls.length, 1, '두 번째 조회가 제공자를 다시 불렀다');
});

test('A10: verification은 캐시를 우회하고 실시간을 강제한다', async () => {
  const { agent, primary } = setup();
  await agent.resolve(request('hotel.vacancy_price', HOTEL_PARAMS));
  const verified = await agent.resolve(
    request('hotel.vacancy_price', HOTEL_PARAMS, { purpose: 'verification', requestId: 'rq_2' }),
  );
  assert.equal(verified.evidence.cacheHit, false);
  assert.equal(primary.calls.length, 2);
});

test('never 클래스는 캐시에 저장되지 않는다', async () => {
  const { agent, repos } = setup();
  const response = await agent.resolve(
    request('hotel.room_combination', { ...HOTEL_PARAMS, rooms: 3 }, { purpose: 'verification' }),
  );
  assert.equal(response.evidence.cacheHit, false);
  assert.equal(await repos.cache.get(response.evidence.evidenceId), undefined);
});

test('A12: fail-closed 클래스는 조회 실패 시 VerificationUnavailableError', async () => {
  const { agent } = setup({ failing: ['hotel.room_combination'] });
  await assert.rejects(
    agent.resolve(
      request('hotel.room_combination', { ...HOTEL_PARAMS, rooms: 3 }, { purpose: 'verification' }),
    ),
    VerificationUnavailableError,
  );
});

test('1순위 실패 시 폴백 제공자를 쓰고 degraded로 표시한다', async () => {
  const { agent } = setup({ failing: ['hotel.search'], secondary: true });
  const response = await agent.resolve(
    request('hotel.search', { packId: 'jp-osaka', area: '난바', type: 'hotel', guests: 6 }),
  );
  assert.equal(response.evidence.source, 'amadeus_hotel');
  assert.equal(response.evidence.degraded, true);
  assert.ok(response.evidence.fallbackReason);
});

test('A22: 웹 결과는 live로 와도 advisory + estimated로 강등된다', async () => {
  const { agent } = setup();
  const response = await agent.resolve(
    request('web.search', { packId: 'jp-osaka', query: '오사카성 임시 휴업' }),
  );
  assert.equal(response.evidence.advisory, true);
  assert.equal(response.evidence.confidence, 'estimated');
});

test('A21: 페르소나 에이전트의 호출은 스키마에서 거부된다', async () => {
  const { agent } = setup();
  await assert.rejects(
    agent.resolve(
      request('web.search', { packId: 'jp-osaka', query: '오사카' }, { callerId: 'persona:user_3' }),
    ),
    /Data Agent는 심판·오케스트레이터·Supervisor만/,
  );
});

test('도구 호출 상한을 넘으면 QuotaExceededError', async () => {
  const { agent } = setup();
  // hotel.search 상한은 4회
  for (let i = 0; i < 4; i += 1) {
    await agent.resolve(
      request('hotel.search', { packId: 'jp-osaka', area: `지역${i}`, type: 'hotel', guests: 6 }),
    );
  }
  await assert.rejects(
    agent.resolve(request('hotel.search', { packId: 'jp-osaka', area: '추가', type: 'hotel', guests: 6 })),
    QuotaExceededError,
  );
});

test('필수 캐시 키 파라미터가 빠지면 조회 자체를 거부한다', async () => {
  const { agent } = setup();
  await assert.rejects(
    agent.resolve(request('hotel.vacancy_price', { hotelId: 'H1', checkIn: '2026-10-16' })),
    /필수 캐시 키 파라미터 누락/,
  );
});

test('호출 이력이 data_requests 로그로 남는다', async () => {
  const { agent, repos } = setup();
  await agent.resolve(request('hotel.search', { packId: 'jp-osaka', area: '난바', type: 'hotel', guests: 6 }));
  const log = (repos.cache as unknown as { entries(): unknown[] }).entries();
  assert.equal(log.length, 1);
});
