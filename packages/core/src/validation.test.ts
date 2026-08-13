import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  documentGate,
  runValidationPass,
  type ItineraryItem,
  type ValidationInput,
} from './validation.js';

/**
 * Validation Pass — 문서 생성 직전의 기계 검증.
 * 근거: agent-architecture.md 9.1 · 테스트 A20
 */

const item = (overrides: Partial<ItineraryItem> = {}): ItineraryItem => ({
  itemId: 'i1',
  externalId: 'ext-1',
  nodeId: 'activity',
  startAt: '2026-10-16T10:00:00Z',
  endAt: '2026-10-16T11:00:00Z',
  travelMinutesFromPrev: null,
  openAtVisitTime: true,
  costPerPersonKrw: 10000,
  ...overrides,
});

const input = (overrides: Partial<ValidationInput> = {}): ValidationInput => ({
  items: [item()],
  sourcedExternalIds: ['ext-1'],
  budget: { declaredTotalPerPersonKrw: 10000, groupCapPerPersonKrw: 900000 },
  ...overrides,
});

test('모든 검증을 통과하면 VERIFIED', () => {
  const report = runValidationPass(input());
  assert.equal(report.passed, true);
  assert.deepEqual(report.blockers, []);
  assert.equal(documentGate(report).badge, 'VERIFIED');
});

test('조달되지 않은 external_id는 차단된다 — 환각의 유일한 경로', () => {
  const report = runValidationPass(
    input({ items: [item({ externalId: 'ext-없음' })], sourcedExternalIds: ['ext-1'] }),
  );
  assert.equal(report.passed, false);
  assert.equal(report.blockers[0]?.kind, 'unknown_external_id');
});

test('조달 근거가 없는(null) 항목도 차단된다', () => {
  const report = runValidationPass(input({ items: [item({ externalId: null })] }));
  assert.equal(report.blockers[0]?.kind, 'unknown_external_id');
});

test('항목 합계와 표기 총액이 어긋나면 차단된다', () => {
  const report = runValidationPass(
    input({ budget: { declaredTotalPerPersonKrw: 50000, groupCapPerPersonKrw: 900000 } }),
  );
  assert.ok(report.blockers.some((blocker) => blocker.kind === 'budget_mismatch'));
  assert.equal(report.checked.budgetDeltaKrw, -40000);
});

test('반올림 오차는 허용된다', () => {
  const report = runValidationPass(
    input({ budget: { declaredTotalPerPersonKrw: 10500, groupCapPerPersonKrw: 900000 } }),
  );
  assert.equal(report.blockers.some((blocker) => blocker.kind === 'budget_mismatch'), false);
});

test('최저 예산 참여자 상한을 넘으면 차단된다', () => {
  const report = runValidationPass(
    input({
      items: [item({ costPerPersonKrw: 950000 })],
      budget: { declaredTotalPerPersonKrw: 950000, groupCapPerPersonKrw: 900000 },
    }),
  );
  assert.ok(report.blockers.some((blocker) => blocker.kind === 'budget_over_cap'));
});

test('시간대가 겹치면 차단된다', () => {
  const report = runValidationPass(
    input({
      items: [
        item({ itemId: 'a', startAt: '2026-10-16T10:00:00Z', endAt: '2026-10-16T12:00:00Z' }),
        item({ itemId: 'b', startAt: '2026-10-16T11:00:00Z', endAt: '2026-10-16T13:00:00Z' }),
      ],
      budget: { declaredTotalPerPersonKrw: 20000, groupCapPerPersonKrw: 900000 },
    }),
  );
  assert.ok(report.blockers.some((blocker) => blocker.kind === 'schedule_overlap'));
});

test('이동시간이 여유보다 길면 차단된다', () => {
  const report = runValidationPass(
    input({
      items: [
        item({ itemId: 'a', startAt: '2026-10-16T10:00:00Z', endAt: '2026-10-16T11:00:00Z' }),
        item({
          itemId: 'b',
          startAt: '2026-10-16T11:10:00Z',
          endAt: '2026-10-16T12:00:00Z',
          travelMinutesFromPrev: 34, // 도보 15분이 아니라 34분이었던 그 케이스
        }),
      ],
      budget: { declaredTotalPerPersonKrw: 20000, groupCapPerPersonKrw: 900000 },
    }),
  );
  const blocker = report.blockers.find((b) => b.kind === 'travel_time_infeasible');
  assert.ok(blocker);
  assert.match(blocker.detail, /34분이 필요한데 여유가 10분/);
});

test('이동시간 미실측은 경고이지 차단은 아니다', () => {
  const report = runValidationPass(
    input({
      items: [
        item({ itemId: 'a', startAt: '2026-10-16T10:00:00Z', endAt: '2026-10-16T11:00:00Z' }),
        item({ itemId: 'b', startAt: '2026-10-16T13:00:00Z', endAt: '2026-10-16T14:00:00Z' }),
      ],
      budget: { declaredTotalPerPersonKrw: 20000, groupCapPerPersonKrw: 900000 },
    }),
  );
  assert.equal(report.passed, true);
  assert.equal(report.warnings[0]?.kind, 'travel_time_infeasible');
});

test('영업시간 미확인(null)은 통과가 아니라 차단이다', () => {
  const report = runValidationPass(input({ items: [item({ openAtVisitTime: null })] }));
  const blocker = report.blockers.find((b) => b.kind === 'closed_at_visit_time');
  assert.ok(blocker);
  assert.match(blocker.detail, /확인하지 못했습니다/);
});

test('휴관일 방문은 차단된다', () => {
  const report = runValidationPass(input({ items: [item({ openAtVisitTime: false })] }));
  assert.ok(report.blockers.some((b) => b.kind === 'closed_at_visit_time'));
});

test('fail-closed 검증 미통과 항목은 차단된다', () => {
  const report = runValidationPass(
    input({
      items: [item({ requiresFailClosedCheck: true, failClosedVerified: false, nodeId: 'dining' })],
    }),
  );
  const blocker = report.blockers.find((b) => b.kind === 'unverified_fail_closed');
  assert.ok(blocker);
  assert.equal(blocker.nodeId, 'dining');
});

test('A20: 검증 실패 상태에서는 PARTIAL만 발행된다', () => {
  const report = runValidationPass(input({ items: [item({ externalId: null })] }));
  const gate = documentGate(report);
  assert.equal(gate.allowed, false);
  assert.equal(gate.badge, 'PARTIAL');
  assert.ok(gate.reason);
});

test('차단된 노드가 중복 없이 모인다', () => {
  const report = runValidationPass(
    input({
      items: [
        item({ itemId: 'a', externalId: null, nodeId: 'dining' }),
        item({ itemId: 'b', externalId: null, nodeId: 'dining' }),
      ],
      budget: { declaredTotalPerPersonKrw: 20000, groupCapPerPersonKrw: 900000 },
    }),
  );
  assert.deepEqual(report.blockedNodes, ['dining']);
});
