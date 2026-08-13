import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DispatchProposal, LegalMove, MoveType, PlanningNodeId, RoundId } from '@tm/contracts';
import { validateProposal, type DispatchContext } from './dispatch.js';
import { runMechanicalChecks } from './review.js';

/**
 * 디스패치 검증 V1~V10. 근거: agent-architecture.md 4.3 · 테스트 A1~A6, A17, A18
 */

const move = (
  moveId: string,
  overrides: {
    type?: MoveType;
    round?: RoundId;
    nodeId?: PlanningNodeId;
    parallelGroup?: string | null;
    missing?: string[];
    rerunUsed?: number;
    recalcUsed?: number;
    usd?: number;
    usdRemaining?: number;
    turnsRemaining?: number;
  } = {},
): LegalMove => ({
  moveId,
  type: overrides.type ?? 'run_referee',
  target: {
    ...(overrides.round === undefined ? {} : { round: overrides.round }),
    ...(overrides.nodeId === undefined ? {} : { nodeId: overrides.nodeId }),
  },
  dependencies: { satisfied: [], missing: overrides.missing ?? [] },
  guards: {
    roundRerunUsed: overrides.rerunUsed ?? 0,
    roundRerunCap: 2,
    globalRecalcUsed: overrides.recalcUsed ?? 0,
    globalRecalcCap: 3,
    turnsRemaining: overrides.turnsRemaining ?? 32,
  },
  budget: {
    tokensRemaining: 80000,
    usdRemaining: overrides.usdRemaining ?? 0.5,
    toolCallsRemaining: {},
  },
  parallelGroup: overrides.parallelGroup ?? null,
  estimated: { latencySec: 90, usd: overrides.usd ?? 0.05 },
});

const proposal = (
  sequence: { moveId: string; parallelWith?: string[] }[],
  reviewDecisions: DispatchProposal['reviewDecisions'] = [],
): DispatchProposal => ({
  runId: 'run_1',
  sequence: sequence.map((step) => ({
    moveId: step.moveId,
    reason: '테스트',
    ...(step.parallelWith === undefined ? {} : { parallelWith: step.parallelWith }),
  })),
  reviewDecisions,
  budgetTransferRequest: null,
  notes: '',
});

const context = (moves: LegalMove[], overrides: Partial<DispatchContext> = {}): DispatchContext => ({
  moves,
  ...overrides,
});

test('정상 제안은 통과한다', () => {
  const moves = [move('mv_1', { round: 'r_1a' }), move('mv_2', { round: 'r_2' })];
  const result = validateProposal(proposal([{ moveId: 'mv_1' }, { moveId: 'mv_2' }]), context(moves));
  assert.equal(result.accepted, true);
  assert.deepEqual(result.violations, []);
});

test('A2/V1: LegalMove에 없는 moveId는 거부된다', () => {
  const result = validateProposal(proposal([{ moveId: 'mv_없음' }]), context([move('mv_1')]));
  assert.equal(result.accepted, false);
  assert.equal(result.violations[0]?.rule, 'V1');
});

test('A1/V2: 위상 순서를 거스르면 거부된다', () => {
  const moves = [move('mv_r2', { round: 'r_2' }), move('mv_r1b', { round: 'r_1b' })];
  const result = validateProposal(
    proposal([{ moveId: 'mv_r2' }, { moveId: 'mv_r1b' }]),
    context(moves),
  );
  assert.equal(result.accepted, false);
  assert.ok(result.violations.some((violation) => violation.rule === 'V2'));
});

test('V2: 미충족 의존성이 있으면 거부된다', () => {
  const moves = [move('mv_1', { round: 'r_2', missing: ['transport_policy@1'] })];
  const result = validateProposal(proposal([{ moveId: 'mv_1' }]), context(moves));
  assert.ok(result.violations.some((violation) => violation.rule === 'V2'));
});

test('V3: 다른 parallelGroup끼리 병렬 요청하면 거부가 아니라 직렬화된다', () => {
  const moves = [
    move('mv_1', { round: 'r_2', parallelGroup: 'A' }),
    move('mv_2', { round: 'r_3', parallelGroup: 'B' }),
  ];
  const result = validateProposal(
    proposal([{ moveId: 'mv_1', parallelWith: ['mv_2'] }, { moveId: 'mv_2' }]),
    context(moves),
  );
  assert.equal(result.accepted, true, 'V3는 거부 사유가 아니다');
  assert.deepEqual(result.serialized, ['mv_1']);
});

test('같은 parallelGroup이면 병렬을 유지한다', () => {
  const moves = [
    move('mv_1', { round: 'r_2', parallelGroup: 'A' }),
    move('mv_2', { round: 'r_3', parallelGroup: 'A' }),
  ];
  const result = validateProposal(
    proposal([{ moveId: 'mv_1', parallelWith: ['mv_2'] }, { moveId: 'mv_2' }]),
    context(moves),
  );
  assert.deepEqual(result.serialized, []);
});

test('A18/V4: 잠긴 노드 변경 제안은 거부된다', () => {
  const moves = [move('mv_1', { type: 'recalc_node', nodeId: 'accommodation' })];
  const result = validateProposal(
    proposal([{ moveId: 'mv_1' }]),
    context(moves, { lockedNodes: ['accommodation'] }),
  );
  assert.equal(result.accepted, false);
  assert.ok(result.violations.some((violation) => violation.rule === 'V4'));
});

test('V5: 재심 상한을 넘으면 거부된다', () => {
  const moves = [move('mv_1', { type: 'rerun_round', round: 'r_2', rerunUsed: 2 })];
  const result = validateProposal(proposal([{ moveId: 'mv_1' }]), context(moves));
  assert.ok(result.violations.some((violation) => violation.rule === 'V5'));
});

test('V6: 비용 초과는 거부가 아니라 축약 모드 강등이다', () => {
  const moves = [move('mv_1', { round: 'r_2', usd: 0.4, usdRemaining: 0.1 })];
  const result = validateProposal(proposal([{ moveId: 'mv_1' }]), context(moves));
  assert.equal(result.accepted, true);
  assert.equal(result.degradeToReduced, true);
});

test('V7: 미실행 라운드가 있으면 finalize를 거부한다', () => {
  const moves = [move('mv_fin', { type: 'finalize_plan' })];
  const result = validateProposal(
    proposal([{ moveId: 'mv_fin' }]),
    context(moves, { pendingRounds: ['r_5', 'r_6'] }),
  );
  assert.equal(result.accepted, false);
  assert.ok(result.violations.some((violation) => violation.rule === 'V7'));
});

test('A17/V8: 승인 필요 이동은 raise_approval로 변환된다', () => {
  const moves = [move('mv_date', { type: 'recalc_node', nodeId: 'date' })];
  const result = validateProposal(
    proposal([{ moveId: 'mv_date' }]),
    context(moves, { approvalRequiredMoveIds: ['mv_date'] }),
  );
  assert.equal(result.accepted, false);
  assert.deepEqual(result.convertToApproval, ['mv_date']);
});

test('V9: fail-closed 미검증 노드는 승격할 수 없다', () => {
  const moves = [move('mv_1', { type: 'recalc_node', nodeId: 'dining' })];
  const result = validateProposal(
    proposal([{ moveId: 'mv_1' }]),
    context(moves, { unverifiedNodes: ['dining'] }),
  );
  assert.equal(result.accepted, false);
  assert.ok(result.violations.some((violation) => violation.rule === 'V9'));
  assert.deepEqual(result.blockedNodes, ['dining']);
});

test('V9: 미검증 노드가 있으면 finalize 자체를 막는다', () => {
  const moves = [move('mv_fin', { type: 'finalize_plan' })];
  const result = validateProposal(
    proposal([{ moveId: 'mv_fin' }]),
    context(moves, { unverifiedNodes: ['dining', 'accommodation'] }),
  );
  assert.equal(result.accepted, false);
  const violation = result.violations.find((v) => v.rule === 'V9');
  assert.match(violation?.detail ?? '', /finalize할 수 없습니다/);
  assert.deepEqual(result.blockedNodes.sort(), ['accommodation', 'dining']);
});

test('V9: 검증된 노드는 통과한다', () => {
  const moves = [move('mv_fin', { type: 'finalize_plan' })];
  const result = validateProposal(proposal([{ moveId: 'mv_fin' }]), context(moves));
  assert.equal(result.accepted, true);
});

test('A6/V10: Supervisor가 C5를 pass로 판정하면 불일치로 기록된다', () => {
  const machine = runMechanicalChecks({
    roundId: 'r_4',
    satisfactions: { a: 7, b: 7 },
    budget: { allocatedPerPersonKrw: 100000, spentPerPersonKrw: 100000 },
    hardConstraintViolations: ['갑각류 취급'],
  });

  const moves = [move('mv_1', { round: 'r_4' })];
  const result = validateProposal(
    proposal([{ moveId: 'mv_1' }], [
      { roundId: 'r_4', decision: 'pass', triggered: [], reason: '문제 없음', instruction: null },
    ]),
    context(moves, { mechanicalChecks: [machine] }),
  );

  // V10은 거부 사유가 아니다 — 코드 판정을 채택하고 불일치를 남긴다
  assert.equal(result.accepted, true);
  assert.equal(result.reviewMismatch.length, 1);
  assert.match(result.reviewMismatch[0]?.detail ?? '', /C5: 코드=위반 \/ Supervisor=통과/);
});

test('V10: 판정이 일치하면 불일치가 없다', () => {
  const machine = runMechanicalChecks({
    roundId: 'r_4',
    satisfactions: { a: 7, b: 7 },
    budget: { allocatedPerPersonKrw: 100000, spentPerPersonKrw: 100000 },
    hardConstraintViolations: ['갑각류 취급'],
  });
  const moves = [move('mv_1', { round: 'r_4' })];
  const result = validateProposal(
    proposal([{ moveId: 'mv_1' }], [
      { roundId: 'r_4', decision: 'resource', triggered: ['C5'], reason: '위반', instruction: null },
    ]),
    context(moves, { mechanicalChecks: [machine] }),
  );
  assert.deepEqual(result.reviewMismatch, []);
});
