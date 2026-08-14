import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tripCharterSchema } from '@tm/contracts';
import {
  STAY_VALIDATION_RULE_IDS,
  validateStayCandidate,
} from './fact-constraint-validator.js';
import {
  createOsakaStayCandidate,
  createOsakaStayCapacityPlan,
  createOsakaStayEvidence,
  createOsakaStayValidationInput,
  osakaStayCharter,
  osakaStayPayload,
} from './osaka-stay.test-fixture.js';

function payloadObject(key: string): Record<string, unknown> {
  const value = osakaStayPayload[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${key} fixture가 object가 아닙니다.`);
  }
  return value as Record<string, unknown>;
}

test('Osaka 3인 3박 숙소를 모든 PASS 근거에서 ELIGIBLE로 승격한다', () => {
  const result = validateStayCandidate(createOsakaStayValidationInput());

  assert.equal(result.eligibility, 'ELIGIBLE');
  assert.ok(result.receipts.every((receipt) => receipt.status === 'PASS'));
  if (result.eligibility !== 'ELIGIBLE') throw new Error('eligible fixture가 아닙니다.');
  assert.equal(result.totalCostKrw, 900_000);
  assert.deepEqual(result.costByParticipantKrw, { u1: 300_000, u2: 300_000, u3: 300_000 });
  assert.equal(result.capacityPlan.confirmedCapacity, 3);
  assert.equal(result.attributesBp['constraint:u2:private-bathroom'], 10_000);
  assert.equal(result.travelBurdenMinutes, 12);
  assert.equal(result.cancellationScoreBp, 10_000);
  assert.equal(result.evidenceQualityBp, 10_000);
});

test('필수 hard attribute 위반은 BLOCKED이며 PASS로 승격되지 않는다', () => {
  const candidate = createOsakaStayCandidate({
    payload: { ...osakaStayPayload, amenities: ['wifi', 'non-smoking'] },
  });
  const result = validateStayCandidate(createOsakaStayValidationInput({ candidate }));

  assert.equal(result.eligibility, 'BLOCKED');
  assert.equal(result.candidate.poolEligibility, 'BLOCKED');
  assert.equal(
    result.receipts.find((receipt) => receipt.ruleId === STAY_VALIDATION_RULE_IDS.requiredAttributes)?.status,
    'FAIL',
  );
});

test('UNKNOWN, STALE, CONTRADICTED evidence는 어느 것도 ELIGIBLE이 아니다', () => {
  const cases = [
    { status: 'UNKNOWN' as const, expectedEligibility: 'UNVERIFIED' },
    { status: 'STALE' as const, expectedEligibility: 'UNVERIFIED' },
    { status: 'CONTRADICTED' as const, expectedEligibility: 'BLOCKED' },
  ];
  for (const item of cases) {
    const result = validateStayCandidate(createOsakaStayValidationInput({
      evidence: [createOsakaStayEvidence({ status: item.status })],
    }));
    assert.equal(result.eligibility, item.expectedEligibility, item.status);
    assert.ok(result.receipts.some((receipt) => receipt.status === item.status), item.status);
  }
});

test('missing evidence는 UNKNOWN/UNVERIFIED로 닫힌다', () => {
  const result = validateStayCandidate(createOsakaStayValidationInput({ evidence: [] }));

  assert.equal(result.eligibility, 'UNVERIFIED');
  assert.equal(
    result.receipts.find((receipt) => receipt.ruleId === STAY_VALIDATION_RULE_IDS.evidenceExistence)?.status,
    'UNKNOWN',
  );
});

test('2개 객실 배정은 명시적으로 허용된 split authority가 있어야 통과한다', () => {
  const splitPlan = createOsakaStayCapacityPlan({
    allocations: [
      {
        resourceUnitId: 'room:osaka:namba:twin',
        confirmedCapacity: 2,
        assignedParticipantIds: ['u1', 'u2'],
      },
      {
        resourceUnitId: 'room:osaka:namba:single',
        confirmedCapacity: 1,
        assignedParticipantIds: ['u3'],
      },
    ],
    splitAuthorityRef: null,
  });
  const blocked = validateStayCandidate(createOsakaStayValidationInput({ capacityPlan: splitPlan }));
  assert.equal(blocked.eligibility, 'BLOCKED');
  assert.equal(
    blocked.receipts.find((receipt) => receipt.ruleId === STAY_VALIDATION_RULE_IDS.roomSplitAuthority)?.status,
    'FAIL',
  );

  const authorizedPlan = createOsakaStayCapacityPlan({
    allocations: splitPlan.allocations,
    splitAuthorityRef: 'authority:room-split:osaka:1',
  });
  const eligible = validateStayCandidate(createOsakaStayValidationInput({
    capacityPlan: authorizedPlan,
    allowedRoomSplitAuthorityRefs: ['authority:room-split:osaka:1'],
  }));
  assert.equal(eligible.eligibility, 'ELIGIBLE');
});

test('개인별 절대 예산을 1원이라도 넘으면 BLOCKED다', () => {
  const charter = tripCharterSchema.parse({
    ...osakaStayCharter,
    budgetMaxByParticipantKrw: { u1: 299_999, u2: 400_000, u3: 500_000 },
  });
  const result = validateStayCandidate(createOsakaStayValidationInput({ charter }));

  assert.equal(result.eligibility, 'BLOCKED');
  assert.equal(
    result.receipts.find((receipt) => receipt.ruleId === STAY_VALIDATION_RULE_IDS.participantBudget)?.status,
    'FAIL',
  );
});

test('providerCandidateId 계보 불일치는 CONTRADICTED/BLOCKED다', () => {
  const evidence = createOsakaStayEvidence({ providerCandidateId: 'different-hotel' });
  const result = validateStayCandidate(createOsakaStayValidationInput({ evidence: [evidence] }));

  assert.equal(result.eligibility, 'BLOCKED');
  assert.equal(
    result.receipts.find((receipt) => receipt.ruleId === STAY_VALIDATION_RULE_IDS.providerProvenance)?.status,
    'CONTRADICTED',
  );
});

test('날짜·인원·가용성은 각각 정확한 Provider 조회 컨텍스트와 일치해야 한다', () => {
  const baseVerification = payloadObject('stayVerification');
  const cases = [
    {
      ruleId: STAY_VALIDATION_RULE_IDS.dateMatch,
      stayVerification: { ...baseVerification, checkOut: '2026-10-20' },
    },
    {
      ruleId: STAY_VALIDATION_RULE_IDS.partySize,
      stayVerification: { ...baseVerification, partySize: 2 },
    },
    {
      ruleId: STAY_VALIDATION_RULE_IDS.availability,
      stayVerification: { ...baseVerification, available: false },
    },
  ];
  for (const item of cases) {
    const candidate = createOsakaStayCandidate({
      payload: { ...osakaStayPayload, stayVerification: item.stayVerification },
    });
    const result = validateStayCandidate(createOsakaStayValidationInput({ candidate }));
    assert.equal(result.eligibility, 'BLOCKED', item.ruleId);
    assert.equal(
      result.receipts.find((receipt) => receipt.ruleId === item.ruleId)?.status,
      'FAIL',
      item.ruleId,
    );
  }
});

test('정원 부족과 일부 미배정은 각각 active proposal 승격을 차단한다', () => {
  const insufficient = createOsakaStayCapacityPlan({
    confirmedCapacity: 2,
    allocations: [{
      resourceUnitId: 'room:too-small',
      confirmedCapacity: 2,
      assignedParticipantIds: ['u1', 'u2'],
    }],
    unassignedParticipantIds: ['u3'],
  });
  const insufficientResult = validateStayCandidate(createOsakaStayValidationInput({
    capacityPlan: insufficient,
  }));
  assert.equal(insufficientResult.eligibility, 'BLOCKED');
  assert.equal(
    insufficientResult.receipts.find((receipt) => receipt.ruleId === STAY_VALIDATION_RULE_IDS.roomCapacity)?.status,
    'FAIL',
  );

  const unassigned = createOsakaStayCapacityPlan({
    allocations: [{
      resourceUnitId: 'room:partial',
      confirmedCapacity: 3,
      assignedParticipantIds: ['u1', 'u2'],
    }],
    unassignedParticipantIds: ['u3'],
  });
  const unassignedResult = validateStayCandidate(createOsakaStayValidationInput({
    capacityPlan: unassigned,
  }));
  assert.equal(unassignedResult.eligibility, 'BLOCKED');
  assert.equal(
    unassignedResult.receipts.find((receipt) => receipt.ruleId === STAY_VALIDATION_RULE_IDS.roomAllocation)?.status,
    'FAIL',
  );
});

test('음수·소수·합계 불일치 가격은 CONTRADICTED이며 비용을 발명하지 않는다', () => {
  const basePrice = payloadObject('price');
  const cases = [
    { ...basePrice, groupTotal: -900_000 },
    { ...basePrice, groupTotal: 900_000.5 },
    { ...basePrice, groupTotal: 900_001 },
  ];
  for (const price of cases) {
    const candidate = createOsakaStayCandidate({
      payload: { ...osakaStayPayload, price },
    });
    const result = validateStayCandidate(createOsakaStayValidationInput({ candidate }));
    assert.equal(result.eligibility, 'BLOCKED');
    assert.equal(
      result.receipts.find((receipt) => receipt.ruleId === STAY_VALIDATION_RULE_IDS.totalPrice)?.status,
      'CONTRADICTED',
    );
  }
});

test('payload source 계보가 CandidateRecord와 다르면 CONTRADICTED다', () => {
  const candidate = createOsakaStayCandidate({
    payload: { ...osakaStayPayload, source: 'different-provider' },
  });
  const result = validateStayCandidate(createOsakaStayValidationInput({ candidate }));

  assert.equal(result.eligibility, 'BLOCKED');
  assert.equal(
    result.receipts.find((receipt) => receipt.ruleId === STAY_VALIDATION_RULE_IDS.providerProvenance)?.status,
    'CONTRADICTED',
  );
});
