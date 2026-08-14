import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MvpUserProxyInput } from '@tm/contracts';
import { FixtureMvpAgentRuntime } from './mvp-runtime.js';

const userProxyInput: MvpUserProxyInput = {
  role: 'USER_PROXY',
  runId: 'run-1',
  tripId: 'trip-1',
  planVersion: 1,
  participant: {
    participantId: 'user-1',
    confirmedFactIds: ['fact-1'],
    preferences: [
      { preferenceId: 'quiet', statement: '조용한 숙소', weightBp: 10_000, factId: 'fact-1' },
    ],
    hardConstraints: [],
    protectedObjectives: [],
    budgetMaxKrw: 400_000,
  },
  proposals: [
    {
      proposalId: 'stay-a',
      proposalSetVersion: 1,
      headline: 'A 숙소',
      costPerPersonKrw: 200_000,
      capacity: 3,
      attributesBp: { quiet: 8_000 },
      violatedConstraintIds: [],
      evidenceIds: ['ev-a'],
    },
  ],
  evaluations: [
    {
      proposalId: 'stay-a',
      satisfactionBp: 8_000,
      profileFactIds: ['fact-1'],
      evidenceIds: ['ev-a'],
    },
  ],
  evidence: [{ evidenceId: 'ev-a', status: 'VERIFIED', summary: 'fixture' }],
};

test('fixture runtime은 USER_PROXY 계약을 strict하게 실행한다', async () => {
  const runtime = new FixtureMvpAgentRuntime();
  const output = await runtime.run(userProxyInput);
  assert.equal(output.role, 'USER_PROXY');
  if (output.role !== 'USER_PROXY') return;
  assert.deepEqual(output.ballot.rankedProposalIds, ['stay-a']);
  assert.equal(output.ballot.satisfactionByProposalBp['stay-a'], 8_000);
});
