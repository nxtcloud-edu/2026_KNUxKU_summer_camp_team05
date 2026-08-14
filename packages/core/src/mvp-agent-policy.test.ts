import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CandidateSearchInput, MvpProxyBallot } from '@tm/contracts';
import {
  MvpPrivacyBoundaryError,
  assertMvpAgentContextSafe,
  planMvpCandidateSearch,
  projectMvpUserProxyProfile,
  selectMvpStayProposal,
} from './mvp-agent-policy.js';

const searchInput: CandidateSearchInput = {
  schemaVersion: 1,
  runId: 'run-1',
  tripId: 'trip-1',
  planVersion: 1,
  category: 'stay',
  shortageReason: 'LOW_CONFIDENCE',
  unresolvedTerms: ['오사카', '3박', '오사카'],
  canonicalConstraints: {
    hardConstraintIds: ['hc.smoke-free'],
    protectedObjectiveIds: ['po.accessibility'],
    filters: { guests: 3 },
  },
  allowedRelaxationIds: ['pref.distance'],
  requestedRelaxationIds: ['pref.distance'],
  currentCandidateIds: [],
};

test('검색 계획은 확인된 조건과 허용된 완화만 사용한다', () => {
  const output = planMvpCandidateSearch(searchInput);
  assert.equal(output.status, 'QUERY_PLAN_PROPOSED');
  assert.deepEqual(output.queryPlans[0]?.keywords, ['오사카', '3박']);
  assert.deepEqual(output.queryPlans[0]?.relaxationChanges, ['pref.distance']);
});

test('허용 목록에 잘못 들어 있어도 안전·보호 조건 완화는 거부한다', () => {
  const output = planMvpCandidateSearch({
    ...searchInput,
    allowedRelaxationIds: ['hc.smoke-free'],
    requestedRelaxationIds: ['hc.smoke-free'],
  });
  assert.equal(output.status, 'NO_SAFE_QUERY');
  assert.deepEqual(output.queryPlans, []);
});

test('projection은 본인 confirmed profile만 남긴다', () => {
  const source = {
    profiles: {
      'user-1': {
        participantId: 'user-1',
        confirmedFactIds: ['fact-1'],
        preferences: [
          { preferenceId: 'central', statement: '중심지 선호', weightBp: 10_000, factId: 'fact-1' },
        ],
        hardConstraints: [],
        protectedObjectives: [],
        budgetMaxKrw: 300_000,
      },
      'user-2': {
        participantId: 'user-2',
        confirmedFactIds: [],
        preferences: [],
        hardConstraints: [],
        protectedObjectives: [],
        budgetMaxKrw: 500_000,
      },
    },
    rawSurvey: { answer: 'private' },
    credential: 'secret',
  };
  const projected = projectMvpUserProxyProfile(source, 'user-1');
  assert.equal(projected.participantId, 'user-1');
  assert.equal(JSON.stringify(projected).includes('user-2'), false);
  assert.equal(JSON.stringify(projected).includes('secret'), false);
  assert.doesNotThrow(() => assertMvpAgentContextSafe(projected));
  assert.throws(() => assertMvpAgentContextSafe(source), MvpPrivacyBoundaryError);
});

test('결정론 선택은 maximin, 총합, proposal id 순서를 적용한다', () => {
  const ballots: MvpProxyBallot[] = [
    {
      participantId: 'user-1',
      rankedProposalIds: ['stay-b', 'stay-a'],
      satisfactionByProposalBp: { 'stay-a': 7_000, 'stay-b': 8_000 },
      profileFactIds: [],
      evidenceIds: [],
      rationale: 'fixture',
    },
    {
      participantId: 'user-2',
      rankedProposalIds: ['stay-b', 'stay-a'],
      satisfactionByProposalBp: { 'stay-a': 4_000, 'stay-b': 7_500 },
      profileFactIds: [],
      evidenceIds: [],
      rationale: 'fixture',
    },
  ];
  const selection = selectMvpStayProposal(ballots, ['stay-a', 'stay-b']);
  assert.equal(selection.selectedProposalId, 'stay-b');
  assert.equal(selection.decidedBy, 'MAXIMIN');
});
