import {
  candidatePoolVersionSchema,
  tripCharterSchema,
  type CandidatePoolVersion,
  type CandidateRecord,
  type TripCharter,
} from '@tm/contracts';
import {
  STAY_VALIDATION_RULE_IDS,
  type StayCandidateValidationResult,
} from './fact-constraint-validator.js';

export type CandidatePoolBuildErrorCode =
  | 'DUPLICATE_CANDIDATE_ID'
  | 'INVALID_VALIDATION_RESULT'
  | 'UNKNOWN_SOURCE_BRIEF'
  | 'NO_ELIGIBLE_CANDIDATE'
  | 'MISSING_ELIGIBLE_REPRESENTATIVE'
  | 'MISSING_ELIGIBLE_NEUTRAL_CANDIDATE';

export class CandidatePoolBuildError extends Error {
  constructor(
    readonly code: CandidatePoolBuildErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CandidatePoolBuildError';
  }
}

export interface CandidatePoolBuildInput {
  readonly poolId: string;
  readonly version: number;
  readonly charter: TripCharter;
  readonly validations: readonly StayCandidateValidationResult[];
  readonly representativeBriefIdByParticipantId: Readonly<Record<string, string>>;
  readonly neutralBriefIds: readonly string[];
  readonly createdAt: string;
}

export interface CandidatePoolBuildResult {
  readonly pool: CandidatePoolVersion;
  readonly eligibleCandidates: CandidateRecord[];
  readonly unverifiedCandidates: CandidateRecord[];
  readonly blockedCandidates: CandidateRecord[];
}

function byCandidateId(
  left: StayCandidateValidationResult,
  right: StayCandidateValidationResult,
): number {
  return left.candidate.candidateId.localeCompare(right.candidate.candidateId);
}

function validateBriefAuthority(
  charter: TripCharter,
  representativeBriefIdByParticipantId: Readonly<Record<string, string>>,
  neutralBriefIds: readonly string[],
): Set<string> {
  const participantIds = [...charter.participantIds].sort();
  const authorityParticipantIds = Object.keys(representativeBriefIdByParticipantId).sort();
  if (JSON.stringify(participantIds) !== JSON.stringify(authorityParticipantIds)) {
    throw new CandidatePoolBuildError(
      'INVALID_VALIDATION_RESULT',
      '모든 참여자에게 정확히 하나의 대표 Brief 권한이 필요합니다.',
    );
  }
  const representativeBriefIds = participantIds.map(
    (participantId) => representativeBriefIdByParticipantId[participantId] ?? '',
  );
  if (
    representativeBriefIds.some((briefId) => briefId.length === 0) ||
    new Set(representativeBriefIds).size !== representativeBriefIds.length ||
    neutralBriefIds.length === 0 ||
    new Set(neutralBriefIds).size !== neutralBriefIds.length ||
    neutralBriefIds.some((briefId) => briefId.length === 0 || representativeBriefIds.includes(briefId))
  ) {
    throw new CandidatePoolBuildError(
      'INVALID_VALIDATION_RESULT',
      '대표 Brief와 중립 Brief는 비어 있지 않고 서로 구분돼야 합니다.',
    );
  }
  return new Set([...representativeBriefIds, ...neutralBriefIds]);
}

function assertValidationIntegrity(validation: StayCandidateValidationResult): void {
  const candidate = validation.candidate;
  if (candidate.category !== 'stay' || candidate.poolEligibility !== validation.eligibility) {
    throw new CandidatePoolBuildError(
      'INVALID_VALIDATION_RESULT',
      `${candidate.candidateId}의 category 또는 eligibility가 validator 결과와 다릅니다.`,
    );
  }
  const nonPassReceipts = validation.receipts.filter((receipt) => receipt.status !== 'PASS');
  const receiptRuleIds = validation.receipts.map((receipt) => receipt.ruleId).sort();
  const requiredRuleIds = Object.values(STAY_VALIDATION_RULE_IDS).sort();
  if (
    JSON.stringify(receiptRuleIds) !== JSON.stringify(requiredRuleIds) ||
    (validation.eligibility === 'ELIGIBLE' &&
      (nonPassReceipts.length > 0 || candidate.exclusionReasons.length > 0)) ||
    (validation.eligibility !== 'ELIGIBLE' &&
      (nonPassReceipts.length === 0 || candidate.exclusionReasons.length === 0))
  ) {
    throw new CandidatePoolBuildError(
      'INVALID_VALIDATION_RESULT',
      `${candidate.candidateId}의 영수증과 eligibility가 일치하지 않습니다.`,
    );
  }
  if (validation.receipts.some((receipt) => receipt.proposalId !== validation.proposalId)) {
    throw new CandidatePoolBuildError(
      'INVALID_VALIDATION_RESULT',
      `${candidate.candidateId}의 receipt proposalId가 검증 대상과 다릅니다.`,
    );
  }
}

export function buildCandidatePoolVersion(
  rawInput: CandidatePoolBuildInput,
): CandidatePoolBuildResult {
  const charter = tripCharterSchema.parse(rawInput.charter);
  const knownBriefIds = validateBriefAuthority(
    charter,
    rawInput.representativeBriefIdByParticipantId,
    rawInput.neutralBriefIds,
  );
  const validations = [...rawInput.validations].sort(byCandidateId);
  const candidateIds = validations.map((validation) => validation.candidate.candidateId);
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new CandidatePoolBuildError('DUPLICATE_CANDIDATE_ID', 'candidateId는 Pool 안에서 중복될 수 없습니다.');
  }
  for (const validation of validations) {
    assertValidationIntegrity(validation);
    const unknownBriefIds = validation.candidate.sourceBriefIds.filter(
      (briefId) => !knownBriefIds.has(briefId),
    );
    if (unknownBriefIds.length > 0) {
      throw new CandidatePoolBuildError(
        'UNKNOWN_SOURCE_BRIEF',
        `${validation.candidate.candidateId}에 알 수 없는 sourceBriefId가 있습니다: ${unknownBriefIds.join(',')}`,
      );
    }
  }

  const eligible = validations.filter((validation) => validation.eligibility === 'ELIGIBLE');
  const unverified = validations.filter((validation) => validation.eligibility === 'UNVERIFIED');
  const blocked = validations.filter((validation) => validation.eligibility === 'BLOCKED');
  if (eligible.length === 0) {
    throw new CandidatePoolBuildError('NO_ELIGIBLE_CANDIDATE', '검증을 통과한 후보가 없습니다.');
  }

  const representativeCandidateByParticipantId: Record<string, string> = {};
  for (const participantId of charter.participantIds) {
    const briefId = rawInput.representativeBriefIdByParticipantId[participantId];
    if (briefId === undefined) {
      throw new CandidatePoolBuildError(
        'INVALID_VALIDATION_RESULT',
        `${participantId}의 대표 Brief가 없습니다.`,
      );
    }
    const representative = eligible.find(
      (validation) => validation.candidate.sourceBriefIds.includes(briefId),
    );
    if (representative === undefined) {
      throw new CandidatePoolBuildError(
        'MISSING_ELIGIBLE_REPRESENTATIVE',
        `${participantId}의 ELIGIBLE 대표 후보가 없습니다. CandidateGapRequest가 필요합니다.`,
      );
    }
    representativeCandidateByParticipantId[participantId] = representative.candidate.candidateId;
  }

  const neutralBriefIds = new Set(rawInput.neutralBriefIds);
  const neutralCandidateIds = eligible
    .filter((validation) =>
      validation.candidate.sourceBriefIds.some((briefId) => neutralBriefIds.has(briefId)),
    )
    .map((validation) => validation.candidate.candidateId);
  if (neutralCandidateIds.length === 0) {
    throw new CandidatePoolBuildError(
      'MISSING_ELIGIBLE_NEUTRAL_CANDIDATE',
      '중립 Brief 계보를 가진 ELIGIBLE 후보가 없습니다. CandidateGapRequest가 필요합니다.',
    );
  }

  const excludedCandidates = [...unverified, ...blocked]
    .sort(byCandidateId)
    .map((validation) => ({
      candidateId: validation.candidate.candidateId,
      reasons: [...validation.candidate.exclusionReasons],
    }));
  const pool = candidatePoolVersionSchema.parse({
    schemaVersion: 1,
    poolId: rawInput.poolId,
    category: 'stay',
    version: rawInput.version,
    candidateIds: eligible.map((validation) => validation.candidate.candidateId),
    representativeCandidateByParticipantId,
    neutralCandidateIds,
    excludedCandidates,
    createdAt: rawInput.createdAt,
  });
  return {
    pool,
    eligibleCandidates: eligible.map((validation) => validation.candidate),
    unverifiedCandidates: unverified.map((validation) => validation.candidate),
    blockedCandidates: blocked.map((validation) => validation.candidate),
  };
}
