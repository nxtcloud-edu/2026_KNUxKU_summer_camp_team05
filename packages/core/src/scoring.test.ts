import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONCESSION_MAX,
  CONCESSION_MIN,
  NEUTRAL_SATISFACTION,
  normalizeWeights,
  satisfaction,
  scoreCandidates,
  selectWinner,
  speakingOrder,
  updateConcessionCredits,
  type CandidateAttributes,
  type ConcessionLedger,
  type ParticipantWeights,
} from './scoring.js';

/**
 * 합의 알고리즘 검증. 사용자가 개입할 수 없으므로 이 알고리즘이 최종 품질을 결정한다.
 * 근거: travel-mediation-plan.md 8.1 ~ 8.3
 */

const budgetFirst: ParticipantWeights = {
  userId: 'jihun',
  weights: { price: 3, location: 1 },
};
const locationFirst: ParticipantWeights = {
  userId: 'seoyeon',
  weights: { price: 1, location: 3 },
};

test('가중치는 합이 1이 되도록 정규화된다', () => {
  const normalized = normalizeWeights({ price: 3, location: 1 });
  assert.equal(normalized['price'], 0.75);
  assert.equal(normalized['location'], 0.25);
});

test('음수·0 가중치는 무시한다', () => {
  const normalized = normalizeWeights({ price: 2, location: 0, view: -1 });
  assert.deepEqual(Object.keys(normalized), ['price']);
});

test('만족도는 0~10 척도다', () => {
  const perfect = satisfaction(budgetFirst, { candidateId: 'H1', match: { price: 1, location: 1 } });
  const worst = satisfaction(budgetFirst, { candidateId: 'H2', match: { price: 0, location: 0 } });
  assert.equal(perfect, 10);
  assert.equal(worst, 0);
});

test('후보에 없는 속성은 0으로 본다 — 추정해 채우지 않는다', () => {
  const partial = satisfaction(budgetFirst, { candidateId: 'H1', match: { price: 1 } });
  assert.equal(partial, 7.5); // price 0.75 × 1 × 10
});

test('응답이 없는 참여자는 중립값을 받는다', () => {
  const silent: ParticipantWeights = { userId: 'nobody', weights: {} };
  const score = satisfaction(silent, { candidateId: 'H1', match: { price: 1 } });
  assert.equal(score, NEUTRAL_SATISFACTION);
});

test('소프트 제약 위반은 감점된다', () => {
  const score = satisfaction(budgetFirst, {
    candidateId: 'H1',
    match: { price: 1, location: 1 },
    softViolations: ['조식 미포함', '체크인 늦음'],
  });
  assert.equal(score, 8);
});

test('하드 제약 위반 후보는 스코어링 이전에 실격된다', () => {
  const board = scoreCandidates(
    [budgetFirst, locationFirst],
    [
      { candidateId: 'H1', match: { price: 1, location: 1 } },
      { candidateId: 'H2', match: { price: 1, location: 1 }, disqualifyReason: '도미토리 불가' },
    ],
  );
  assert.equal(board.scored.length, 1);
  assert.deepEqual(board.disqualified, [{ candidateId: 'H2', reason: '도미토리 불가' }]);
});

test('Maximin: 총합이 높아도 최저 만족도가 낮으면 지지 않는다', () => {
  // H1: 한쪽에 몰빵 (10 / 2.5 → min 2.5, sum 12.5)
  // H2: 균형        (6.25 / 6.25 → min 6.25, sum 12.5)
  const candidates: CandidateAttributes[] = [
    { candidateId: 'H1', match: { price: 1, location: 0 } },
    { candidateId: 'H2', match: { price: 0.625, location: 0.625 } },
  ];
  const board = scoreCandidates([budgetFirst, locationFirst], candidates);
  const selection = selectWinner(board);

  assert.equal(selection?.winner.candidateId, 'H2');
  assert.equal(selection?.decidedBy, 'maximin');
});

test('1순위 동률이면 총합으로 간다', () => {
  const flat: ParticipantWeights[] = [
    { userId: 'a', weights: { x: 1 } },
    { userId: 'b', weights: { x: 1 } },
  ];
  const board = scoreCandidates(flat, [
    { candidateId: 'C1', match: { x: 0.5 } },
    { candidateId: 'C2', match: { x: 0.5 } },
  ]);
  // 완전 동률 → 후보 순서로 결정되고, 그 사실이 드러난다
  const selection = selectWinner(board);
  assert.equal(selection?.decidedBy, 'candidate_order');
  assert.deepEqual(selection?.tiedWith, ['C1', 'C2']);
});

test('동률일 때 양보 크레딧이 승부를 가른다', () => {
  const alice: ParticipantWeights = { userId: 'alice', weights: { x: 1 } };
  const bob: ParticipantWeights = { userId: 'bob', weights: { y: 1 } };
  // 두 후보 모두 min 3, sum 10으로 동률. alice가 많이 양보했으므로 alice에게 좋은 쪽.
  const board = scoreCandidates(
    [alice, bob],
    [
      { candidateId: 'A', match: { x: 0.7, y: 0.3 } },
      { candidateId: 'B', match: { x: 0.3, y: 0.7 } },
    ],
    { alice: 1.6, bob: 0.8 },
  );
  const selection = selectWinner(board);
  assert.equal(selection?.winner.candidateId, 'A');
  assert.equal(selection?.decidedBy, 'concession_weighted');
});

test('강한 반대자 만족도 하한(5.5)을 지키는 후보를 먼저 고른다', () => {
  const board = scoreCandidates(
    [budgetFirst, locationFirst],
    [
      // 총점은 더 높지만 강한 반대자 seoyeon이 2.5로 하한 미달
      { candidateId: 'HIGH', match: { price: 1, location: 0 }, strongOpposerIds: ['seoyeon'] },
      { candidateId: 'SAFE', match: { price: 0.6, location: 0.6 } },
    ],
  );
  const selection = selectWinner(board);
  assert.equal(selection?.winner.candidateId, 'SAFE');
  assert.equal(selection?.intensityFloorUnmet, false);
});

test('하한을 지키는 후보가 없으면 채택하되 미해결로 표시한다', () => {
  const board = scoreCandidates(
    [budgetFirst, locationFirst],
    [{ candidateId: 'ONLY', match: { price: 1, location: 0 }, strongOpposerIds: ['seoyeon'] }],
  );
  const selection = selectWinner(board);
  assert.equal(selection?.winner.candidateId, 'ONLY');
  assert.equal(selection?.intensityFloorUnmet, true, '조용히 넘어가면 안 된다');
});

test('양보한 사람의 크레딧이 오르고 이득 본 사람은 내린다', () => {
  const { ledger, deltas } = updateConcessionCredits(
    { jihun: 1, seoyeon: 1 },
    { jihun: 3, seoyeon: 7 },
  );
  assert.ok(deltas['jihun']! < 0 && deltas['seoyeon']! > 0);
  assert.ok(ledger['jihun']! > 1, '손해 본 쪽이 올라야 한다');
  assert.ok(ledger['seoyeon']! < 1, '이득 본 쪽이 내려야 한다');
  // 손해 본 쪽이 이득 본 쪽의 2배 속도로 움직인다
  assert.ok(ledger['jihun']! - 1 > 1 - ledger['seoyeon']!);
});

test('크레딧은 한 라운드에 클리핑 경계까지 튀지 않는다', () => {
  // 최대 격차(0 vs 10)여도 한 라운드 이동폭은 α=0.4를 넘지 않는다
  const { ledger } = updateConcessionCredits({ a: 1, b: 1 }, { a: 0, b: 10 });
  assert.ok(ledger['a']! <= 1.2, `한 라운드 이동폭이 과대하다: ${ledger['a']}`);
  assert.ok(ledger['a']! < CONCESSION_MAX);
});

test('크레딧은 [0.6, 1.8]로 클리핑된다', () => {
  let ledger: ConcessionLedger = { a: 1, b: 1 };
  for (let round = 0; round < 30; round += 1) {
    ledger = updateConcessionCredits(ledger, { a: 0, b: 10 }).ledger;
  }
  assert.equal(ledger['a'], CONCESSION_MAX);
  assert.equal(ledger['b'], CONCESSION_MIN);
});

test('발언 순서는 양보 크레딧 내림차순이고 결정론적이다', () => {
  const order = speakingOrder(['a', 'b', 'c'], { a: 1.0, b: 1.5, c: 1.5 });
  assert.deepEqual(order, ['b', 'c', 'a']);
  assert.deepEqual(order, speakingOrder(['c', 'a', 'b'], { a: 1.0, b: 1.5, c: 1.5 }));
});
