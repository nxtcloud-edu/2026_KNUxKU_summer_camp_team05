import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canRerun, reconcileReview, runMechanicalChecks, type ReviewInput } from './review.js';

const base = (overrides: Partial<ReviewInput> = {}): ReviewInput => ({
  roundId: 'r_2',
  satisfactions: { a: 7, b: 7, c: 7 },
  budget: { allocatedPerPersonKrw: 300000, spentPerPersonKrw: 300000 },
  ...overrides,
});

test('임계치를 넘지 않으면 아무것도 걸리지 않는다', () => {
  const result = runMechanicalChecks(base());
  assert.deepEqual(result.triggered, []);
  assert.equal(result.requiresResourcing, false);
});

test('C1: 최소 만족도 5.0 미만', () => {
  const result = runMechanicalChecks(base({ satisfactions: { a: 4.3, b: 8, c: 7 } }));
  assert.ok(result.triggered.includes('C1'));
  assert.equal(result.metrics.minSatisfaction, 4.3);
  assert.equal(result.metrics.lastPlaceUserId, 'a');
});

test('C2: 만족도 격차 4.0 초과', () => {
  const result = runMechanicalChecks(base({ satisfactions: { a: 5.1, b: 9.5, c: 7 } }));
  assert.ok(result.triggered.includes('C2'));
  assert.equal(result.metrics.satisfactionGap, 4.4);
});

test('C3: 3라운드 연속 최하위', () => {
  const result = runMechanicalChecks(base({ lastPlaceStreak: { a: 3, b: 0 } }));
  assert.ok(result.triggered.includes('C3'));
});

test('C4: 배정 예산 15% 초과', () => {
  const result = runMechanicalChecks(
    base({ budget: { allocatedPerPersonKrw: 300000, spentPerPersonKrw: 350000 } }),
  );
  assert.ok(result.triggered.includes('C4'));
  assert.equal(result.metrics.budgetOverrunRatio, 0.17);
});

test('예산 15% 이내는 걸리지 않는다', () => {
  const result = runMechanicalChecks(
    base({ budget: { allocatedPerPersonKrw: 300000, spentPerPersonKrw: 340000 } }),
  );
  assert.equal(result.triggered.includes('C4'), false);
});

test('C5·C7은 재심이 아니라 재조달이다', () => {
  const c5 = runMechanicalChecks(base({ hardConstraintViolations: ['갑각류 취급'] }));
  assert.equal(c5.machineVerdict.C5, true);
  assert.equal(c5.requiresResourcing, true);

  const c7 = runMechanicalChecks(base({ unverifiedCandidateIds: ['H9'] }));
  assert.equal(c7.machineVerdict.C7, true);
  assert.equal(c7.requiresResourcing, true);
});

test('C6: 이전 라운드와 모순', () => {
  const result = runMechanicalChecks(base({ contradictions: ['숙소는 우메다, 액티비티는 텐노지'] }));
  assert.ok(result.triggered.includes('C6'));
});

test('A6: Supervisor가 C5를 pass라고 해도 코드 판정이 채택된다', () => {
  const machine = runMechanicalChecks(base({ hardConstraintViolations: ['갑각류 취급'] }));
  const reconciled = reconcileReview(machine, []); // Supervisor는 아무것도 걸지 않았다

  assert.ok(reconciled.triggered.includes('C5'), '코드 판정이 살아남아야 한다');
  assert.equal(reconciled.mismatch, true);
  assert.match(reconciled.mismatchDetail[0] ?? '', /C5: 코드=위반 \/ Supervisor=통과/);
});

test('Supervisor가 없는 C7을 주장하면 제거된다', () => {
  const machine = runMechanicalChecks(base());
  const reconciled = reconcileReview(machine, ['C7']);

  assert.equal(reconciled.triggered.includes('C7'), false);
  assert.equal(reconciled.mismatch, true);
});

test('C1~C4·C6은 Supervisor 판단을 존중한다', () => {
  const machine = runMechanicalChecks(base());
  const reconciled = reconcileReview(machine, ['C1', 'C6']);

  assert.deepEqual(reconciled.triggered, ['C1', 'C6']);
  assert.equal(reconciled.mismatch, false, 'C5·C7만 불일치 대상이다');
});

test('재심은 2회까지', () => {
  assert.equal(canRerun(0), true);
  assert.equal(canRerun(1), true);
  assert.equal(canRerun(2), false);
});
