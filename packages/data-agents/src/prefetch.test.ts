import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QueryClass } from '@tm/contracts';
import { createMemoryRepositories } from '@tm/db';
import { createDataAgent } from './gateway.js';
import { createStaticRegistry } from './provider.js';
import { createFixtureProvider } from './providers/fixture.js';
import {
  extractCandidates,
  planPrefetch,
  prefetchSkipReason,
  prefetchableClasses,
  runPrefetch,
  type CandidateSink,
  type PrefetchedCandidate,
} from './prefetch.js';

/**
 * 프리페치. 근거: agent-architecture.md 6.8 · 6.5 정책 카탈로그
 *
 * 확인하는 것:
 *   1. 미리 받으면 안 되는 클래스를 걸러내는가 (캐시 금지·fail-closed·advisory)
 *   2. 실패해도 던지지 않는가 (프리페치는 라운드를 막지 않는다)
 *   3. 정규화 스키마를 통과한 후보만 적재 대상이 되는가
 */

const hotelCandidate = (id: string): Record<string, unknown> => ({
  kind: 'hotel',
  id,
  source: 'rakuten_travel',
  fetchedAt: '2026-08-13T00:00:00.000Z',
  name: '난바 호텔',
  type: 'hotel',
  location: { lat: 34.6659, lng: 135.5015, area: '난바', address: '오사카시 주오구' },
  price: {
    amount: 82000,
    currency: 'KRW',
    confidence: 'live',
    perNightPerPerson: 82000,
    totalPerPerson: 164000,
    groupTotal: 984000,
    taxesIncluded: true,
  },
  meals: {
    breakfastIncluded: true,
    dinnerIncluded: false,
    mealValuePerPersonPerNight: null,
    effectiveLodgingCost: null,
    dietSupportVerified: false,
  },
  capacity: { maxGuests: 6, roomOptions: [{ config: '트윈x3', totalGuests: 6, pricePerNight: 246000 }] },
  roomCombinationVerified: false,
  allInPriceVerified: false,
  amenities: ['wifi'],
  accessibility: { wheelchair: null, elevator: true, stepFree: null },
  locationMetrics: { station: { label: '난바역', minutes: 5 } },
  rating: { score: 8.6, count: 1200 },
  cancelPolicy: { freeUntil: null, penaltyAfter: null },
  bookingUrl: null,
});

function setup(options: { failing?: QueryClass[] } = {}) {
  const provider = createFixtureProvider({
    id: 'rakuten_travel',
    queryClasses: ['hotel.search', 'hotel.area_profile', 'hotel.price_band', 'hotel.vacancy_price'],
    responses: {
      'hotel.search': {
        payload: { candidates: [hotelCandidate('H1'), hotelCandidate('H2')] },
        confidence: 'live',
      },
      'hotel.area_profile': { payload: { areas: ['난바', '우메다'] }, confidence: 'estimated' },
      'hotel.price_band': { payload: { band: [60000, 120000] }, confidence: 'estimated' },
    },
    ...(options.failing === undefined ? {} : { failing: options.failing }),
  });

  const repos = createMemoryRepositories();
  const gateway = createDataAgent({
    cache: repos.cache,
    providers: createStaticRegistry([provider], {}),
  });

  return { gateway, provider, repos };
}

const plan = (params: Record<string, readonly Record<string, unknown>[]>) =>
  planPrefetch({
    runId: 'run_1',
    roundId: 'r_2',
    packId: 'jp-osaka',
    params: params as never,
  });

test('캐시 금지 클래스는 프리페치하지 않는다', () => {
  // 확정가는 저장 자체가 금지다. 미리 받아도 버려지고 쿼터만 태운다.
  assert.equal(prefetchSkipReason('hotel.all_in_price'), 'cache_forbidden');
  assert.equal(prefetchSkipReason('flight.offer_price'), 'cache_forbidden');
  assert.equal(prefetchSkipReason('hotel.search'), null);
});

test('fail-closed 클래스는 프리페치하지 않는다', () => {
  // 안전 축은 판정 시점의 live 값이어야 한다.
  assert.equal(prefetchSkipReason('dining.diet_support'), 'fail_closed');
  assert.equal(prefetchSkipReason('hotel.room_combination'), 'fail_closed');
});

test('웹·RAG는 후보 조달원이 아니므로 제외된다', () => {
  assert.equal(prefetchSkipReason('web.search'), 'advisory');
  assert.equal(prefetchSkipReason('kb.retrieve'), 'advisory');
  // advisory 플래그가 붙었어도 정상 조달 클래스는 미리 받는다 (승격만 못 할 뿐이다)
  assert.equal(prefetchSkipReason('hotel.price_band'), null);
});

test('라운드별 프리페치 가능 클래스만 남는다', () => {
  const classes = prefetchableClasses('r_2');
  assert.ok(classes.includes('hotel.search'));
  assert.equal(classes.includes('hotel.room_combination'), false);
});

test('라운드에 속하지 않는 클래스는 계획에서 빠지고 사유가 남는다', () => {
  const result = plan({ 'flight.offers_search': [{ origin: 'ICN' }] });

  assert.equal(result.requests.length, 0);
  assert.equal(result.skipped[0]?.reason, 'not_in_round');
});

test('계획의 목적은 항상 exploration이고 호출자는 orchestrator다', () => {
  const result = plan({ 'hotel.search': [{ packId: 'jp-osaka', area: '난바', type: 'hotel', guests: 6 }] });

  assert.equal(result.requests[0]?.purpose, 'exploration');
  assert.equal(result.requests[0]?.callerId, 'orchestrator:prefetch');
});

test('한 클래스에 여러 조회를 넣을 수 있다', () => {
  const result = plan({
    'hotel.search': [
      { packId: 'jp-osaka', area: '난바', type: 'hotel', guests: 6 },
      { packId: 'jp-osaka', area: '우메다', type: 'hotel', guests: 6 },
    ],
  });

  assert.equal(result.requests.length, 2);
  assert.notEqual(result.requests[0]?.requestId, result.requests[1]?.requestId);
});

test('실행하면 캐시가 채워지고 후보가 나온다', async () => {
  const { gateway, repos } = setup();
  const collected: PrefetchedCandidate[] = [];
  const sink: CandidateSink = {
    async collect(input) {
      collected.push(...input.candidates);
    },
  };

  const report = await runPrefetch(
    gateway,
    plan({ 'hotel.search': [{ packId: 'jp-osaka', area: '난바', type: 'hotel', guests: 6 }] }),
    { sink },
  );

  assert.equal(report.warmed, 1);
  assert.equal(report.candidates, 2);
  assert.equal(collected.length, 2);
  assert.deepEqual(
    collected.map((row) => row.externalId),
    ['H1', 'H2'],
  );
  await repos.close();
});

test('두 번째 실행은 캐시 적중이라 제공자를 부르지 않는다', async () => {
  const { gateway, provider } = setup();
  const request = plan({ 'hotel.search': [{ packId: 'jp-osaka', area: '난바', type: 'hotel', guests: 6 }] });

  await runPrefetch(gateway, request);
  const callsAfterFirst = (provider as unknown as { calls: unknown[] }).calls.length;
  const report = await runPrefetch(gateway, request);

  assert.equal((provider as unknown as { calls: unknown[] }).calls.length, callsAfterFirst);
  assert.equal(report.cacheHits, 1);
});

test('제공자가 실패해도 던지지 않고 보고만 한다', async () => {
  const { gateway } = setup({ failing: ['hotel.search'] });

  const report = await runPrefetch(gateway, plan({ 'hotel.search': [{ packId: 'jp-osaka', area: '난바', type: 'hotel', guests: 6 }] }));

  assert.equal(report.warmed, 0);
  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0]?.reason ?? '', /제공자 장애/);
});

test('한 클래스가 실패해도 나머지는 계속 시도한다', async () => {
  const { gateway } = setup({ failing: ['hotel.search'] });

  const report = await runPrefetch(
    gateway,
    plan({ 'hotel.search': [{ packId: 'jp-osaka', area: '난바', type: 'hotel', guests: 6 }], 'hotel.area_profile': [{ packId: 'jp-osaka', area: '난바' }] }),
  );

  assert.equal(report.failures.length, 1);
  assert.equal(report.warmed, 1);
});

test('쿼터를 넘기면 즉시 멈춘다 — 심판이 쓸 호출을 남겨야 한다', async () => {
  const { gateway } = setup();
  // hotel.search 상한은 4회. 6회를 계획해 초과시킨다.
  const params = Array.from({ length: 6 }, (_, index) => ({ packId: 'jp-osaka', area: `area_${index}`, type: 'hotel', guests: 6 }));

  const report = await runPrefetch(gateway, plan({ 'hotel.search': params }));

  assert.ok(report.failures.some((failure) => failure.quotaExceeded));
  assert.ok(report.warmed <= 4, `상한을 넘겨 호출했다: ${report.warmed}`);
});

test('정규화 스키마를 통과하지 못한 응답은 후보가 아니다', () => {
  // 스키마 밖의 것을 후보로 인정하면 계획서의 external_id 전수 검증이 무너진다.
  const candidates = extractCandidates({ candidates: [{ id: 'X1', name: '이상한 호텔' }] }, 'x');
  assert.equal(candidates.length, 0);

  const valid = extractCandidates({ candidates: [hotelCandidate('H9')] }, 'rakuten_travel');
  assert.equal(valid.length, 1);
  assert.equal(valid[0]?.externalId, 'H9');
});

test('배열 응답도 후보로 인식한다', () => {
  const candidates = extractCandidates([hotelCandidate('H5')], 'rakuten_travel');
  assert.equal(candidates.length, 1);
});
