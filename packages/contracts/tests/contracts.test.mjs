import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyChangeAuthority } from '../dist/change-authority.js';
import { assertPlanningNodeTransition, planningNodeSchema } from '../dist/planning.js';
import { evaluateSatisfactionGap, proxyVoteSchema } from '../dist/rounds.js';
import { calculateStyleFitBp, travelStyleProfileSchema } from '../dist/style-policy.js';

const fullStyleProfile = {
  PACE: 1,
  PLANNING: 4,
  NATURE_VS_CITY: 4,
  HISTORY_VS_TREND: 4,
  LOCAL_VS_PROVEN_DINING: 4,
  TOGETHERNESS: 4,
  DAILY_RHYTHM: 4,
  EVENING_STYLE: 4,
  TRANSPORT_STYLE: 4,
  PHOTO_PRIORITY: 4,
  ACTIVITY_RISK: 7,
};

test('travel style contract requires every canonical axis', () => {
  assert.equal(travelStyleProfileSchema.safeParse({ PACE: 1 }).success, false);
  assert.equal(travelStyleProfileSchema.safeParse(fullStyleProfile).success, true);
  assert.throws(() => calculateStyleFitBp(0, 7));
});

test('proxy vote rejects accepting decisions with blocking reasons', () => {
  assert.equal(proxyVoteSchema.safeParse({
    participantId: 'p1', proposalId: 'plan1', decision: 'SUPPORT',
    reasonCode: 'HARD_CONSTRAINT', affectedPreferenceIds: [], evidenceIds: [], explanation: 'bad',
  }).success, false);
});

test('satisfaction gap validates runtime inputs and the 2500bp boundary', () => {
  const participants = [
    { participantId: 'a', status: 'SCORED', valueBp: 5_000 },
    { participantId: 'b', status: 'SCORED', valueBp: 7_500 },
  ];
  assert.equal(evaluateSatisfactionGap(participants, 0).status, 'PASS');
  assert.throws(() => evaluateSatisfactionGap([participants[0], participants[0]], 0));
  assert.throws(() => evaluateSatisfactionGap(participants, -1));
});

test('change authority fails closed for an empty reason set', () => {
  assert.throws(() => classifyChangeAuthority([]));
  assert.equal(classifyChangeAuthority(['SCHEDULE_REORDER']), 'AUTO_REPLAN');
  assert.equal(
    classifyChangeAuthority(['SCHEDULE_REORDER', 'DESTINATION_CHANGE']),
    'NEW_SURVEY_SNAPSHOT',
  );
});

test('planning node transition enforces version and BOOKABLE confidence', () => {
  const previous = planningNodeSchema.parse({
    nodeId: 'schedule', version: 1, inputHash: 'a', dependencyVersions: {},
    status: 'VERIFIED', confidence: 'estimated', evidenceRefs: ['e1'], locked: false,
    updatedAt: '2026-08-14T00:00:00.000Z',
  });
  const invalid = planningNodeSchema.parse({
    ...previous, version: 2, status: 'BOOKABLE', confidence: 'estimated',
    updatedAt: '2026-08-14T00:01:00.000Z',
  });
  assert.throws(() => assertPlanningNodeTransition(previous, invalid));
  assert.doesNotThrow(() => assertPlanningNodeTransition(previous, { ...invalid, confidence: 'live' }));
});
