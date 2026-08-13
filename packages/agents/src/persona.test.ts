import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SurveySubmission } from '@tm/contracts';
import { weightsFromSurvey } from '@tm/core';
import { buildPersonaCard, buildPersonaFacts, describePersona } from './persona.js';
import { createStubClient } from './testing.js';

const survey = (overrides: Partial<SurveySubmission['hardConstraints']> = {}): SurveySubmission => ({
  schemaVersion: 2,
  destinationId: 'jp-osaka',
  availability: {
    availableDates: ['2026-10-02', '2026-10-03'],
    unavailableDates: [],
    preferredNights: '2',
    nightFlexibility: 'plus-minus-one',
    weekdayFlexibility: 'weekends',
    flightTimeFlexibility: 'morning-onward',
  },
  hardConstraints: {
    budgetLimit: '900,000',
    includesFlight: true,
    dietary: ['없음'],
    allergies: ['새우'],
    beliefs: [],
    walkingDistanceKm: 8,
    mobilityNeeds: [],
    noGoItems: ['새벽 비행'],
    ...overrides,
  },
  travelStyles: { pace: 2, 'food-style': 1 },
  activityScores: { onsen: 9, market: 7, theme_park: 2 },
  mustDo: '온천에서 하루 쉬고 싶다',
  avoid: '빡빡한 일정',
});

const factsFor = (submission = survey()) =>
  buildPersonaFacts({
    userId: 'u_1',
    survey: submission,
    weights: weightsFromSurvey({ userId: 'u_1', survey: submission }).weights,
  });

test('알레르기가 제약 목록 맨 앞에 온다', () => {
  const facts = factsFor(
    survey({ allergies: ['새우'], dietary: ['채식'], beliefs: ['금주'], noGoItems: ['클럽'] }),
  );

  assert.equal(facts.constraints[0]?.kind, 'allergy');
  assert.equal(facts.constraints[0]?.label, '새우 알레르기');
  assert.equal(facts.constraints[0]?.safety, true);
});

test('식이 제약의 "없음"은 제약이 아니다', () => {
  const facts = factsFor(survey({ dietary: ['없음'] }));
  assert.equal(
    facts.constraints.some((entry) => entry.label === '없음'),
    false,
  );
});

test('이동 제약도 안전 축으로 표시된다', () => {
  const facts = factsFor(survey({ allergies: [], mobilityNeeds: ['휠체어 접근'] }));
  const mobility = facts.constraints.find((entry) => entry.kind === 'mobility');
  assert.equal(mobility?.safety, true);
});

test('예산은 문자열에서 숫자로 변환된다', () => {
  const facts = factsFor();
  assert.equal(facts.budget.perPersonKrw, 900_000);
  assert.equal(facts.budget.includesFlight, true);
});

test('카드 점수 상·하위를 뽑는다', () => {
  const facts = factsFor();
  assert.equal(facts.topInterests[0]?.cardId, 'onsen');
  assert.equal(facts.topInterests[0]?.score, 9);
  assert.equal(facts.bottomInterests[0]?.cardId, 'theme_park');
});

test('같은 설문이면 항상 같은 사실이 나온다 — 확인 게이트의 전제', () => {
  const submission = survey();
  assert.deepEqual(factsFor(submission), factsFor(submission));
});

test('소개문 생성은 사실을 바꾸지 않는다', async () => {
  const client = createStubClient({
    responses: {
      'persona.describe': JSON.stringify({
        headline: '온천을 놓칠 수 없는 느긋한 여행자',
        summary: '서두르지 않는 일정을 원하고, 쉬어 갈 시간을 꼭 남깁니다.',
        style: '조정형',
        styleReason: '선호는 뚜렷하지만 합의를 우선합니다.',
      }),
    },
  });

  const submission = survey();
  const { card } = await buildPersonaCard(client, {
    userId: 'u_1',
    survey: submission,
    weights: weightsFromSurvey({ userId: 'u_1', survey: submission }).weights,
    model: 'gemini-2.5-flash-lite',
  });

  assert.deepEqual(card.facts, factsFor(submission), 'LLM이 사실을 건드리면 안 된다');
  assert.equal(card.voice.style, '조정형');
});

test('소개문 프롬프트에 예산 금액이 들어가지 않는다 — 소개문에 숫자가 새는 통로', async () => {
  const client = createStubClient({
    responses: {
      'persona.describe': JSON.stringify({
        headline: 'x',
        summary: 'y',
        style: '조정형',
        styleReason: 'z',
      }),
    },
  });

  await describePersona(client, factsFor(), 'gemini-2.5-flash-lite');

  const prompt = client.callsFor('persona.describe')[0]?.prompt ?? '';
  assert.equal(prompt.includes('900000'), false);
  assert.equal(prompt.includes('900,000'), false);
});

test('LLM이 실패해도 카드는 만들어진다 — 확인 게이트가 방을 막으면 안 된다', async () => {
  const client = createStubClient({ failOn: ['persona.describe'] });

  const submission = survey();
  const { card, fallback } = await buildPersonaCard(client, {
    userId: 'u_1',
    survey: submission,
    weights: weightsFromSurvey({ userId: 'u_1', survey: submission }).weights,
    model: 'gemini-2.5-flash-lite',
  });

  assert.notEqual(fallback, null, '실패 사실을 숨기지 않는다');
  assert.ok(card.voice.headline.length > 0);
  assert.ok(card.generatedBy.includes('fallback'), '대체 문구를 썼다는 것이 카드에 남는다');
  assert.deepEqual(card.facts, factsFor(submission), '사실은 그대로다');
});

test('안전 제약이 있으면 대체 스타일이 주장형이다', async () => {
  const client = createStubClient({ failOn: ['persona.describe'] });
  const submission = survey({ allergies: ['새우', '땅콩'] });

  const { card } = await buildPersonaCard(client, {
    userId: 'u_1',
    survey: submission,
    weights: weightsFromSurvey({ userId: 'u_1', survey: submission }).weights,
    model: 'gemini-2.5-flash-lite',
  });

  assert.equal(card.voice.style, '주장형');
});

test('반영하지 못한 입력은 notes로 남는다', () => {
  const submission = survey();
  const result = weightsFromSurvey({ userId: 'u_1', survey: submission });
  const facts = buildPersonaFacts({
    userId: 'u_1',
    survey: submission,
    weights: result.weights,
    notes: result.notes,
  });

  // 카드덱 축 매핑이 없으므로 activityScores가 가중치에 반영되지 않는다.
  assert.ok(facts.notes.length > 0, '조용히 버리지 않는다');
});
