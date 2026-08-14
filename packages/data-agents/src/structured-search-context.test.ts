import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type {
  NeutralSearchBrief,
  ProxySearchBrief,
  TripCharter,
  UserProxyProfileView,
} from '@tm/contracts';
import { projectPackKnowledge, resolvePackArea } from './pack-knowledge.js';
import { deriveStructuredSearchIntent, type SoftPreference } from './search-intent.js';
import {
  buildStructuredSearchContext,
  deriveRoomCount,
  queryClassForCategory,
  toCandidateEvidenceExecutionContext,
} from './structured-search-context.js';

/**
 * Osaka stay fixture — 오사카 · 성인 3명 · 3박 · 숙소.
 * packs/jp-osaka.json의 실제 값을 기준으로 하되 테스트는 자기완결적으로 유지한다.
 */
const OSAKA_PACK = {
  packId: 'jp-osaka',
  displayName: '오사카',
  country: 'JP',
  coverage: 'B',
  active: false,
  center: { lat: 34.6937, lng: 135.5023 },
  areas: ['난바', '우메다', '신사이바시', '텐노지', '베이에어리어', '닛폰바시'],
  airports: ['KIX', 'ITM'],
  requiresAirTravel: true,
  cardDeck: 'deck_jp_osaka_v2',
  providers: {
    hotel: ['rakuten_travel', 'demo-fixture'],
    dining: ['hotpepper', 'demo-fixture'],
    poi: ['demo-fixture'],
    transit: ['demo-fixture'],
    flight: ['travelpayouts', 'demo-fixture'],
  },
  config: {
    currency: 'JPY',
    displayCurrency: 'KRW',
    timezone: 'Asia/Tokyo',
    mealTimes: { lunch: '11:30-14:00', dinner: '17:30-21:30' },
    tipping: false,
    defaultTransit: 'subway',
    commonClosedDay: '화요일(일부 박물관)',
    reservationCulture: '인기 식당 사전예약 필수',
    avgCosts: { mealMid: 1500, subwayRide: 240, taxiBase: 600 },
  },
  typicalDurations: [2, 3, 4],
  recommendedNights: 3,
  peakSeasons: ['2026-10-03~2026-10-09'],
  avoidDates: ['2026-12-31'],
  weatherProfile: { bestMonths: [3, 4, 5, 10, 11], rainyMonths: [6, 7] },
  roundPreset: 'standard_overseas',
  transitPasses: [],
  priceBands: [],
  verification: [
    { field: 'providers', status: 'verified', note: '2026-08-14 재조사' },
    { field: 'providers.poi', status: 'unverified', note: '일본 POI 무료 공급자 공백' },
    { field: 'config.avgCosts', status: 'unverified', note: '현지 단가 재확인 필요' },
  ],
} as const;

const CHARTER: TripCharter = {
  schemaVersion: 1,
  charterVersion: 'charter-v1',
  destination: '오사카',
  startDate: '2026-10-15',
  endDate: '2026-10-18',
  participantIds: ['p1', 'p2', 'p3'],
  partySize: 3,
  pace: 'balanced',
  budgetMaxByParticipantKrw: { p1: 450_000, p2: 380_000, p3: 520_000 },
};

function profile(
  participantId: string,
  budgetMaxKrw: number,
  facts: UserProxyProfileView['facts'],
): UserProxyProfileView {
  return { participantId, profileVersion: 'profile-v1', facts, budgetMaxKrw };
}

const PROFILES: UserProxyProfileView[] = [
  profile('p1', 450_000, [
    { factId: 'f1', statement: '금연 객실이어야 합니다', importance: 5, hard: true, polarity: 'REQUIRE' },
    { factId: 'f2', statement: '조용한 방을 선호합니다', importance: 3, hard: false, polarity: 'PREFER' },
  ]),
  profile('p2', 380_000, [
    { factId: 'f3', statement: '흡연 객실은 피해야 합니다', importance: 5, hard: true, polarity: 'AVOID' },
    { factId: 'f4', statement: '역에서 가까운 곳', importance: 5, hard: false, polarity: 'PREFER' },
  ]),
  profile('p3', 520_000, [
    { factId: 'f5', statement: '같은 방에서 지내야 합니다', importance: 5, hard: true, polarity: 'REQUIRE' },
    { factId: 'f6', statement: '난바 근처가 좋습니다', importance: 3, hard: false, polarity: 'PREFER' },
  ]),
];

function proxyBrief(overrides: Partial<ProxySearchBrief> & { briefId: string; participantId: string }): ProxySearchBrief {
  return {
    schemaVersion: 1,
    category: 'stay',
    profileVersion: 'profile-v1',
    mustKeepRefs: [],
    preferenceTargetRefs: [],
    desiredTraits: [],
    avoidTraits: [],
    tradeoffs: [],
    searchTerms: ['오사카 숙소'],
    ...overrides,
  };
}

const PROXY_BRIEFS: ProxySearchBrief[] = [
  proxyBrief({
    briefId: 'brief-p1',
    participantId: 'p1',
    mustKeepRefs: ['f1'],
    preferenceTargetRefs: ['f2'],
    desiredTraits: ['조용한 방'],
    avoidTraits: ['흡연실'],
    tradeoffs: ['조식은 없어도 됩니다'],
    searchTerms: ['난바 호텔'],
  }),
  proxyBrief({
    briefId: 'brief-p2',
    participantId: 'p2',
    mustKeepRefs: ['f3'],
    preferenceTargetRefs: ['f4'],
    desiredTraits: ['역세권', '인스타 감성'],
    searchTerms: ['우메다 호텔'],
  }),
  proxyBrief({
    briefId: 'brief-p3',
    participantId: 'p3',
    mustKeepRefs: ['f5'],
    preferenceTargetRefs: ['f6'],
    desiredTraits: ['난바'],
    avoidTraits: ['텐노지'],
    searchTerms: ['오사카 3인 숙소'],
  }),
];

const NEUTRAL_BRIEF: NeutralSearchBrief = {
  schemaVersion: 1,
  briefId: 'brief-neutral',
  category: 'stay',
  charterVersion: 'charter-v1',
  hardConstraintRefs: ['hc-capacity', 'hc-budget'],
  searchTerms: ['오사카 숙소 3인 3박'],
};

function buildOsakaContext(
  overrides: Partial<Parameters<typeof buildStructuredSearchContext>[0]> = {},
): ReturnType<typeof buildStructuredSearchContext> {
  return buildStructuredSearchContext({
    category: 'stay',
    charter: CHARTER,
    proxyBriefs: PROXY_BRIEFS,
    neutralBrief: NEUTRAL_BRIEF,
    participantProfiles: PROFILES,
    knowledge: projectPackKnowledge(OSAKA_PACK),
    ...overrides,
  });
}

function findSoft(
  soft: readonly SoftPreference[],
  predicate: (preference: SoftPreference) => boolean,
): SoftPreference | undefined {
  return soft.find(predicate);
}

test('Destination Pack을 결정론적으로 투영한다', () => {
  const knowledge = projectPackKnowledge(OSAKA_PACK);

  assert.equal(knowledge.packId, 'jp-osaka');
  assert.equal(knowledge.timezone, 'Asia/Tokyo');
  assert.deepEqual(knowledge.providerIdsByCategory.stay, ['rakuten_travel', 'demo-fixture']);
  assert.deepEqual(knowledge.providerIdsByCategory.dining, ['hotpepper', 'demo-fixture']);
  // requiresAirTravel=true이므로 long_distance는 항공 Provider를 쓴다.
  assert.deepEqual(knowledge.providerIdsByCategory.long_distance, [
    'travelpayouts',
    'demo-fixture',
  ]);
  // Pack 선언 순서를 재정렬하지 않는다.
  assert.deepEqual(
    knowledge.areas.map((area) => area.name),
    ['난바', '우메다', '신사이바시', '텐노지', '베이에어리어', '닛폰바시'],
  );
  assert.deepEqual(knowledge.unverifiedFields, ['config.avgCosts', 'providers.poi']);
  assert.equal(knowledge.lodgingPricingIsEstimated, false);

  // Pack에 없는 지역은 만들어내지 않는다.
  assert.equal(resolvePackArea(knowledge, '난바')?.rank, 1);
  assert.equal(resolvePackArea(knowledge, '시부야'), null);

  assert.equal(
    JSON.stringify(projectPackKnowledge(OSAKA_PACK)),
    JSON.stringify(knowledge),
    '같은 Pack은 항상 같은 투영을 만든다',
  );
});

test('hard 제약과 soft 선호를 분리한다', () => {
  const { intent } = buildOsakaContext();

  // hard: 프로필의 hard fact만 필터가 된다.
  assert.deepEqual(
    intent.hard.requiredAmenities.map((constraint) => constraint.token),
    ['non_smoking'],
  );
  assert.deepEqual(intent.hard.requiredAmenities[0]?.participantIds, ['p1']);
  assert.deepEqual(intent.hard.requiredAmenities[0]?.factRefs, ['f1']);
  assert.deepEqual(
    intent.hard.forbiddenTraits.map((constraint) => constraint.token),
    ['smoking_room'],
  );
  assert.deepEqual(intent.hard.forbiddenTraits[0]?.participantIds, ['p2']);
  assert.equal(intent.hard.partySize, 3);
  assert.deepEqual(intent.hard.neutralHardConstraintRefs, ['hc-budget', 'hc-capacity']);

  // 가장 낮은 개인 상한이 구속 상한이다.
  assert.equal(intent.hard.priceCeiling.bindingKrw, 380_000);
  assert.deepEqual(intent.hard.priceCeiling.byParticipantKrw, {
    p1: 450_000,
    p2: 380_000,
    p3: 520_000,
  });

  // soft: 가중치이며 boolean filter가 아니다.
  const quiet = findSoft(
    intent.soft,
    (preference) => preference.target.kind === 'axis' && preference.target.axis === 'quiet',
  );
  assert.equal(quiet?.direction, 'PREFER');
  assert.equal(quiet?.weightBp, 6000, 'importance 3 → 6000bp');
  assert.deepEqual(quiet?.supportParticipantIds, ['p1']);

  const station = findSoft(
    intent.soft,
    (preference) =>
      preference.target.kind === 'axis' && preference.target.axis === 'station_access',
  );
  assert.equal(station?.weightBp, 10_000, 'importance 5 → 10000bp');

  // "흡연실 회피" = "금연 선호"로 방향을 뒤집어 soft로만 반영한다.
  const nonSmokingSoft = findSoft(
    intent.soft,
    (preference) =>
      preference.target.kind === 'amenity' && preference.target.token === 'non_smoking',
  );
  assert.equal(nonSmokingSoft?.direction, 'PREFER');
  assert.equal(nonSmokingSoft?.weightBp, 4000, '자유 표현 기본 가중치');

  // hard 토큰이 soft 목록에서 필터로 중복되지 않는다.
  assert.equal(
    intent.soft.filter(
      (preference) =>
        preference.target.kind === 'amenity' && preference.target.token === 'non_smoking',
    ).length,
    1,
  );

  // 자연어 tradeoffs와 searchTerms는 필터가 아니라 보존 대상이다.
  assert.deepEqual(intent.concessionTerms, ['조식은 없어도 됩니다']);
  assert.ok(intent.searchTerms.includes('난바 호텔'));
  assert.ok(intent.searchTerms.includes('오사카 숙소 3인 3박'));
});

test('구조화하지 못한 표현과 참조를 추측하지 않고 드러낸다', () => {
  const { intent } = buildOsakaContext();

  assert.deepEqual(
    intent.unmappedTerms.map((term) => term.term),
    ['인스타 감성'],
  );
  assert.equal(intent.unmappedTerms[0]?.source, 'desiredTraits');
  assert.equal(intent.unresolvedRefs.length, 0);

  // 프로필을 주지 않으면 hard로 승격하지 않고 미해결로 남긴다.
  const withoutProfiles = buildOsakaContext({ participantProfiles: [] });
  assert.equal(withoutProfiles.intent.hard.requiredAmenities.length, 0);
  assert.equal(withoutProfiles.intent.hard.forbiddenTraits.length, 0);
  assert.equal(withoutProfiles.intent.hard.roomSplitAuthority, 'UNKNOWN');
  assert.ok(withoutProfiles.intent.unresolvedRefs.length > 0);
  assert.ok(
    withoutProfiles.intent.unresolvedRefs.every((ref) => ref.reason === 'PROFILE_NOT_PROVIDED'),
  );
});

test('Pack에 있는 지역만 지역 선호로 인정한다', () => {
  const context = buildOsakaContext();

  assert.equal(context.primaryArea, '난바');
  assert.equal(context.targets[0]?.source, 'INTENT_PREFERRED_AREA');
  assert.equal(context.targets[0]?.weightBp, 6000);
  assert.deepEqual(context.avoidedAreas, ['텐노지']);
  // 회피 지역은 조회 대상에서 빠지고, 남은 Pack 지역은 선언 순서로 뒤따른다.
  assert.deepEqual(
    context.targets.map((target) => target.area),
    ['난바', '우메다', '신사이바시', '베이에어리어', '닛폰바시'],
  );

  // Pack에 없는 지역을 원해도 지역 선호가 생기지 않는다.
  const unknownArea = buildOsakaContext({
    proxyBriefs: [
      proxyBrief({
        briefId: 'brief-p1',
        participantId: 'p1',
        desiredTraits: ['시부야'],
      }),
    ],
    participantProfiles: [],
  });
  assert.equal(
    unknownArea.intent.soft.filter((preference) => preference.target.kind === 'area').length,
    0,
  );
  assert.deepEqual(
    unknownArea.intent.unmappedTerms.map((term) => term.term),
    ['시부야'],
  );
});

test('객실 분리 권한을 fail-closed로 다룬다', () => {
  // 같은 방 요구 → 분리 불가 → 1객실
  const together = buildOsakaContext();
  assert.equal(together.intent.hard.roomSplitAuthority, 'SPLIT_NOT_ALLOWED');
  assert.equal(together.roomCount, 1);

  // 확인되지 않음 → 분리 동의로 해석하지 않는다 → 1객실
  assert.equal(deriveRoomCount(3, 'UNKNOWN', 2), 1);

  // 명시적 분리 허용 → 정원에 따라 객실 수를 올린다
  const splitAllowed = buildOsakaContext({
    participantProfiles: [
      PROFILES[0] as UserProxyProfileView,
      PROFILES[1] as UserProxyProfileView,
      profile('p3', 520_000, [
        {
          factId: 'f5',
          statement: '객실 분리 허용',
          importance: 5,
          hard: true,
          polarity: 'REQUIRE',
        },
        { factId: 'f6', statement: '난바 근처가 좋습니다', importance: 3, hard: false, polarity: 'PREFER' },
      ]),
    ],
  });
  assert.equal(splitAllowed.intent.hard.roomSplitAuthority, 'SPLIT_ALLOWED');
  assert.equal(splitAllowed.roomCount, 2, '성인 3명 / 객실 정원 2명 → 2객실');
  assert.equal(deriveRoomCount(3, 'SPLIT_ALLOWED', 3), 1);
});

test('예산 상한 불일치는 더 엄격한 값으로 닫고 충돌로 남긴다', () => {
  const context = buildOsakaContext({
    participantProfiles: [
      PROFILES[0] as UserProxyProfileView,
      profile('p2', 300_000, [
        { factId: 'f3', statement: '흡연 객실은 피해야 합니다', importance: 5, hard: true, polarity: 'AVOID' },
        { factId: 'f4', statement: '역에서 가까운 곳', importance: 5, hard: false, polarity: 'PREFER' },
      ]),
      PROFILES[2] as UserProxyProfileView,
    ],
  });

  assert.equal(context.intent.hard.priceCeiling.bindingKrw, 300_000);
  assert.equal(context.intent.hard.priceCeiling.byParticipantKrw['p2'], 300_000);
  assert.ok(
    context.intent.conflicts.some((conflict) => conflict.code === 'BUDGET_CEILING_MISMATCH'),
  );
});

test('기존 CandidateEvidence 실행 계약과 호환되는 맥락을 만든다', () => {
  const context = buildOsakaContext();

  assert.equal(context.queryClass, 'hotel.search');
  assert.equal(context.executablePath, true);
  assert.deepEqual(context.allowedProviderIds, ['rakuten_travel', 'demo-fixture']);
  assert.equal(context.nights, 3);
  assert.deepEqual(context.blockers, []);

  // Brief 계보: Proxy Brief 3개 + 중립 Brief 1개
  assert.deepEqual(context.expectedBriefIds, [
    'brief-p1',
    'brief-p2',
    'brief-p3',
    'brief-neutral',
  ]);
  assert.equal(context.queryBudget, 4);

  const bound = toCandidateEvidenceExecutionContext(context);
  assert.equal(bound.packId, 'jp-osaka');
  assert.equal(bound.category, 'stay');
  assert.equal(bound.area, '난바');
  assert.deepEqual(bound.center, { lat: 34.6937, lng: 135.5023 });

  // candidate-evidence.ts의 validateInput 허용 범위를 만족해야 한다.
  assert.ok(Number.isInteger(bound.roomCount) && bound.roomCount >= 1);
  assert.ok(Number.isInteger(bound.limit) && bound.limit >= 1 && bound.limit <= 20);
  assert.ok(bound.searchRadiusKm >= 0.1 && bound.searchRadiusKm <= 3);
  assert.ok(Number.isInteger(bound.queryBudget) && bound.queryBudget >= 1 && bound.queryBudget <= 4);
  // 역 접근성 선호가 강하면 반경을 좁힌다.
  assert.equal(bound.searchRadiusKm, 1);
});

test('진행할 수 없는 상황은 blocker로 닫는다', () => {
  // Brief 5개 → QueryPlan 예산 4개 초과
  const tooManyBriefs = buildOsakaContext({
    proxyBriefs: [
      ...PROXY_BRIEFS,
      proxyBrief({ briefId: 'brief-p4', participantId: 'p1' }),
      proxyBrief({ briefId: 'brief-p5', participantId: 'p2' }),
    ],
  });
  assert.ok(
    tooManyBriefs.blockers.some((blocker) => blocker.code === 'QUERY_BUDGET_INSUFFICIENT'),
  );
  assert.throws(() => toCandidateEvidenceExecutionContext(tooManyBriefs), /조회를 시작할 수 없습니다/u);

  // 후보 조달 대상이 아닌 카테고리는 queryClass를 만들지 않는다.
  assert.equal(queryClassForCategory('schedule', true), null);
  assert.equal(queryClassForCategory('stay', true), 'hotel.search');
  assert.equal(queryClassForCategory('long_distance', false), 'intercity.timetable');
});

test('계약 위반 입력을 조용히 넘기지 않는다', () => {
  assert.throws(
    () =>
      deriveStructuredSearchIntent({
        category: 'stay',
        charter: CHARTER,
        proxyBriefs: PROXY_BRIEFS,
        neutralBrief: { ...NEUTRAL_BRIEF, charterVersion: 'charter-v0' },
        participantProfiles: PROFILES,
      }),
    /CHARTER_VERSION_MISMATCH|TripCharter 버전/u,
  );

  assert.throws(
    () =>
      deriveStructuredSearchIntent({
        category: 'stay',
        charter: CHARTER,
        proxyBriefs: [proxyBrief({ briefId: 'brief-x', participantId: 'ghost' })],
        neutralBrief: NEUTRAL_BRIEF,
      }),
    /없는 참가자/u,
  );

  assert.throws(
    () =>
      deriveStructuredSearchIntent({
        category: 'stay',
        charter: CHARTER,
        proxyBriefs: [
          proxyBrief({ briefId: 'brief-dup', participantId: 'p1' }),
          proxyBrief({ briefId: 'brief-dup', participantId: 'p2' }),
        ],
        neutralBrief: NEUTRAL_BRIEF,
      }),
    /중복 briefId/u,
  );
});

test('같은 입력이면 항상 같은 출력이 나온다', () => {
  const first = buildOsakaContext();
  const second = buildOsakaContext();
  assert.equal(JSON.stringify(first), JSON.stringify(second));

  // 입력 순서가 달라도 결과는 같다.
  const reordered = buildOsakaContext({
    proxyBriefs: [...PROXY_BRIEFS].reverse(),
    participantProfiles: [...PROFILES].reverse(),
  });
  assert.equal(JSON.stringify(reordered), JSON.stringify(first));
});

test('이 계층에는 네트워크 I/O와 RAG 구성요소가 없다', () => {
  // 주석은 제외하고 실제 코드만 검사한다 (주석에는 금지 목록을 설명으로 적어 두었다).
  const sources = ['pack-knowledge.ts', 'search-intent.ts', 'structured-search-context.ts'].map(
    (name) =>
      readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .replace(/\/\/[^\n]*/gu, ''),
  );
  const forbidden = [
    'fetch(',
    'node:http',
    'node:https',
    'undici',
    'embedding',
    'vectorDb',
    'chunking',
  ];
  for (const source of sources) {
    for (const needle of forbidden) {
      assert.equal(source.includes(needle), false, `${needle}를 사용하지 않아야 합니다`);
    }
  }
});
