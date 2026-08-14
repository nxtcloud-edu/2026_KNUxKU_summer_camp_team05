import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FlightCandidate, HotelCandidate, TransportCandidate } from '@tm/contracts';
import { assessCandidates, costOf, type AttributeContext } from './attributes.js';
import { scoreCandidates, selectWinner } from './scoring.js';

const context = (overrides: Partial<AttributeContext['hard']> = {}, groupSize = 4): AttributeContext => ({
  hard: {
    allergens: [],
    mobilityNeeds: [],
    noGoItems: [],
    budgetCapPerPersonKrw: null,
    ...overrides,
  },
  groupSize,
});

const flight = (id: string, perPerson: number, connections = 0, departAt = '2026-10-02T09:00:00+09:00'): FlightCandidate => ({
  kind: 'flight',
  id,
  source: 'amadeus',
  fetchedAt: '2026-08-14T00:00:00.000Z',
  disqualified: false,
  disqualifyReason: null,
  outbound: {
    carrier: { code: 'KE', name: '대한항공' },
    flightNumber: 'KE001',
    departure: { airport: 'ICN', terminal: null, at: departAt },
    arrival: { airport: 'KIX', terminal: null, at: '2026-10-02T11:00:00+09:00' },
    durationMin: 120,
    connections,
  },
  inbound: {
    carrier: { code: 'KE', name: '대한항공' },
    flightNumber: 'KE002',
    departure: { airport: 'KIX', at: '2026-10-04T15:00:00+09:00' },
    arrival: { airport: 'ICN', at: '2026-10-04T17:00:00+09:00' },
    durationMin: 120,
    connections: 0,
  },
  price: { amount: perPerson, currency: 'KRW', confidence: 'live', perPersonRoundTrip: perPerson, groupTotal: perPerson * 4 },
  baggage: { checkedIncluded: true, checkedKg: 23, extraCheckedFeePerPerson: null },
  seatsAvailable: 9,
  groupInventoryVerified: true,
  effectiveTotal: { perPerson, note: '수하물 포함' },
  bookingUrl: null,
});

const hotel = (id: string, totalPerPerson: number, overrides: Partial<HotelCandidate> = {}): HotelCandidate => ({
  kind: 'hotel',
  id,
  source: 'rakuten',
  fetchedAt: '2026-08-14T00:00:00.000Z',
  disqualified: false,
  disqualifyReason: null,
  name: `호텔 ${id}`,
  type: 'hotel',
  location: { lat: 34.6, lng: 135.5, area: '난바', address: null },
  price: { amount: totalPerPerson, currency: 'KRW', confidence: 'live', perNightPerPerson: totalPerPerson / 2, totalPerPerson, groupTotal: totalPerPerson * 4, taxesIncluded: true },
  meals: { breakfastIncluded: false, dinnerIncluded: false, mealValuePerPersonPerNight: null, effectiveLodgingCost: null, dietSupportVerified: false },
  capacity: { maxGuests: 4, roomOptions: [{ config: '트윈 x2', totalGuests: 4, pricePerNight: 200000 }] },
  roomCombinationVerified: true,
  allInPriceVerified: true,
  amenities: [],
  accessibility: { wheelchair: true, elevator: true, stepFree: true },
  locationMetrics: { station: { label: '난바역', minutes: 5 } },
  rating: { score: 8.5, count: 300 },
  cancelPolicy: { freeUntil: null, penaltyAfter: null },
  bookingUrl: null,
  ...overrides,
});

const transport = (id: string, fare: number, overrides: Partial<TransportCandidate> = {}): TransportCandidate => ({
  kind: 'transport',
  id,
  source: 'odsay',
  fetchedAt: '2026-08-14T00:00:00.000Z',
  disqualified: false,
  disqualifyReason: null,
  variant: 'airport_transfer',
  label: `경로 ${id}`,
  segments: [],
  totals: { durationMin: 60, farePerPersonKrw: fare, transfers: 1, walkMeters: 400 },
  policy: null,
  accessibility: { stairsRequired: false, elevatorAvailable: true, luggageFriendly: true, wheelchairOk: true, verified: true },
  bookingUrl: null,
  ...overrides,
});

test('가격 축은 후보 집합 안의 상대 위치다', () => {
  const result = assessCandidates([flight('a', 300_000), flight('b', 500_000)], context());

  assert.equal(result[0]?.attributes.match['price_low'], 1, '가장 싼 후보가 1');
  assert.equal(result[1]?.attributes.match['price_low'], 0, '가장 비싼 후보가 0');
});

test('후보가 하나뿐이면 비교 정보가 없으므로 1이다 — 더 나쁜 것이 없다', () => {
  const result = assessCandidates([flight('a', 300_000)], context());
  assert.equal(result[0]?.attributes.match['price_low'], 1);
});

test('항공 비교 기준은 항공료가 아니라 effectiveTotal이다', () => {
  const candidate = flight('a', 300_000);
  candidate.effectiveTotal = { perPerson: 380_000, note: '수하물 별도 8만' };
  assert.equal(costOf(candidate), 380_000);
});

test('숙소 비교 기준은 식사 가치를 뺀 effectiveLodgingCost다', () => {
  const candidate = hotel('a', 400_000, {
    meals: { breakfastIncluded: true, dinnerIncluded: false, mealValuePerPersonPerNight: 15_000, effectiveLodgingCost: 370_000, dietSupportVerified: true },
  });
  assert.equal(costOf(candidate), 370_000);
});

test('경유가 많을수록 편의 점수가 낮다', () => {
  const result = assessCandidates([flight('direct', 300_000, 0), flight('via', 300_000, 2)], context());
  const direct = result[0]?.attributes.match['transport_comfort'] ?? 0;
  const via = result[1]?.attributes.match['transport_comfort'] ?? 0;
  assert.ok(direct > via, `직항이 더 편해야 한다 (${direct} vs ${via})`);
});

test('판단할 근거가 없는 축은 0이 아니라 없음이다', () => {
  const result = assessCandidates([hotel('a', 300_000, { rating: null })], context());
  assert.equal('comfort_high' in (result[0]?.attributes.match ?? {}), false, '0을 넣으면 최악으로 읽힌다');
});

test('그룹 예산 상한을 넘으면 실격이다', () => {
  const result = assessCandidates(
    [flight('cheap', 300_000), flight('pricey', 900_000)],
    context({ budgetCapPerPersonKrw: 500_000 }),
  );

  assert.equal(result[0]?.attributes.disqualifyReason, undefined);
  assert.ok(result[1]?.attributes.disqualifyReason?.includes('초과'), result[1]?.attributes.disqualifyReason);
});

test('수용 인원이 모자란 숙소는 실격이다', () => {
  const result = assessCandidates(
    [hotel('small', 300_000, { capacity: { maxGuests: 2, roomOptions: [{ config: '더블', totalGuests: 2, pricePerNight: 100_000 }] } })],
    context({}, 5),
  );
  assert.ok(result[0]?.attributes.disqualifyReason?.includes('5명'), result[0]?.attributes.disqualifyReason);
});

test('접근성이 "확인된 불가"면 실격이지만 "미확인"은 실격이 아니다', () => {
  const confirmedBad = assessCandidates(
    [hotel('bad', 300_000, { accessibility: { wheelchair: false, elevator: false, stepFree: false } })],
    context({ mobilityNeeds: ['휠체어'] }),
  );
  assert.ok(confirmedBad[0]?.attributes.disqualifyReason !== undefined);

  const unknown = assessCandidates(
    [hotel('unknown', 300_000, { accessibility: { wheelchair: null, elevator: null, stepFree: null } })],
    context({ mobilityNeeds: ['휠체어'] }),
  );
  assert.equal(unknown[0]?.attributes.disqualifyReason, undefined, '정보 없음으로 후보를 지우면 후보가 사라진다');
  assert.ok(
    unknown[0]?.unverified.some((entry) => entry.includes('접근성')),
    '대신 fail-closed 대상으로 표시한다',
  );
});

test('그룹 좌석 미확인은 fail-closed 목록에 남는다', () => {
  const result = assessCandidates([flight('a', 300_000)], context());
  assert.equal(result[0]?.unverified.length, 0, '확인됐으면 비어 있다');

  const unverified = assessCandidates(
    [{ ...flight('b', 300_000), groupInventoryVerified: false }],
    context(),
  );
  assert.ok(unverified[0]?.unverified.some((entry) => entry.includes('그룹 좌석')));
});

test('알레르기가 있는데 식사 대응이 미확인이면 fail-closed다', () => {
  const result = assessCandidates(
    [hotel('a', 300_000, { meals: { breakfastIncluded: true, dinnerIncluded: false, mealValuePerPersonPerNight: null, effectiveLodgingCost: null, dietSupportVerified: false } })],
    context({ allergens: ['새우'] }),
  );
  assert.ok(result[0]?.unverified.some((entry) => entry.includes('알레르기')));
});

test('기피 항목이 후보에 있으면 소프트 위반으로 감점된다', () => {
  const result = assessCandidates(
    [hotel('a', 300_000, { name: '호텔 클럽하우스', amenities: ['클럽'] })],
    context({ noGoItems: ['클럽'] }),
  );
  assert.ok((result[0]?.attributes.softViolations ?? []).length > 0);
});

test('교통 접근성 미확인은 항상 fail-closed다 — 막차를 놓치면 계획이 무너진다', () => {
  const result = assessCandidates(
    [transport('a', 1_500, { accessibility: { stairsRequired: null, elevatorAvailable: null, luggageFriendly: null, wheelchairOk: null, verified: false } })],
    context(),
  );
  assert.ok(result[0]?.unverified.some((entry) => entry.includes('막차')));
});

test('산출된 속성이 스코어링에 그대로 들어간다 — 심판을 거치지 않는다', () => {
  const assessed = assessCandidates(
    [flight('cheap', 300_000), flight('pricey', 600_000)],
    context({ budgetCapPerPersonKrw: 1_000_000 }),
  );

  const board = scoreCandidates(
    [
      { userId: 'u_budget', weights: { price_low: 1 } },
      { userId: 'u_comfort', weights: { transport_comfort: 1 } },
    ],
    assessed.map((entry) => entry.attributes),
  );
  const winner = selectWinner(board);

  assert.equal(winner?.winner.candidateId, 'cheap');
  assert.equal(board.scored.length, 2);
});

test('실격 후보는 스코어링 이전에 빠지고 사유가 남는다', () => {
  const assessed = assessCandidates(
    [flight('ok', 300_000), flight('over', 900_000)],
    context({ budgetCapPerPersonKrw: 500_000 }),
  );
  const board = scoreCandidates([{ userId: 'u', weights: { price_low: 1 } }], assessed.map((entry) => entry.attributes));

  assert.equal(board.scored.length, 1);
  assert.equal(board.disqualified.length, 1);
  assert.ok(board.disqualified[0]?.reason.includes('초과'));
});

test('가격이 unknown인 숙소는 최저가로 취급되지 않는다', () => {
  // TourAPI 숙박은 정원은 주면서 요금은 0으로 준다. 그대로 쓰면 그 후보가
  // 집합의 최저가가 되어 price_low에서 1점을 받고 예산 비교를 전부 이긴다.
  const priceless = hotel('요금미상', 0, {
    price: {
      amount: 0,
      currency: 'KRW',
      confidence: 'unknown',
      perNightPerPerson: 0,
      totalPerPerson: 0,
      groupTotal: 0,
      taxesIncluded: false,
    },
    capacity: {
      maxGuests: 3,
      roomOptions: [{ config: '스탠다드', totalGuests: 3, pricePerNight: null }],
    },
  });
  const assessed = assessCandidates([priceless, hotel('싼곳', 200_000), hotel('비싼곳', 500_000)], context());

  // 모르는 축은 없는 축이다. 0점도 1점도 아니고 아예 매칭이 없다.
  assert.equal(
    'price_low' in (assessed[0]?.attributes.match ?? {}),
    false,
    '요금을 모르는 후보에 가격 점수를 주면 안 된다',
  );
  assert.equal(assessed[0]?.costPerPersonKrw, null);

  // 가격을 아는 후보들끼리의 상대 위치는 0에 오염되지 않는다.
  assert.equal(assessed[1]?.attributes.match['price_low'], 1, '아는 것 중 싼 쪽이 1점');
  assert.equal(assessed[2]?.attributes.match['price_low'], 0);
});
