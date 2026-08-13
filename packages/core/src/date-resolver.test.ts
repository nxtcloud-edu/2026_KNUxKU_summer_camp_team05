import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUTO_CONFIRM_MARGIN,
  datesInWindow,
  resolveDates,
  resolveNights,
  type DateResolverInput,
  type ParticipantAvailability,
} from './date-resolver.js';

/**
 * DateResolver. 근거: travel-mediation-plan.md 7.2 · 3.3
 *
 * 가능일만 받는 설계이므로 "찍지 않은 날 = 불가"다.
 * 완화 경로(박수 축소 → 부분 참석 → 방장 호출)가 기본 경로에 가깝다.
 */

/** 2026-10-01(목)부터 n일간의 날짜 */
const days = (from: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) => {
    const base = Date.parse(`${from}T00:00:00Z`);
    return new Date(base + index * 86_400_000).toISOString().slice(0, 10);
  });

const person = (
  userId: string,
  availableDates: string[],
  overrides: Partial<ParticipantAvailability> = {},
): ParticipantAvailability => ({
  userId,
  availableDates,
  preferredNights: 2,
  nightFlexible: true,
  ...overrides,
});

const pack = {
  recommendedNights: 2,
  requiresAirTravel: false,
  weatherProfile: { bestMonths: [10], rainyMonths: [7] },
};

const input = (overrides: Partial<DateResolverInput> = {}): DateResolverInput => ({
  participants: [person('a', days('2026-10-16', 5)), person('b', days('2026-10-16', 5))],
  pack,
  today: '2026-09-01',
  ...overrides,
});

test('구간 날짜는 박수 + 1일이다', () => {
  assert.deepEqual(datesInWindow('2026-10-16', 2), ['2026-10-16', '2026-10-17', '2026-10-18']);
});

test('희망 박수는 최빈값으로 정한다', () => {
  const participants = [
    person('a', [], { preferredNights: 3 }),
    person('b', [], { preferredNights: 2 }),
    person('c', [], { preferredNights: 2 }),
  ];
  assert.equal(resolveNights(participants, 4), 2);
});

test('희망 박수 응답이 없으면 Pack 권장값을 쓴다', () => {
  const participants = [person('a', [], { preferredNights: null })];
  assert.equal(resolveNights(participants, 3), 3);
});

test('동률이면 짧은 쪽을 고른다 — 짧을수록 성립 가능성이 높다', () => {
  const participants = [
    person('a', [], { preferredNights: 3 }),
    person('b', [], { preferredNights: 2 }),
  ];
  assert.equal(resolveNights(participants, 4), 2);
});

test('전원 가능한 구간을 찾는다', () => {
  const result = resolveDates(input());

  assert.equal(result.relaxation, 'none');
  assert.ok(result.windows.length > 0);
  assert.deepEqual(result.windows[0]?.absentees, []);
  assert.equal(result.windows[0]?.nights, 2);
});

test('찍지 않은 날은 불가다 — 겹치지 않으면 후보가 없다', () => {
  const result = resolveDates(
    input({
      participants: [
        person('a', days('2026-10-01', 3), { nightFlexible: false }),
        person('b', days('2026-11-01', 3), { nightFlexible: false }),
      ],
    }),
  );

  assert.equal(result.status, 'impossible');
  assert.match(result.reason, /가능일을 더 입력/);
});

test('전원 가능한 구간이 없으면 박수를 줄여 재탐색한다', () => {
  // a와 b는 이틀만 겹친다 → 2박(3일)은 불가, 1박(2일)은 가능
  const result = resolveDates(
    input({
      participants: [
        person('a', days('2026-10-16', 3)),
        person('b', days('2026-10-17', 3)),
      ],
    }),
  );

  assert.equal(result.relaxation, 'fewer_nights');
  assert.equal(result.windows[0]?.nights, 1);
  assert.match(result.reason, /1박으로 줄였습니다/);
});

test('박수 축소를 허용하지 않은 사람은 그 구간의 불참자로 남는다', () => {
  const result = resolveDates(
    input({
      participants: [
        person('a', days('2026-10-16', 3)),
        person('b', days('2026-10-17', 3)),
        person('c', days('2026-10-16', 5), { nightFlexible: false }),
      ],
    }),
  );

  assert.equal(result.relaxation, 'fewer_nights');
  assert.ok(result.windows[0]?.absentees.includes('c'), '숨기지 않고 불참자로 남긴다');
});

test('박수를 줄여도 안 되면 부분 참석 구간을 내고 방장을 부른다', () => {
  const result = resolveDates(
    input({
      participants: [
        person('a', days('2026-10-16', 4), { nightFlexible: false }),
        person('b', days('2026-10-16', 4), { nightFlexible: false }),
        person('c', days('2026-12-01', 4), { nightFlexible: false }),
      ],
    }),
  );

  assert.equal(result.relaxation, 'partial_attendance');
  assert.equal(result.status, 'needs_host_choice');
  assert.equal(result.chosen, null, '부분 참석은 자동 확정하지 않는다');
  assert.deepEqual(result.windows[0]?.absentees, ['c']);
});

test('최소 인원조차 못 모으면 impossible이다', () => {
  const result = resolveDates(
    input({
      participants: [
        person('a', days('2026-10-16', 4), { nightFlexible: false }),
        person('b', days('2026-12-01', 4), { nightFlexible: false }),
        person('c', days('2027-02-01', 4), { nightFlexible: false }),
      ],
    }),
  );

  assert.equal(result.status, 'impossible');
});

test('설문 제출자가 2명 미만이면 계산하지 않는다', () => {
  const result = resolveDates(input({ participants: [person('a', days('2026-10-16', 5))] }));
  assert.equal(result.status, 'impossible');
});

test('avoidDates가 포함된 구간은 후보에서 빠진다', () => {
  const result = resolveDates(
    input({
      participants: [person('a', days('2026-12-30', 4)), person('b', days('2026-12-30', 4))],
      pack: { ...pack, avoidDates: ['2026-12-31'] },
    }),
  );

  for (const window of result.windows) {
    assert.equal(datesInWindow(window.start, window.nights).includes('2026-12-31'), false);
  }
});

test('1위가 2위를 크게 앞서면 토론 없이 확정한다', () => {
  // 가능 구간이 하나뿐이면 비교 대상이 없다 → 즉시 확정
  const result = resolveDates(
    input({
      participants: [person('a', days('2026-10-16', 3)), person('b', days('2026-10-16', 3))],
    }),
  );

  assert.equal(result.status, 'confirmed');
  assert.notEqual(result.chosen, null);
});

test('후보 점수가 비슷하면 R0 논의로 넘긴다', () => {
  // 2주 내내 가능 → 비슷한 주말 구간이 여러 개 나온다
  const result = resolveDates(
    input({
      participants: [person('a', days('2026-10-05', 21)), person('b', days('2026-10-05', 21))],
    }),
  );

  assert.equal(result.windows.length, 3);
  if (result.status === 'needs_discussion') {
    const gap = (result.windows[0]?.score ?? 0) - (result.windows[1]?.score ?? 0);
    assert.ok(gap < AUTO_CONFIRM_MARGIN);
  }
});

test('주말이 포함된 구간이 평일 구간보다 높게 나온다', () => {
  // 2026-10-16은 금요일, 10-19는 월요일
  const weekend = resolveDates(
    input({ participants: [person('a', days('2026-10-16', 3)), person('b', days('2026-10-16', 3))] }),
  );
  const weekday = resolveDates(
    input({ participants: [person('a', days('2026-10-19', 3)), person('b', days('2026-10-19', 3))] }),
  );

  assert.ok(
    (weekend.windows[0]?.score ?? 0) > (weekday.windows[0]?.score ?? 0),
    `주말 ${weekend.windows[0]?.score} vs 평일 ${weekday.windows[0]?.score}`,
  );
});

test('항공료가 있으면 싼 날이 높게 나오고 breakdown에 실린다', () => {
  const participants = [person('a', days('2026-10-05', 21)), person('b', days('2026-10-05', 21))];
  const flightPrices = Object.fromEntries(
    days('2026-10-05', 21).map((date) => [date, date === '2026-10-06' ? 200_000 : 900_000]),
  );

  const result = resolveDates(
    input({
      participants,
      pack: { ...pack, requiresAirTravel: true },
      flightPrices,
    }),
  );

  assert.equal(result.windows[0]?.start, '2026-10-06', '가장 싼 날이 1위여야 한다');
  assert.ok(result.windows[0]?.breakdown['flight'] !== undefined);
});

test('항공료 데이터가 없으면 항공 가중치를 요일로 이관한다', () => {
  const result = resolveDates(
    input({
      participants: [person('a', days('2026-10-05', 21)), person('b', days('2026-10-05', 21))],
      pack: { ...pack, requiresAirTravel: true },
    }),
  );

  // 없는 값을 추정해 채우지 않는다. flight 항목 자체가 없어야 한다.
  assert.equal(result.windows[0]?.breakdown['flight'], undefined);
  assert.ok((result.windows[0]?.breakdown['weekday'] ?? 0) > 0.2, '요일 가중치가 커진다');
});

test('성수기는 감점된다', () => {
  const participants = [person('a', days('2026-12-24', 5)), person('b', days('2026-12-24', 5))];
  const plain = resolveDates(input({ participants, today: '2026-09-01' }));
  const peak = resolveDates(
    input({
      participants,
      today: '2026-09-01',
      pack: { ...pack, peakSeasons: ['2026-12-24~2027-01-02'] },
    }),
  );

  assert.ok((peak.windows[0]?.score ?? 0) < (plain.windows[0]?.score ?? 0));
  assert.ok((peak.windows[0]?.breakdown['peakPenalty'] ?? 0) < 0);
});

test('임박한 출발은 감점된다', () => {
  const participants = [person('a', days('2026-09-03', 5)), person('b', days('2026-09-03', 5))];
  const result = resolveDates(input({ participants, today: '2026-09-01' }));

  assert.ok((result.windows[0]?.breakdown['imminencePenalty'] ?? 0) < 0);
});

test('오늘 출발하는 구간은 만들지 않는다', () => {
  const result = resolveDates(
    input({
      participants: [person('a', days('2026-09-01', 5)), person('b', days('2026-09-01', 5))],
      today: '2026-09-01',
    }),
  );

  for (const window of result.windows) {
    assert.ok(window.start > '2026-09-01');
  }
});

test('여유도: 가용 구간 한가운데가 가장자리보다 높다', () => {
  // a·b 모두 10/10~10/20 가능. 10/14 시작(가운데)이 10/10 시작(가장자리)보다 버퍼가 크다
  const result = resolveDates(
    input({
      participants: [person('a', days('2026-10-10', 11)), person('b', days('2026-10-10', 11))],
    }),
  );
  const edge = result.windows.find((window) => window.start === '2026-10-10');
  const middle = result.windows.find((window) => window.start !== '2026-10-10');

  if (edge !== undefined && middle !== undefined) {
    assert.ok((middle.breakdown['slack'] ?? 0) >= (edge.breakdown['slack'] ?? 0));
  }
});
