import assert from 'node:assert/strict';
import { test } from 'node:test';
import { queryClasses, type QueryClass } from '@tm/contracts';
import { CLASS_POLICY, isCacheable } from './policy.js';
import { dataAgents, ownerOf, quotaFor } from './agents.js';

/**
 * 정책 카탈로그 불변식. 여기가 무너지면 캐시가 안전 항목을 조용히 통과시킨다.
 * 근거: agent-architecture.md 6.5 · 테스트 A10~A14
 */

test('모든 queryClass에 정책이 있다', () => {
  for (const queryClass of queryClasses) {
    assert.ok(CLASS_POLICY[queryClass], `정책 누락: ${queryClass}`);
  }
});

test('모든 queryClass에 담당 Data Agent가 있다', () => {
  for (const queryClass of queryClasses) {
    assert.doesNotThrow(() => ownerOf(queryClass), `담당자 없음: ${queryClass}`);
  }
});

test('Data Agent가 담당하지 않는 클래스를 선언하지 않는다', () => {
  const known = new Set<string>(queryClasses);
  for (const spec of Object.values(dataAgents)) {
    for (const queryClass of spec.queryClasses) {
      assert.ok(known.has(queryClass), `${spec.id}가 없는 클래스를 선언: ${queryClass}`);
    }
  }
});

test('한 queryClass를 두 Data Agent가 담당하지 않는다', () => {
  const seen = new Map<string, string>();
  for (const spec of Object.values(dataAgents)) {
    for (const queryClass of spec.queryClasses) {
      const prev = seen.get(queryClass);
      assert.equal(prev, undefined, `${queryClass}를 ${prev}와 ${spec.id}가 중복 담당`);
      seen.set(queryClass, spec.id);
    }
  }
});

test('A10: 확정가·그룹 재고·객실 조합·알레르기 대응은 캐시 금지', () => {
  const mustNeverCache: QueryClass[] = [
    'flight.offer_price',
    'flight.group_inventory',
    'hotel.room_combination',
    'hotel.all_in_price',
    'dining.diet_support',
  ];
  for (const queryClass of mustNeverCache) {
    assert.equal(CLASS_POLICY[queryClass].cache, 'never', `${queryClass}는 never여야 한다`);
    for (const purpose of ['exploration', 'verification', 'booking_readiness'] as const) {
      assert.equal(isCacheable(CLASS_POLICY[queryClass], purpose), false);
    }
  }
});

test('A12·A13: fail-closed 클래스가 표시되어 있다', () => {
  const mustFailClosed: QueryClass[] = [
    'transit.accessibility_route',
    'hotel.room_combination',
    'dining.diet_support',
    'poi.hours',
  ];
  for (const queryClass of mustFailClosed) {
    assert.equal(CLASS_POLICY[queryClass].failClosed, true, `${queryClass}는 fail-closed여야 한다`);
  }
});

test('advisory 클래스는 웹·RAG와 한국 가격 밴드뿐이다', () => {
  const advisory = queryClasses.filter((queryClass) => CLASS_POLICY[queryClass].advisory);
  assert.deepEqual(
    [...advisory].sort(),
    ['hotel.price_band', 'kb.retrieve', 'web.page', 'web.search'],
  );
});

test('A11: 인원수에 의존하는 클래스는 캐시 키에 인원수를 포함한다', () => {
  const paxSensitive: QueryClass[] = [
    'flight.offers_search',
    'flight.offer_price',
    'flight.group_inventory',
    'hotel.search',
    'hotel.vacancy_price',
    'hotel.room_combination',
    'hotel.all_in_price',
    'dining.search',
    'dining.reservation_slot',
  ];
  for (const queryClass of paxSensitive) {
    const keys = CLASS_POLICY[queryClass].keyParams;
    const hasPax = keys.some((key) => ['pax', 'guests', 'rooms'].includes(key));
    assert.ok(hasPax, `${queryClass}의 캐시 키에 인원수가 없다: ${keys.join(',')}`);
  }
});

test('verification에서 live를 요구하는 클래스는 캐시를 우회한다', () => {
  for (const queryClass of queryClasses) {
    const policy = CLASS_POLICY[queryClass];
    if (policy.minConfidence.verification !== 'live') continue;
    assert.equal(
      isCacheable(policy, 'verification'),
      false,
      `${queryClass}는 verification에서 캐시를 쓰면 안 된다`,
    );
  }
});

test('상한이 없는 클래스는 기본 2회로 떨어진다', () => {
  assert.equal(quotaFor('flight.offers_search'), 3);
  assert.equal(quotaFor('transit.route'), 8);
  assert.ok(quotaFor('ref.fx') >= 1);
});
