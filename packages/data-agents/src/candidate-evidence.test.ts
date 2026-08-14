import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type CandidateEvidenceQueryPlan,
  type TripCharter,
} from '@tm/contracts';
import { createMemoryRepositories } from '@tm/db';
import {
  CandidateEvidenceExecutionError,
  createCandidateEvidenceExecutionPort,
  type CandidateEvidenceExecutionInput,
} from './candidate-evidence.js';
import { createDataAgent } from './gateway.js';
import { createStaticRegistry } from './provider.js';
import { PROVIDER_DIALECT_PARAMS } from './provider-request.js';
import { createFixtureProvider } from './providers/fixture.js';
import { createRakutenProvider } from './providers/rakuten.js';

const charter: TripCharter = {
  schemaVersion: 1,
  charterVersion: 'charter:osaka:1',
  destination: '오사카',
  startDate: '2026-10-16',
  endDate: '2026-10-19',
  participantIds: ['u1', 'u2', 'u3'],
  partySize: 3,
  pace: 'balanced',
  budgetMaxByParticipantKrw: { u1: 300_000, u2: 400_000, u3: 500_000 },
};

const hotelCandidate = {
  kind: 'hotel',
  id: 'hotel-1',
  source: 'rakuten_travel',
  fetchedAt: '2026-08-14T00:00:00.000Z',
  disqualified: false,
  disqualifyReason: null,
  name: '난바 호텔',
  type: 'hotel',
  location: { lat: 34.6659, lng: 135.5015, area: '난바', address: '오사카시 주오구' },
  price: {
    amount: 80_000,
    currency: 'JPY',
    confidence: 'live',
    perNightPerPerson: 80_000,
    totalPerPerson: 240_000,
    groupTotal: 720_000,
    taxesIncluded: true,
  },
  meals: {
    breakfastIncluded: false,
    dinnerIncluded: false,
    mealValuePerPersonPerNight: null,
    effectiveLodgingCost: null,
    dietSupportVerified: false,
  },
  capacity: {
    maxGuests: 3,
    roomOptions: [{ config: '트리플', totalGuests: 3, pricePerNight: 240_000 }],
  },
  roomCombinationVerified: true,
  allInPriceVerified: false,
  amenities: ['wifi'],
  accessibility: { wheelchair: null, elevator: true, stepFree: null },
  locationMetrics: {},
  rating: null,
  cancelPolicy: { freeUntil: null, penaltyAfter: null },
  bookingUrl: 'https://example.test/hotel/1',
};

function plan(
  queryPlanId: string,
  sourceBriefIds: string[],
  params: Record<string, unknown> = { searchAttempt: 0 },
): CandidateEvidenceQueryPlan {
  return {
    schemaVersion: 1,
    queryPlanId,
    category: 'stay',
    sourceBriefIds,
    queryClass: 'hotel.search',
    providerOrder: ['rakuten_travel'],
    searchTerms: ['오사카 숙소'],
    params,
    relaxationChanges: [],
    rationale: '확정 조건으로 숙소 후보를 탐색합니다.',
  };
}

function input(queryPlans: CandidateEvidenceQueryPlan[]): CandidateEvidenceExecutionInput {
  return {
    runId: 'run:canonical:1',
    tripId: 'trip:osaka:1',
    inputVersion: 1,
    searchAttempt: 0,
    packId: 'jp-osaka',
    category: 'stay',
    charter,
    queryPlans,
    expectedBriefIds: ['brief:u1', 'brief:u2', 'brief:neutral'],
    queryBudget: 4,
    area: '난바',
    center: { lat: 34.6659, lng: 135.5017 },
    roomCount: 1,
    limit: 5,
    searchRadiusKm: 2,
  };
}

function setup(payload: unknown = { candidates: [hotelCandidate] }) {
  const provider = createFixtureProvider({
    id: 'rakuten_travel',
    queryClasses: ['hotel.search'],
    responses: {
      'hotel.search': { payload, confidence: 'live', termsRef: 'fixture-terms' },
    },
  });
  const repos = createMemoryRepositories();
  const gateway = createDataAgent({
    cache: repos.cache,
    providers: createStaticRegistry([provider], {
      'jp-osaka': { hotel: ['rakuten_travel'] },
    }),
  });
  return { provider, repos, port: createCandidateEvidenceExecutionPort(gateway) };
}

test('Proxy·중립 QueryPlan을 한 Provider 요청으로 병합하고 lineage를 보존한다', async () => {
  const { provider, repos, port } = setup();
  const result = await port.execute(input([
    plan('query:u1', ['brief:u1']),
    plan('query:u2', ['brief:u2']),
    plan('query:neutral', ['brief:neutral']),
  ]));

  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.requestedQueryPlans, 3);
  assert.equal(result.executedProviderRequests, 1);
  assert.equal(result.deduplicatedQueryPlans, 2);
  assert.equal(provider.calls.length, 1);
  assert.deepEqual(provider.calls[0]?.providerOrder, ['rakuten_travel']);
  assert.equal(provider.calls[0]?.callerId, 'run-controller:candidate-evidence');
  assert.equal(provider.calls[0]?.params['guests'], 3);
  assert.equal(provider.calls[0]?.params['checkIn'], '2026-10-16');
  assert.equal(provider.calls[0]?.params['checkOut'], '2026-10-19');

  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0]?.sourceBriefIds.sort(), [
    'brief:neutral',
    'brief:u1',
    'brief:u2',
  ]);
  assert.equal(result.candidates[0]?.sourceMode, 'live');
  assert.equal(result.candidates[0]?.poolEligibility, 'UNVERIFIED');
  assert.equal(result.evidence.length, 3);
  assert.ok(result.evidence.every((item) => item.status === 'UNKNOWN'));
  assert.ok(result.evidence.every((item) => item.fieldStates['normalization'] === 'PASS'));
  assert.ok(result.evidence.every((item) => item.fieldStates['verification'] === 'UNKNOWN'));
  await repos.close();
});

test('중복 queryPlanId는 Provider 호출 전에 거부한다', async () => {
  const { provider, repos, port } = setup();
  await assert.rejects(
    () => port.execute(input([
      plan('query:duplicate', ['brief:u1']),
      plan('query:duplicate', ['brief:u2']),
      plan('query:neutral', ['brief:neutral']),
    ])),
    (error: unknown) =>
      error instanceof CandidateEvidenceExecutionError &&
      error.code === 'QUERY_PLAN_ID_DUPLICATED',
  );
  assert.equal(provider.calls.length, 0);
  await repos.close();
});

test('같은 Brief를 여러 QueryPlan에 배정하면 공정 예산 위반으로 거부한다', async () => {
  const { provider, repos, port } = setup();
  await assert.rejects(
    () => port.execute(input([
      plan('query:u1:first', ['brief:u1']),
      plan('query:u1:again', ['brief:u1', 'brief:u2']),
      plan('query:neutral', ['brief:neutral']),
    ])),
    (error: unknown) =>
      error instanceof CandidateEvidenceExecutionError &&
      error.code === 'BRIEF_QUERY_BUDGET_EXCEEDED',
  );
  assert.equal(provider.calls.length, 0);
  await repos.close();
});

test('QueryPlan이 인원·날짜 같은 RunController 조건을 바꾸면 호출 전에 거부한다', async () => {
  const { provider, repos, port } = setup();
  await assert.rejects(
    () => port.execute(input([
      plan('query:unsafe', ['brief:u1', 'brief:u2', 'brief:neutral'], { guests: 2 }),
    ])),
    (error: unknown) =>
      error instanceof CandidateEvidenceExecutionError && error.code === 'HARD_CONTEXT_OVERRIDE',
  );
  assert.equal(provider.calls.length, 0);
  await repos.close();
});

test('QueryPlan에 API Key나 승인되지 않은 조건 완화가 있으면 호출 전에 거부한다', async () => {
  const { provider, repos, port } = setup();
  await assert.rejects(
    () => port.execute(input([
      plan('query:secret', ['brief:u1', 'brief:u2', 'brief:neutral'], { apiKey: 'not-forwarded' }),
    ])),
    (error: unknown) =>
      error instanceof CandidateEvidenceExecutionError && error.code === 'SENSITIVE_CONTEXT',
  );
  const relaxed = plan('query:relaxed', ['brief:u1', 'brief:u2', 'brief:neutral']);
  await assert.rejects(
    () => port.execute(input([{ ...relaxed, relaxationChanges: ['constraint:capacity'] }])),
    (error: unknown) =>
      error instanceof CandidateEvidenceExecutionError && error.code === 'UNAPPROVED_RELAXATION',
  );
  assert.equal(provider.calls.length, 0);
  await repos.close();
});

test('응답 정규화와 Candidate 생성은 구분하고 후보가 없으면 근거만 남긴다', async () => {
  const { provider, repos, port } = setup({ places: [{ name: '스키마 밖 장소' }] });
  const result = await port.execute(input([
    plan('query:all', ['brief:u1', 'brief:u2', 'brief:neutral']),
  ]));

  assert.equal(provider.calls.length, 1);
  assert.equal(result.status, 'NO_CANDIDATES');
  assert.equal(result.candidates.length, 0);
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0]?.providerCandidateId, null);
  assert.equal(result.evidence[0]?.status, 'UNKNOWN');
  assert.equal(result.evidence[0]?.fieldStates['normalization'], 'UNKNOWN');
  assert.equal(result.receipts[0]?.status, 'NO_CANDIDATES');
  await repos.close();
});

test('Given 한 Provider 그룹 실패 When 다음 그룹 실행 Then 성공 후보와 실패 영수증을 함께 보존한다', async () => {
  const broken = createFixtureProvider({
    id: 'broken',
    queryClasses: ['hotel.search'],
    responses: { 'hotel.search': { payload: { candidates: [] }, confidence: 'live' } },
    failing: ['hotel.search'],
  });
  const healthy = createFixtureProvider({
    id: 'rakuten_travel',
    queryClasses: ['hotel.search'],
    responses: {
      'hotel.search': { payload: { candidates: [hotelCandidate] }, confidence: 'live' },
    },
  });
  const repos = createMemoryRepositories();
  const gateway = createDataAgent({
    cache: repos.cache,
    providers: createStaticRegistry([broken, healthy], {
      'jp-osaka': { hotel: ['broken', 'rakuten_travel'] },
    }),
  });
  const port = createCandidateEvidenceExecutionPort(gateway);
  const failedPlan = {
    ...plan('query:broken', ['brief:u1']),
    providerOrder: ['broken'],
  };
  const healthyPlan = {
    ...plan('query:healthy', ['brief:u2', 'brief:neutral'], { area: '우메다' }),
    providerOrder: ['rakuten_travel'],
  };

  const result = await port.execute(input([failedPlan, healthyPlan]));

  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.executedProviderRequests, 2);
  assert.equal(result.failures.length, 1);
  assert.equal(result.receipts.length, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(broken.calls.length, 1);
  assert.equal(healthy.calls.length, 1);
  await repos.close();
});

// ── Provider 중립 어휘 경계 ──────────────────────────────────────────────────

test('조달 계획은 Provider 방언을 발화하지 않는다', async () => {
  const { provider, repos, port } = setup();
  await port.execute(input([plan('query:all', ['brief:u1', 'brief:u2', 'brief:neutral'])]));

  const params = provider.calls[0]?.params ?? {};
  for (const dialect of PROVIDER_DIALECT_PARAMS) {
    assert.equal(
      dialect in params,
      false,
      `${dialect}는 Provider 방언이다 — 번역은 어댑터의 일이다`,
    );
  }
  // 같은 뜻을 중립 이름 하나로만 말한다. 별칭을 함께 실으면 캐시 키만 쪼개진다.
  assert.equal(params['guests'], 3);
  assert.equal(params['rooms'], 1);
  assert.equal(params['checkIn'], '2026-10-16');
  assert.equal(params['checkOut'], '2026-10-19');
  assert.equal(params['radiusKm'], 2);
  await repos.close();
});

test('QueryPlan이 Provider 방언을 실어 보내면 Gateway에 닿기 전에 막는다', async () => {
  const { provider, repos, port } = setup();
  await assert.rejects(
    () => port.execute(input([
      plan('query:dialect', ['brief:u1', 'brief:u2', 'brief:neutral'], {
        searchAttempt: 0,
        searchRadius: 3,
      }),
    ])),
    (error: unknown) =>
      error instanceof CandidateEvidenceExecutionError &&
      error.code === 'PROVIDER_DIALECT_PARAM' &&
      error.message.includes('searchRadius'),
  );
  assert.equal(provider.calls.length, 0, '방언이 캐시 키에 들어가기 전에 막아야 한다');
  await repos.close();
});

test('Provider 그룹이 통째로 실패하면 시도한 Provider를 실패 영수증에 남긴다', async () => {
  const first = createFixtureProvider({
    id: 'broken-primary',
    queryClasses: ['hotel.search'],
    responses: { 'hotel.search': { payload: { candidates: [] }, confidence: 'live' } },
    failing: ['hotel.search'],
  });
  const second = createFixtureProvider({
    id: 'broken-fallback',
    queryClasses: ['hotel.search'],
    responses: { 'hotel.search': { payload: { candidates: [] }, confidence: 'live' } },
    failing: ['hotel.search'],
  });
  const repos = createMemoryRepositories();
  const gateway = createDataAgent({
    cache: repos.cache,
    providers: createStaticRegistry([first, second], {
      'jp-osaka': { hotel: ['broken-primary', 'broken-fallback'] },
    }),
  });
  const port = createCandidateEvidenceExecutionPort(gateway);
  const result = await port.execute(input([
    {
      ...plan('query:all', ['brief:u1', 'brief:u2', 'brief:neutral']),
      providerOrder: ['broken-primary', 'broken-fallback'],
    },
  ]));

  assert.equal(result.status, 'FAILED');
  assert.equal(result.failures.length, 1);
  const failure = result.failures[0];
  assert.equal(failure?.code, 'PROVIDER_UNAVAILABLE');
  assert.deepEqual(failure?.providerOrder, ['broken-primary', 'broken-fallback']);
  // 폴백 체인이 어디까지 갔는지가 실패 영수증의 provenance다.
  assert.deepEqual(failure?.attemptedProviderIds, ['broken-primary', 'broken-fallback']);
  // 분류만 남기고 Provider 원문 메시지는 싣지 않는다.
  assert.equal(failure?.message.includes('픽스처'), false);
  await repos.close();
});

// ── Osaka stay 수직 경로 (라쿠텐 실어댑터 · 응답만 고정) ─────────────────────

/** 실호출로 확인한 VacantHotelSearch 응답 형태 (2026-08-14) */
const osakaVacantHotel = {
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
            withBreakfastFlag: 0,
            withDinnerFlag: 0,
            reserveUrl: 'https://img.travel.rakuten.co.jp/image/tr/api/re/IdsCY/?f_no=191842',
          },
        },
        { dailyCharge: { stayDate: '2026-10-16', rakutenCharge: 7650, total: 22950, chargeFlag: 0 } },
      ],
    },
  ],
};

test('Osaka stay: 중립 QueryPlan이 라쿠텐 어댑터를 거쳐 Candidate와 Evidence provenance를 만든다', async () => {
  const applicationId = 'osaka-fixture-application-id';
  const accessKey = 'osaka-fixture-access-key';
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (target: string | URL | Request) => {
    calls.push(String(target));
    return {
      ok: true,
      status: 200,
      async json() {
        return { hotels: [osakaVacantHotel] };
      },
      async text() {
        return '';
      },
    } as Response;
  }) as typeof fetch;

  const repos = createMemoryRepositories();
  try {
    const gateway = createDataAgent({
      cache: repos.cache,
      providers: createStaticRegistry(
        [createRakutenProvider({ applicationId, accessKey })],
        { 'jp-osaka': { hotel: ['rakuten_travel'] } },
      ),
    });
    const result = await createCandidateEvidenceExecutionPort(gateway).execute(input([
      plan('query:u1', ['brief:u1']),
      plan('query:u2', ['brief:u2']),
      plan('query:neutral', ['brief:neutral']),
    ]));

    // 1. 중립 어휘가 라쿠텐 방언으로 번역돼 나갔다 — 오사카·3인·3박·1실
    assert.equal(calls.length, 1, '세 QueryPlan이 한 Provider 요청으로 합쳐진다');
    const url = new URL(calls[0] ?? '');
    assert.equal(url.searchParams.get('checkinDate'), '2026-10-16');
    assert.equal(url.searchParams.get('checkoutDate'), '2026-10-19');
    assert.equal(url.searchParams.get('adultNum'), '3');
    assert.equal(url.searchParams.get('roomNum'), '1');
    assert.equal(url.searchParams.get('searchRadius'), '2');
    assert.equal(url.searchParams.get('hits'), '5');

    // 2. 정규화 Candidate
    assert.equal(result.status, 'SUCCEEDED');
    assert.equal(result.candidates.length, 1);
    const candidate = result.candidates[0];
    assert.equal(candidate?.providerId, 'rakuten_travel');
    assert.equal(candidate?.providerCandidateId, 'rakuten_191842');
    assert.equal(candidate?.poolEligibility, 'UNVERIFIED', '조달 단계에서 승격하지 않는다');
    assert.deepEqual(candidate?.sourceBriefIds.slice().sort(), [
      'brief:neutral',
      'brief:u1',
      'brief:u2',
    ]);

    // 3. Evidence provenance 전량 보존
    assert.equal(result.evidence.length, 3, 'QueryPlan마다 근거가 남는다');
    for (const snapshot of result.evidence) {
      assert.equal(snapshot.providerId, 'rakuten_travel');
      assert.ok(snapshot.queryPlanId.length > 0);
      assert.equal(snapshot.providerCandidateId, 'rakuten_191842');
      assert.equal(
        snapshot.sourceUrl,
        'https://img.travel.rakuten.co.jp/image/tr/api/re/IdsCY/?f_no=191842',
      );
      assert.ok(Number.isFinite(Date.parse(snapshot.retrievedAt)));
      assert.ok(snapshot.validUntil !== null);
      assert.equal(snapshot.confidence, 'live');
      assert.match(snapshot.termsRef, /rakuten/);
      assert.equal(snapshot.fieldStates['normalization'], 'PASS');
      assert.equal(snapshot.fieldStates['verification'], 'UNKNOWN', '조달은 검증이 아니다');
    }

    // 4. Provider 원문도 자격증명도 결과에 실리지 않는다
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('hotelBasicInfo'), false, 'Provider 원문 구조가 새면 안 된다');
    assert.equal(serialized.includes('roomBasicInfo'), false);
    assert.equal(serialized.includes(applicationId), false);
    assert.equal(serialized.includes(accessKey), false);
  } finally {
    globalThis.fetch = originalFetch;
    await repos.close();
  }
});
