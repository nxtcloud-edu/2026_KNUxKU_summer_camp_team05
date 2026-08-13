import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateStartTrigger, type TriggerContext, type TriggerMember } from './triggers.js';

/**
 * 트리거 3종. 근거: travel-mediation-plan.md 7장
 *
 * 가장 중요한 규칙: 페르소나를 확인하지 않은 사람은 참석자가 아니다.
 */

const member = (userId: string, overrides: Partial<TriggerMember> = {}): TriggerMember => ({
  userId,
  role: 'member',
  surveySubmitted: true,
  personaConfirmed: true,
  ...overrides,
});

const context = (overrides: Partial<TriggerContext> = {}): TriggerContext => ({
  roomStatus: 'COLLECTING',
  members: [member('host_1', { role: 'host' }), member('user_2'), member('user_3')],
  now: '2026-08-13T10:00:00.000Z',
  ...overrides,
});

test('전원 완료면 all_done으로 시작한다', () => {
  const decision = evaluateStartTrigger('all_done', context());

  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.attendees, ['host_1', 'user_2', 'user_3']);
  assert.deepEqual(decision.absentees, []);
});

test('설문 미제출자가 있으면 all_done은 시작하지 않는다', () => {
  const decision = evaluateStartTrigger(
    'all_done',
    context({
      members: [member('host_1', { role: 'host' }), member('user_2', { surveySubmitted: false })],
    }),
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'survey_incomplete');
});

test('페르소나 미확인자가 있으면 all_done은 시작하지 않는다', () => {
  const decision = evaluateStartTrigger(
    'all_done',
    context({
      members: [member('host_1', { role: 'host' }), member('user_2', { personaConfirmed: false })],
    }),
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'persona_unconfirmed');
});

test('방장 시작은 미응답자를 두고 진행한다', () => {
  const decision = evaluateStartTrigger(
    'host',
    context({
      requesterId: 'host_1',
      members: [
        member('host_1', { role: 'host' }),
        member('user_2'),
        member('user_3', { surveySubmitted: false }),
      ],
    }),
  );

  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.attendees, ['host_1', 'user_2']);
  assert.deepEqual(decision.absentees, [{ userId: 'user_3', reason: 'no_survey' }]);
});

test('방장이 아니면 host 트리거를 쓸 수 없다', () => {
  const decision = evaluateStartTrigger('host', context({ requesterId: 'user_2' }));

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'not_host');
});

test('페르소나를 확인하지 않으면 방장이 시작해도 대변인을 세우지 않는다', () => {
  // 확인하지 않은 대리인이 대변하면 그건 대리가 아니라 추측이다.
  const decision = evaluateStartTrigger(
    'host',
    context({
      requesterId: 'host_1',
      members: [
        member('host_1', { role: 'host' }),
        member('user_2'),
        member('user_3', { personaConfirmed: false }),
      ],
    }),
  );

  assert.equal(decision.allowed, true);
  assert.equal(decision.attendees.includes('user_3'), false);
  assert.deepEqual(decision.absentees, [{ userId: 'user_3', reason: 'no_persona_confirm' }]);
});

test('참석자가 2명 미만이면 시작하지 않는다', () => {
  const decision = evaluateStartTrigger(
    'host',
    context({
      requesterId: 'host_1',
      members: [
        member('host_1', { role: 'host' }),
        member('user_2', { surveySubmitted: false }),
        member('user_3', { surveySubmitted: false }),
      ],
    }),
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'not_enough_attendees');
});

test('마감 기한 전에는 deadline 트리거가 거부된다', () => {
  const decision = evaluateStartTrigger(
    'deadline',
    context({ deadlineAt: '2026-08-14T00:00:00.000Z' }),
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'deadline_not_reached');
});

test('마감 기한이 지나면 deadline 트리거가 열린다', () => {
  const decision = evaluateStartTrigger(
    'deadline',
    context({ deadlineAt: '2026-08-13T09:00:00.000Z' }),
  );

  assert.equal(decision.allowed, true);
});

test('마감 기한이 없으면 deadline 트리거를 쓸 수 없다', () => {
  const decision = evaluateStartTrigger('deadline', context({ deadlineAt: null }));

  assert.equal(decision.reason, 'deadline_not_set');
});

test('이미 실행 중인 방은 다시 시작하지 않는다', () => {
  // 결과를 바꾸는 경로는 이의 제기뿐이다.
  for (const status of ['QUEUED', 'RUNNING', 'COMPLETED'] as const) {
    const decision = evaluateStartTrigger('all_done', context({ roomStatus: status }));
    assert.equal(decision.reason, 'already_running', status);
  }
});

test('혼자 있는 방은 중재할 것이 없다', () => {
  const decision = evaluateStartTrigger(
    'all_done',
    context({ members: [member('host_1', { role: 'host' })] }),
  );

  assert.equal(decision.reason, 'not_enough_members');
});
