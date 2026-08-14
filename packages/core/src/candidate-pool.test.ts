import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CandidatePoolBuildError,
  buildCandidatePoolVersion,
} from './candidate-pool.js';
import { validateStayCandidate } from './fact-constraint-validator.js';
import {
  createOsakaStayCandidate,
  createOsakaStayEvidence,
  createOsakaStayValidationInput,
  osakaStayPayload,
} from './osaka-stay.test-fixture.js';

const representativeBriefIdByParticipantId = {
  u1: 'brief:u1',
  u2: 'brief:u2',
  u3: 'brief:u3',
};

function buildInput(
  validations: ReturnType<typeof validateStayCandidate>[],
) {
  return {
    poolId: 'pool:stay:osaka:1',
    version: 1,
    charter: createOsakaStayValidationInput().charter,
    validations,
    representativeBriefIdByParticipantId,
    neutralBriefIds: ['brief:neutral'],
    createdAt: '2026-08-14T12:05:00.000Z',
  };
}

test('ELIGIBLE만 active pool에 두고 UNVERIFIED/BLOCKED를 이유와 함께 제외한다', () => {
  const eligible = validateStayCandidate(createOsakaStayValidationInput());
  const unverifiedCandidate = createOsakaStayCandidate({
    candidateId: 'candidate:osaka:unverified',
    providerCandidateId: 'hotel-osaka-unverified',
    evidenceIds: ['evidence:osaka:unverified'],
    payload: { ...osakaStayPayload, id: 'hotel-osaka-unverified' },
  });
  const unverified = validateStayCandidate(createOsakaStayValidationInput({
    proposalId: 'proposal:stay:candidate:osaka:unverified:v1',
    candidate: unverifiedCandidate,
    evidence: [createOsakaStayEvidence({
      evidenceId: 'evidence:osaka:unverified',
      providerCandidateId: 'hotel-osaka-unverified',
      status: 'UNKNOWN',
    })],
    capacityPlan: {
      ...createOsakaStayValidationInput().capacityPlan!,
      evidenceIds: ['evidence:osaka:unverified'],
    },
  }));
  const blockedCandidate = createOsakaStayCandidate({
    candidateId: 'candidate:osaka:blocked',
    providerCandidateId: 'hotel-osaka-blocked',
    evidenceIds: ['evidence:osaka:blocked'],
    payload: { ...osakaStayPayload, id: 'hotel-osaka-blocked', amenities: ['wifi'] },
  });
  const blocked = validateStayCandidate(createOsakaStayValidationInput({
    proposalId: 'proposal:stay:candidate:osaka:blocked:v1',
    candidate: blockedCandidate,
    evidence: [createOsakaStayEvidence({
      evidenceId: 'evidence:osaka:blocked',
      providerCandidateId: 'hotel-osaka-blocked',
    })],
    capacityPlan: {
      ...createOsakaStayValidationInput().capacityPlan!,
      evidenceIds: ['evidence:osaka:blocked'],
    },
  }));

  const result = buildCandidatePoolVersion(buildInput([eligible, unverified, blocked]));

  assert.deepEqual(result.pool.candidateIds, ['candidate:osaka:namba']);
  assert.deepEqual(result.pool.representativeCandidateByParticipantId, {
    u1: 'candidate:osaka:namba',
    u2: 'candidate:osaka:namba',
    u3: 'candidate:osaka:namba',
  });
  assert.deepEqual(result.pool.neutralCandidateIds, ['candidate:osaka:namba']);
  assert.equal(result.pool.excludedCandidates.length, 2);
  assert.ok(result.pool.excludedCandidates.every((candidate) => candidate.reasons.length > 0));
  assert.deepEqual(result.unverifiedCandidates.map((candidate) => candidate.candidateId), [
    'candidate:osaka:unverified',
  ]);
  assert.deepEqual(result.blockedCandidates.map((candidate) => candidate.candidateId), [
    'candidate:osaka:blocked',
  ]);
});

test('ELIGIBLE 대표 후보가 사라지면 Proxy representation을 조용히 삭제하지 않는다', () => {
  const candidate = createOsakaStayCandidate({ sourceBriefIds: ['brief:neutral'] });
  const validation = validateStayCandidate(createOsakaStayValidationInput({ candidate }));

  assert.throws(
    () => buildCandidatePoolVersion(buildInput([validation])),
    (error: unknown) =>
      error instanceof CandidatePoolBuildError &&
      error.code === 'MISSING_ELIGIBLE_REPRESENTATIVE',
  );
});

test('ELIGIBLE 표기와 non-PASS receipt가 충돌하면 active pool 승격을 거부한다', () => {
  const validation = validateStayCandidate(createOsakaStayValidationInput());
  if (validation.eligibility !== 'ELIGIBLE') throw new Error('eligible fixture가 아닙니다.');
  const firstReceipt = validation.receipts[0];
  if (firstReceipt === undefined) throw new Error('receipt fixture가 없습니다.');
  const tampered = {
    ...validation,
    receipts: [{ ...firstReceipt, status: 'UNKNOWN' as const }, ...validation.receipts.slice(1)],
  };

  assert.throws(
    () => buildCandidatePoolVersion(buildInput([tampered])),
    (error: unknown) =>
      error instanceof CandidatePoolBuildError && error.code === 'INVALID_VALIDATION_RESULT',
  );
});
