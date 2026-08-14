import {
  candidatePoolVersionSchema,
  categoryProposalSchema,
  categoryProposalSetSchema,
  type CandidatePoolVersion,
  type CategoryProposal,
  type CategoryProposalSet,
} from '@tm/contracts';
import {
  STAY_VALIDATION_RULE_IDS,
  type StayCandidateValidationResult,
} from './fact-constraint-validator.js';

export type CategoryProposalBuildErrorCode =
  | 'INVALID_PROPOSAL_VERSION'
  | 'CANDIDATE_NOT_ELIGIBLE'
  | 'PROPOSAL_ID_MISMATCH'
  | 'POOL_VALIDATION_MISMATCH';

export class CategoryProposalBuildError extends Error {
  constructor(
    readonly code: CategoryProposalBuildErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CategoryProposalBuildError';
  }
}

export interface CategoryProposalSetBuildInput {
  readonly proposalSetId: string;
  readonly proposalSetVersion: number;
  readonly pool: CandidatePoolVersion;
  readonly validations: readonly StayCandidateValidationResult[];
  readonly sealedAt: string;
}

function sortedRecord(values: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function stayProposalId(candidateId: string, proposalSetVersion: number): string {
  if (candidateId.trim().length === 0 || !Number.isInteger(proposalSetVersion) || proposalSetVersion < 1) {
    throw new CategoryProposalBuildError(
      'INVALID_PROPOSAL_VERSION',
      'candidateId와 양의 proposalSetVersion이 필요합니다.',
    );
  }
  return `proposal:stay:${candidateId}:v${proposalSetVersion}`;
}

export function buildStayCategoryProposal(
  validation: StayCandidateValidationResult,
  proposalSetVersion: number,
): CategoryProposal {
  if (!Number.isInteger(proposalSetVersion) || proposalSetVersion < 1) {
    throw new CategoryProposalBuildError('INVALID_PROPOSAL_VERSION', 'proposalSetVersion은 양의 정수여야 합니다.');
  }
  if (
    validation.eligibility !== 'ELIGIBLE' ||
    validation.candidate.poolEligibility !== 'ELIGIBLE' ||
    validation.receipts.some((receipt) => receipt.status !== 'PASS') ||
    JSON.stringify(validation.receipts.map((receipt) => receipt.ruleId).sort()) !==
      JSON.stringify(Object.values(STAY_VALIDATION_RULE_IDS).sort())
  ) {
    throw new CategoryProposalBuildError(
      'CANDIDATE_NOT_ELIGIBLE',
      `${validation.candidate.candidateId}는 active proposal로 승격할 수 없습니다.`,
    );
  }
  const expectedProposalId = stayProposalId(validation.candidate.candidateId, proposalSetVersion);
  if (
    validation.proposalId !== expectedProposalId ||
    validation.receipts.some((receipt) => receipt.proposalId !== expectedProposalId)
  ) {
    throw new CategoryProposalBuildError(
      'PROPOSAL_ID_MISMATCH',
      `${validation.candidate.candidateId}의 검증 영수증과 proposal version이 다릅니다.`,
    );
  }
  const costByParticipantKrw = sortedRecord(validation.costByParticipantKrw);
  const summedCost = Object.values(costByParticipantKrw).reduce((sum, cost) => sum + cost, 0);
  if (summedCost !== validation.totalCostKrw) {
    throw new CategoryProposalBuildError(
      'POOL_VALIDATION_MISMATCH',
      `${validation.candidate.candidateId}의 참여자별 비용 합계가 총비용과 다릅니다.`,
    );
  }
  return categoryProposalSchema.parse({
    schemaVersion: 1,
    proposalId: expectedProposalId,
    category: 'stay',
    proposalSetVersion,
    summary: validation.candidate.title,
    candidateIds: [validation.candidate.candidateId],
    costByParticipantKrw,
    capacityPlan: validation.capacityPlan,
    violatedConstraintIds: [],
    evidenceIds: uniqueSorted(validation.candidate.evidenceIds),
    attributesBp: sortedRecord(validation.attributesBp),
    concessionByParticipantBp: Object.fromEntries(
      Object.keys(costByParticipantKrw).map((participantId) => [participantId, 0]),
    ),
    totalCostKrw: validation.totalCostKrw,
    travelBurdenMinutes: validation.travelBurdenMinutes,
    cancellationScoreBp: validation.cancellationScoreBp,
    evidenceQualityBp: validation.evidenceQualityBp,
  });
}

export function buildStayCategoryProposalSet(
  input: CategoryProposalSetBuildInput,
): CategoryProposalSet {
  const pool = candidatePoolVersionSchema.parse(input.pool);
  if (pool.category !== 'stay') {
    throw new CategoryProposalBuildError('POOL_VALIDATION_MISMATCH', 'stay pool만 숙소 proposal로 승격할 수 있습니다.');
  }
  const validationByCandidateId = new Map<string, StayCandidateValidationResult>();
  for (const validation of input.validations) {
    if (validationByCandidateId.has(validation.candidate.candidateId)) {
      throw new CategoryProposalBuildError(
        'POOL_VALIDATION_MISMATCH',
        `중복 validation candidateId: ${validation.candidate.candidateId}`,
      );
    }
    validationByCandidateId.set(validation.candidate.candidateId, validation);
  }
  const activeIds = uniqueSorted(pool.candidateIds);
  const eligibleValidationIds = uniqueSorted(
    input.validations
      .filter((validation) => validation.eligibility === 'ELIGIBLE')
      .map((validation) => validation.candidate.candidateId),
  );
  if (
    activeIds.length !== pool.candidateIds.length ||
    JSON.stringify(activeIds) !== JSON.stringify(eligibleValidationIds)
  ) {
    throw new CategoryProposalBuildError(
      'POOL_VALIDATION_MISMATCH',
      'active pool 후보와 ELIGIBLE validation 집합이 정확히 일치해야 합니다.',
    );
  }
  const proposals = activeIds.map((candidateId) => {
    const validation = validationByCandidateId.get(candidateId);
    if (validation === undefined) {
      throw new CategoryProposalBuildError(
        'POOL_VALIDATION_MISMATCH',
        `${candidateId}의 validation이 없습니다.`,
      );
    }
    return buildStayCategoryProposal(validation, input.proposalSetVersion);
  });
  return categoryProposalSetSchema.parse({
    schemaVersion: 1,
    proposalSetId: input.proposalSetId,
    category: 'stay',
    proposalSetVersion: input.proposalSetVersion,
    candidatePoolVersion: pool.version,
    proposals,
    sealedAt: input.sealedAt,
  });
}
