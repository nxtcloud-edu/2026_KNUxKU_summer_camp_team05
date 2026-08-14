import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CategoryProposal, CategoryProposalSet, ProxyBallot } from '@tm/contracts';
import { selectCategoryProposalLeximin } from './agent-policy.js';

const participantIds = ['u1', 'u2', 'u3'] as const;

function proposal(
  proposalId: string,
  overrides: Partial<CategoryProposal> = {},
): CategoryProposal {
  return {
    schemaVersion: 1,
    proposalId,
    category: 'stay',
    proposalSetVersion: 1,
    summary: proposalId,
    candidateIds: [`candidate:${proposalId}`],
    costByParticipantKrw: { u1: 100_000, u2: 100_000, u3: 100_000 },
    capacityPlan: {
      requestedPartySize: 3,
      confirmedCapacity: 3,
      allocations: [
        {
          resourceUnitId: `room:${proposalId}`,
          confirmedCapacity: 3,
          assignedParticipantIds: [...participantIds],
        },
      ],
      unassignedParticipantIds: [],
      evidenceIds: [`evidence:${proposalId}`],
      splitAuthorityRef: null,
    },
    violatedConstraintIds: [],
    evidenceIds: [`evidence:${proposalId}`],
    attributesBp: {},
    concessionByParticipantBp: { u1: 1_000, u2: 1_000, u3: 1_000 },
    totalCostKrw: 300_000,
    travelBurdenMinutes: 30,
    cancellationScoreBp: 8_000,
    evidenceQualityBp: 8_000,
    ...overrides,
  };
}

function proposalSet(proposals: CategoryProposal[]): CategoryProposalSet {
  return {
    schemaVersion: 1,
    proposalSetId: 'proposal-set:stay:1',
    category: 'stay',
    proposalSetVersion: 1,
    candidatePoolVersion: 1,
    proposals,
    sealedAt: '2026-08-14T00:00:00.000Z',
  };
}

function ballots(scores: Record<string, readonly number[]>): ProxyBallot[] {
  return participantIds.map((participantId, participantIndex) => {
    const entries = Object.entries(scores).map(([proposalId, values]) => {
      const value = values[participantIndex];
      if (value === undefined) throw new Error('fixture 만족도가 부족합니다.');
      return [proposalId, value] as const;
    });
    const ranked = [...entries]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([proposalId]) => proposalId);
    return {
      schemaVersion: 1,
      ballotId: `ballot:${participantId}`,
      participantId,
      category: 'stay',
      proposalSetVersion: 1,
      rankedProposalIds: ranked,
      satisfactionByProposalBp: Object.fromEntries(entries),
      stanceByProposal: Object.fromEntries(entries.map(([proposalId]) => [proposalId, 'support'])),
      profileFactRefs: [],
      conditionalTerms: [],
      rationale: 'fixture',
      evidenceChallenges: [],
      candidateGapRequest: null,
    };
  });
}

test('leximin은 최저점 동률 뒤 두 번째로 낮은 만족도를 비교한다', () => {
  const result = selectCategoryProposalLeximin(
    ballots({ a: [1_000, 9_000, 9_000], b: [1_000, 8_000, 10_000] }),
    proposalSet([proposal('a'), proposal('b')]),
  );
  assert.equal(result.selectedProposalId, 'a');
  assert.equal(result.decidedBy, 'LEXIMIN');
  assert.deepEqual(result.satisfactionVectorByProposal['a'], [1_000, 9_000, 9_000]);
});

test('만족도 전체가 같으면 양보 불균형이 작은 Proposal을 고른다', () => {
  const result = selectCategoryProposalLeximin(
    ballots({ a: [7_000, 7_000, 7_000], b: [7_000, 7_000, 7_000] }),
    proposalSet([
      proposal('a'),
      proposal('b', { concessionByParticipantBp: { u1: 0, u2: 1_000, u3: 2_000 } }),
    ]),
  );
  assert.equal(result.selectedProposalId, 'a');
  assert.equal(result.decidedBy, 'CONCESSION_IMBALANCE');
});

test('서로 다른 proposalSetVersion의 Ballot은 섞지 않는다', () => {
  const mixed = ballots({ a: [7_000, 7_000, 7_000], b: [6_000, 6_000, 6_000] });
  const second = mixed[1];
  if (second === undefined) throw new Error('fixture ballot이 부족합니다.');
  mixed[1] = { ...second, proposalSetVersion: 2 };
  assert.throws(
    () => selectCategoryProposalLeximin(mixed, proposalSet([proposal('a'), proposal('b')])),
    /proposalSetVersion/,
  );
});
