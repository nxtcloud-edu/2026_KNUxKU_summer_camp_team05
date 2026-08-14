import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCandidatePoolVersion } from './candidate-pool.js';
import {
  CategoryProposalBuildError,
  buildStayCategoryProposal,
  buildStayCategoryProposalSet,
  stayProposalId,
} from './category-proposal-builder.js';
import { validateStayCandidate } from './fact-constraint-validator.js';
import {
  createOsakaStayEvidence,
  createOsakaStayValidationInput,
} from './osaka-stay.test-fixture.js';

function eligibleOsakaValidation() {
  return validateStayCandidate(createOsakaStayValidationInput({
    proposalId: stayProposalId('candidate:osaka:namba', 1),
  }));
}

function osakaPool(validation: ReturnType<typeof validateStayCandidate>) {
  return buildCandidatePoolVersion({
    poolId: 'pool:stay:osaka:1',
    version: 1,
    charter: createOsakaStayValidationInput().charter,
    validations: [validation],
    representativeBriefIdByParticipantId: {
      u1: 'brief:u1',
      u2: 'brief:u2',
      u3: 'brief:u3',
    },
    neutralBriefIds: ['brief:neutral'],
    createdAt: '2026-08-14T12:05:00.000Z',
  }).pool;
}

test('검증된 Osaka 후보 하나를 canonical CategoryProposalSet으로 결정론적으로 봉인한다', () => {
  const validation = eligibleOsakaValidation();
  const pool = osakaPool(validation);
  const input = {
    proposalSetId: 'proposal-set:stay:osaka:1',
    proposalSetVersion: 1,
    pool,
    validations: [validation],
    sealedAt: '2026-08-14T12:10:00.000Z',
  };

  const first = buildStayCategoryProposalSet(input);
  const second = buildStayCategoryProposalSet(input);

  assert.deepEqual(first, second);
  assert.equal(first.candidatePoolVersion, 1);
  assert.equal(first.proposals.length, 1);
  const proposal = first.proposals[0];
  assert.equal(proposal?.proposalId, 'proposal:stay:candidate:osaka:namba:v1');
  assert.deepEqual(proposal?.candidateIds, ['candidate:osaka:namba']);
  assert.deepEqual(proposal?.costByParticipantKrw, { u1: 300_000, u2: 300_000, u3: 300_000 });
  assert.equal(proposal?.totalCostKrw, 900_000);
  assert.equal(proposal?.capacityPlan.confirmedCapacity, 3);
  assert.deepEqual(proposal?.capacityPlan.unassignedParticipantIds, []);
  assert.deepEqual(proposal?.violatedConstraintIds, []);
  assert.deepEqual(proposal?.evidenceIds, ['evidence:osaka:namba']);
  assert.deepEqual(proposal?.attributesBp, {
    'constraint:u1:no-dormitory': 10_000,
    'constraint:u2:private-bathroom': 10_000,
  });
  assert.deepEqual(proposal?.concessionByParticipantBp, { u1: 0, u2: 0, u3: 0 });
  assert.equal(proposal?.travelBurdenMinutes, 12);
  assert.equal(proposal?.cancellationScoreBp, 10_000);
  assert.equal(proposal?.evidenceQualityBp, 10_000);
});

test('UNKNOWN evidence 후보는 CategoryProposal로 직접 승격할 수 없다', () => {
  const validation = validateStayCandidate(createOsakaStayValidationInput({
    evidence: [createOsakaStayEvidence({ status: 'UNKNOWN' })],
  }));

  assert.throws(
    () => buildStayCategoryProposal(validation, 1),
    (error: unknown) =>
      error instanceof CategoryProposalBuildError && error.code === 'CANDIDATE_NOT_ELIGIBLE',
  );
});

test('proposal version과 검증 receipt proposalId가 다르면 봉인을 거부한다', () => {
  const validation = eligibleOsakaValidation();

  assert.throws(
    () => buildStayCategoryProposal(validation, 2),
    (error: unknown) =>
      error instanceof CategoryProposalBuildError && error.code === 'PROPOSAL_ID_MISMATCH',
  );
});

test('필수 validator receipt가 하나라도 빠지면 ELIGIBLE 표기만으로 승격하지 않는다', () => {
  const validation = eligibleOsakaValidation();
  if (validation.eligibility !== 'ELIGIBLE') throw new Error('eligible fixture가 아닙니다.');
  const incomplete = { ...validation, receipts: validation.receipts.slice(1) };

  assert.throws(
    () => buildStayCategoryProposal(incomplete, 1),
    (error: unknown) =>
      error instanceof CategoryProposalBuildError && error.code === 'CANDIDATE_NOT_ELIGIBLE',
  );
});
