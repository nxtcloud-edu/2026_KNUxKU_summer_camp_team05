import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SurveySubmission } from '@tm/contracts';
import { normalizeWeights, satisfaction } from './scoring.js';
import { priceWeight, weightsForRoom, weightsFromSurvey } from './weights.js';

/**
 * 설문 → 가중치 변환. 근거: travel-mediation-plan.md 8.1
 *
 * 핵심은 축에 방향이 들어간다는 것이다. `match(c,k)`는 후보당 하나뿐이므로
 * 개인차는 축 선택으로 표현한다.
 */

const survey = (overrides: Partial<SurveySubmission> = {}): SurveySubmission => ({
  schemaVersion: 2,
  destinationId: 'jp-osaka',
  availability: {
    availableDates: ['2026-10-16'],
    unavailableDates: [],
    preferredNights: '2',
    nightFlexibility: 'plus-minus-one',
    weekdayFlexibility: 'friday-pto',
    flightTimeFlexibility: 'morning-onward',
  },
  hardConstraints: {
    budgetLimit: '900,000',
    includesFlight: true,
    dietary: [],
    allergies: [],
    beliefs: [],
    walkingDistanceKm: 8,
    mobilityNeeds: [],
    noGoItems: [],
  },
  travelStyles: {},
  activityScores: {},
  mustDo: '',
  avoid: '',
  ...overrides,
});

test('느긋 쪽 슬라이더는 pace_relaxed에 가중치를 준다', () => {
  const result = weightsFromSurvey({
    userId: 'a',
    survey: survey({ travelStyles: { pace: 1 } }),
  });

  assert.equal(result.weights.weights['pace_relaxed'], 1);
  assert.equal(result.weights.weights['pace_packed'], undefined);
});

test('빡빡 쪽은 반대 축에 붙는다', () => {
  const result = weightsFromSurvey({
    userId: 'a',
    survey: survey({ travelStyles: { pace: 7 } }),
  });

  assert.equal(result.weights.weights['pace_packed'], 1);
  assert.equal(result.weights.weights['pace_relaxed'], undefined);
});

test('중앙값(4)은 어느 축에도 가중치를 주지 않는다', () => {
  const result = weightsFromSurvey({
    userId: 'a',
    survey: survey({ travelStyles: { pace: 4 } }),
  });

  assert.equal(result.weights.weights['pace_relaxed'], undefined);
  assert.equal(result.weights.weights['pace_packed'], undefined);
});

test('중앙에서 멀수록 가중치가 크다', () => {
  const mild = weightsFromSurvey({ userId: 'a', survey: survey({ travelStyles: { pace: 3 } }) });
  const strong = weightsFromSurvey({ userId: 'a', survey: survey({ travelStyles: { pace: 1 } }) });

  assert.ok(
    (strong.weights.weights['pace_relaxed'] ?? 0) > (mild.weights.weights['pace_relaxed'] ?? 0),
  );
});

test('12문항 전부 축이 있다 — 매핑 누락 경고가 없어야 한다', () => {
  const styles = {
    pace: 2,
    planning: 6,
    'accommodation-spend': 2,
    atmosphere: 6,
    'place-style': 2,
    'food-style': 6,
    togetherness: 2,
    'daily-rhythm': 6,
    'evening-style': 2,
    'transport-style': 6,
    'photo-priority': 2,
    'activity-level': 6,
  };
  const result = weightsFromSurvey({ userId: 'a', survey: survey({ travelStyles: styles }) });

  assert.equal(
    result.notes.some((note) => note.includes('매핑되지 않은')),
    false,
    result.notes.join(' / '),
  );
});

test('"사진 관심 없음"은 선호가 아니라 무관심이라 축을 만들지 않는다', () => {
  const result = weightsFromSurvey({
    userId: 'a',
    survey: survey({ travelStyles: { 'photo-priority': 7 } }),
  });

  assert.equal(result.weights.weights['photogenic'], undefined);
});

test('모르는 슬라이더는 조용히 버리지 않고 보고한다', () => {
  const result = weightsFromSurvey({
    userId: 'a',
    survey: survey({ travelStyles: { 'brand-new-slider': 6 } }),
  });

  assert.ok(result.notes.some((note) => note.includes('brand-new-slider')));
});

test('예산이 낮은 사람일수록 가격 가중치가 크다', () => {
  const budgets = [500_000, 900_000, 1_500_000];

  assert.equal(priceWeight(500_000, budgets), 3, '최저 예산자');
  assert.equal(priceWeight(1_500_000, budgets), 1, '최고 예산자');
  assert.ok(priceWeight(900_000, budgets) > 1);
});

test('그룹 맥락이 없으면 기본 가중치만 준다', () => {
  assert.equal(priceWeight(500_000), 1);
  assert.equal(priceWeight(null), 1);
});

test('예산을 못 읽으면 사유를 남긴다', () => {
  const result = weightsFromSurvey({
    userId: 'a',
    survey: survey({
      hardConstraints: { ...survey().hardConstraints, budgetLimit: '모르겠어요' },
    }),
  });

  assert.ok(result.notes.some((note) => note.includes('예산')));
});

test('도보 한계가 짧으면 중심가 가중치가 붙는다', () => {
  const near = weightsFromSurvey({
    userId: 'a',
    survey: survey({ hardConstraints: { ...survey().hardConstraints, walkingDistanceKm: 3 } }),
  });
  const far = weightsFromSurvey({
    userId: 'a',
    survey: survey({ hardConstraints: { ...survey().hardConstraints, walkingDistanceKm: 20 } }),
  });

  assert.equal(near.weights.weights['location_central'], 2);
  assert.equal(far.weights.weights['location_central'], undefined);
});

test('이동 제약이 있으면 접근성이 최우선 축이 된다', () => {
  const result = weightsFromSurvey({
    userId: 'a',
    survey: survey({
      hardConstraints: { ...survey().hardConstraints, mobilityNeeds: ['휠체어'] },
    }),
  });

  assert.equal(result.weights.weights['accessibility'], 3);
  assert.ok((result.weights.weights['location_central'] ?? 0) > 0);
});

test('카드덱 축 매핑이 없으면 카드 점수를 반영하지 못했다고 알린다', () => {
  const result = weightsFromSurvey({
    userId: 'a',
    survey: survey({ activityScores: { 'osaka-spa-world': 9 } }),
  });

  assert.equal(result.weights.weights['activity_easy'], undefined);
  assert.ok(result.notes.some((note) => note.includes('카드덱')));
});

test('카드덱 축이 주어지면 점수를 축에 누적한다', () => {
  const result = weightsFromSurvey({
    userId: 'a',
    survey: survey({ activityScores: { 'osaka-spa-world': 10, 'osaka-shinsaibashi': 5 } }),
    cardAxes: { 'osaka-spa-world': 'activity_easy', 'osaka-shinsaibashi': 'urban' },
  });

  assert.equal(result.weights.weights['activity_easy'], 1);
  assert.equal(result.weights.weights['urban'], 0.5);
});

test('자유서술은 아직 반영되지 않는다고 알린다', () => {
  const result = weightsFromSurvey({ userId: 'a', survey: survey({ mustDo: '온천' }) });
  assert.ok(result.notes.some((note) => note.includes('자유서술')));
});

test('방 단위 변환은 예산을 상대값으로 계산한다', () => {
  const budgets = ['500,000', '1,500,000'];
  const { weights } = weightsForRoom(
    budgets.map((budgetLimit, index) => ({
      userId: `user_${index}`,
      survey: survey({ hardConstraints: { ...survey().hardConstraints, budgetLimit } }),
    })),
  );

  const [poor, rich] = weights;
  assert.ok((poor?.weights['price_low'] ?? 0) > (rich?.weights['price_low'] ?? 0));
});

test('변환 결과가 Scoring Engine에 그대로 들어간다', () => {
  const { weights } = weightsFromSurvey({
    userId: 'a',
    survey: survey({ travelStyles: { pace: 1, 'accommodation-spend': 1 } }),
  });

  // 느긋한 후보는 높고, 빡빡한 후보는 낮아야 한다
  const relaxed = satisfaction(weights, {
    candidateId: 'c1',
    match: { pace_relaxed: 1, price_low: 1 },
  });
  const packed = satisfaction(weights, {
    candidateId: 'c2',
    match: { pace_packed: 1, price_low: 0 },
  });

  assert.ok(relaxed > packed, `${relaxed} vs ${packed}`);
  assert.ok(relaxed <= 10);
});

test('가중치는 정규화되어 합이 1이 된다', () => {
  const { weights } = weightsFromSurvey({
    userId: 'a',
    survey: survey({ travelStyles: { pace: 1, atmosphere: 7 } }),
  });
  const normalized = normalizeWeights(weights.weights);
  const total = Object.values(normalized).reduce((sum, value) => sum + value, 0);

  assert.ok(Math.abs(total - 1) < 1e-9);
});
