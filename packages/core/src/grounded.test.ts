import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candidateSchema } from '@tm/contracts';
import { checkUtterance, factcheckGate } from './factcheck.js';
import { buildGroundedIndexFromRows, groundedFromCandidate } from './grounded.js';

/**
 * 후보 → 팩트체크 근거 추출. 감시자가 쓰는 진입점이다.
 */

const hotel = candidateSchema.parse({
  kind: 'hotel',
  id: 'H1',
  source: 'rakuten_travel',
  fetchedAt: '2026-08-13T00:00:00.000Z',
  name: '난바 호텔',
  type: 'hotel',
  location: { lat: 34.6659, lng: 135.5015, area: '난바', address: '오사카시 주오구 난바 3-1-1' },
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
  amenities: [],
  accessibility: { wheelchair: null, elevator: true, stepFree: null },
  locationMetrics: { station: { label: '난바역', minutes: 5 } },
  rating: { score: 8.6, count: 1200 },
  cancelPolicy: { freeUntil: null, penaltyAfter: null },
  bookingUrl: null,
});

const flight = candidateSchema.parse({
  kind: 'flight',
  id: 'F1',
  source: 'amadeus',
  fetchedAt: '2026-08-13T00:00:00.000Z',
  outbound: {
    carrier: { code: 'KE', name: 'KOREAN AIR' },
    flightNumber: 'KE723',
    departure: { airport: 'ICN', terminal: '2', at: '2026-10-16T09:00:00' },
    arrival: { airport: 'KIX', terminal: '1', at: '2026-10-16T11:05:00' },
    durationMin: 125,
    connections: 0,
  },
  inbound: {
    carrier: { code: 'KE', name: 'KOREAN AIR' },
    flightNumber: 'KE724',
    departure: { airport: 'KIX', at: '2026-10-18T12:00:00' },
    arrival: { airport: 'ICN', at: '2026-10-18T14:10:00' },
    durationMin: 130,
    connections: 0,
  },
  price: { amount: 330000, currency: 'KRW', confidence: 'live', perPersonRoundTrip: 330000, groupTotal: 1980000 },
  baggage: { checkedIncluded: true, checkedKg: null, extraCheckedFeePerPerson: null },
  seatsAvailable: 9,
  effectiveTotal: { perPerson: 330000, note: '' },
  bookingUrl: null,
});

const transport = candidateSchema.parse({
  kind: 'transport',
  id: 'T1',
  source: 'odsay',
  fetchedAt: '2026-08-13T00:00:00.000Z',
  variant: 'airport_transfer',
  label: '간사이공항 → 난바',
  segments: [
    {
      mode: 'transit',
      operator: '난카이선',
      from: '간사이공항',
      to: '난바',
      departAt: null,
      arriveAt: null,
      durationMin: 45,
      farePerPersonKrw: 9200,
    },
  ],
  totals: { durationMin: 45, farePerPersonKrw: 9200, transfers: 0, walkMeters: 200 },
  policy: null,
  accessibility: {
    stairsRequired: null,
    elevatorAvailable: null,
    luggageFriendly: null,
    wheelchairOk: null,
    verified: false,
  },
  bookingUrl: null,
});

test('숙소에서 금액·주소·소요시간을 뽑는다', () => {
  const grounded = groundedFromCandidate(hotel);

  assert.ok(grounded.amountsKrw?.includes(82000));
  assert.ok(grounded.amountsKrw?.includes(984000));
  assert.ok(grounded.amountsKrw?.includes(246000), '객실 조합 가격도 근거다');
  assert.ok(grounded.addresses?.includes('오사카시 주오구 난바 3-1-1'));
  assert.ok(grounded.durationsMin?.includes(5), '역까지 도보 5분');
});

test('항공에서 시각과 비행시간을 뽑는다', () => {
  const grounded = groundedFromCandidate(flight);

  assert.ok(grounded.amountsKrw?.includes(330000));
  assert.ok(grounded.times?.some((time) => time.includes('09:00')));
  assert.ok(grounded.durationsMin?.includes(125));
});

test('교통에서 구간 요금과 지명을 뽑는다', () => {
  const grounded = groundedFromCandidate(transport);

  assert.ok(grounded.amountsKrw?.includes(9200));
  assert.ok(grounded.addresses?.includes('간사이공항'));
  assert.ok(grounded.durationsMin?.includes(45));
});

test('외화 후보는 환율을 줘야 원화 금액이 근거가 된다', () => {
  if (hotel.kind !== 'hotel') throw new Error('픽스처가 숙소가 아닙니다');
  const jpy = candidateSchema.parse({
    ...hotel,
    id: 'H_JPY',
    price: {
      ...hotel.price,
      amount: 9000,
      currency: 'JPY',
      perNightPerPerson: 9000,
      totalPerPerson: 18000,
      groupTotal: 108000,
    },
  });

  const withoutFx = groundedFromCandidate(jpy);
  assert.equal(withoutFx.amountsKrw?.includes(81000), false);

  const withFx = groundedFromCandidate(jpy, { fxToKrw: { JPY: 9 } });
  assert.ok(withFx.amountsKrw?.includes(81000), '9,000엔 × 9 = 81,000원');
  assert.ok(withFx.amountsKrw?.includes(9000), '원 통화 금액도 남긴다');
});

test('실격·advisory 표시가 그대로 전달된다', () => {
  const grounded = groundedFromCandidate(hotel, { disqualified: true, advisory: true });

  assert.equal(grounded.disqualified, true);
  assert.equal(grounded.advisory, true);
});

test('DB 행에서 인덱스를 만든다', () => {
  const { index, skipped } = buildGroundedIndexFromRows([
    { externalId: 'H1', payload: hotel },
    { externalId: 'F1', payload: flight, disqualified: true },
  ]);

  assert.deepEqual(skipped, []);
  assert.equal(index.byExternalId.size, 2);
  assert.equal(index.byExternalId.get('F1')?.disqualified, true);
});

test('스키마를 통과하지 못한 행은 사유와 함께 보고한다', () => {
  // 조용히 버리면 감시자가 "근거 없음"으로 오판한다.
  const { index, skipped } = buildGroundedIndexFromRows([
    { externalId: 'X1', payload: { kind: 'hotel', id: 'X1' } },
  ]);

  assert.equal(index.byExternalId.size, 0);
  assert.equal(skipped[0]?.externalId, 'X1');
  assert.ok(skipped[0]?.reason.length > 0);
});

test('감시자 전 구간: 후보 적재 → 인덱스 → 발화 검사', () => {
  const { index } = buildGroundedIndexFromRows([{ externalId: 'H1', payload: hotel }]);

  const ok = checkUtterance({
    speaker: 'referee',
    text: '난바 호텔은 1박 82,000원이고 역에서 5분입니다.',
    claims: [
      { kind: 'price', externalId: 'H1', value: 82000 },
      { kind: 'duration', externalId: 'H1', value: 5 },
    ],
    index,
  });
  assert.equal(factcheckGate(ok).decision, 'accept');

  const hallucinated = checkUtterance({
    speaker: 'referee',
    text: '난바 호텔은 1박 60,000원입니다.',
    claims: [{ kind: 'price', externalId: 'H1', value: 60000 }],
    index,
  });
  assert.equal(factcheckGate(hallucinated).decision, 'reject');
});
