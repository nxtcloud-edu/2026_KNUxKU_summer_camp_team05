import {
  candidateSearchInputSchema,
  candidateSearchOutputSchema,
  mvpConfirmedProfileSchema,
  mvpGuardCheckSchema,
  mvpStaySelectionSchema,
  mvpUserProxyProfileViewSchema,
  type CandidateSearchInput,
  type CandidateSearchOutput,
  type MvpConfirmedProfile,
  type MvpEvidenceRef,
  type MvpGuardCheck,
  type MvpProposalEvaluation,
  type MvpProxyBallot,
  type MvpStayCandidate,
  type MvpStaySelection,
  type MvpUserProxyProfileView,
} from '@tm/contracts';

const FORBIDDEN_AGENT_CONTEXT_KEYS = new Set([
  'credentials',
  'credential',
  'auth',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'providerraw',
  'rawproviderresponse',
  'rawsurvey',
  'allergiesraw',
  'healthdetails',
  'databaseurl',
]);

export class MvpPrivacyBoundaryError extends Error {
  constructor(readonly fieldPath: string) {
    super(`Agent context에 금지된 필드가 포함되었습니다: ${fieldPath}`);
    this.name = 'MvpPrivacyBoundaryError';
  }
}

function normalizedKey(value: string): string {
  return value.replaceAll('_', '').replaceAll('-', '').toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertMvpAgentContextSafe(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertMvpAgentContextSafe(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_AGENT_CONTEXT_KEYS.has(normalizedKey(key))) {
      throw new MvpPrivacyBoundaryError(childPath);
    }
    assertMvpAgentContextSafe(child, childPath);
  }
}

export function projectMvpUserProxyProfile(
  source: unknown,
  participantId: string,
): MvpUserProxyProfileView {
  if (!isRecord(source) || !isRecord(source['profiles'])) {
    throw new Error('confirmed profile source에 profiles가 필요합니다.');
  }
  const rawProfile = source['profiles'][participantId];
  const profile = mvpConfirmedProfileSchema.parse(rawProfile);
  if (profile.participantId !== participantId) {
    throw new Error('요청한 participantId와 profile 소유자가 일치하지 않습니다.');
  }
  const projected = mvpUserProxyProfileViewSchema.parse({
    participantId: profile.participantId,
    confirmedFactIds: [...profile.confirmedFactIds],
    preferences: profile.preferences.map((preference) => ({ ...preference })),
    hardConstraints: profile.hardConstraints.map((constraint) => ({ ...constraint })),
    protectedObjectives: profile.protectedObjectives.map((objective) => ({ ...objective })),
    budgetMaxKrw: profile.budgetMaxKrw,
  });
  assertMvpAgentContextSafe(projected);
  return projected;
}

function noSafeQuery(warning: string): CandidateSearchOutput {
  return candidateSearchOutputSchema.parse({
    status: 'NO_SAFE_QUERY',
    queryPlans: [],
    warning,
  });
}

export function planMvpCandidateSearch(rawInput: CandidateSearchInput): CandidateSearchOutput {
  const input = candidateSearchInputSchema.parse(rawInput);
  const allowed = new Set(input.allowedRelaxationIds);
  const protectedIds = new Set([
    ...input.canonicalConstraints.hardConstraintIds,
    ...input.canonicalConstraints.protectedObjectiveIds,
  ]);
  const unapproved = input.requestedRelaxationIds.filter((id) => !allowed.has(id));
  if (unapproved.length > 0) {
    return noSafeQuery(`승인되지 않은 완화 요청: ${unapproved.sort().join(', ')}`);
  }
  const protectedRelaxations = input.requestedRelaxationIds.filter((id) => protectedIds.has(id));
  if (protectedRelaxations.length > 0) {
    return noSafeQuery(`완화할 수 없는 안전·보호 조건: ${protectedRelaxations.sort().join(', ')}`);
  }
  const keywords = [...new Set(input.unresolvedTerms.map((term) => term.trim()).filter(Boolean))];
  if (keywords.length === 0) {
    return noSafeQuery('검색어를 만들 확인된 조건이 없습니다.');
  }
  return candidateSearchOutputSchema.parse({
    status: 'QUERY_PLAN_PROPOSED',
    queryPlans: [
      {
        queryId: `${input.runId}:stay:query:1`,
        keywords,
        filters: input.canonicalConstraints.filters,
        relaxationChanges: [...input.requestedRelaxationIds].sort(),
        rationale: `${input.shortageReason} 상태에서 확인된 stay 조건만 사용합니다.`,
      },
    ],
    warning: null,
  });
}

export function evaluateMvpStayProposal(
  profile: MvpConfirmedProfile,
  proposal: MvpStayCandidate,
): MvpProposalEvaluation {
  const totalWeight = profile.preferences.reduce((sum, preference) => sum + preference.weightBp, 0);
  const satisfactionBp =
    totalWeight === 0
      ? 5_000
      : Math.round(
          profile.preferences.reduce(
            (sum, preference) =>
              sum +
              preference.weightBp * (proposal.attributesBp[preference.preferenceId] ?? 0),
            0,
          ) / totalWeight,
        );
  return {
    proposalId: proposal.proposalId,
    satisfactionBp,
    profileFactIds: profile.preferences.map((preference) => preference.factId),
    evidenceIds: [...proposal.evidenceIds],
  };
}

export function selectMvpStayProposal(
  ballots: readonly MvpProxyBallot[],
  eligibleProposalIds: readonly string[],
): MvpStaySelection {
  if (ballots.length === 0 || eligibleProposalIds.length === 0) {
    throw new Error('결정론 선택에는 ballot과 eligible proposal이 필요합니다.');
  }
  const scored = [...new Set(eligibleProposalIds)].map((proposalId) => {
    const values = ballots.map((ballot) => {
      const value = ballot.satisfactionByProposalBp[proposalId];
      if (value === undefined) {
        throw new Error(`${ballot.participantId} ballot에 ${proposalId} 만족도가 없습니다.`);
      }
      return value;
    });
    return {
      proposalId,
      min: Math.min(...values),
      total: values.reduce((sum, value) => sum + value, 0),
    };
  });
  scored.sort((left, right) => {
    if (left.min !== right.min) return right.min - left.min;
    if (left.total !== right.total) return right.total - left.total;
    return left.proposalId.localeCompare(right.proposalId);
  });
  const winner = scored[0];
  if (winner === undefined) throw new Error('선택 가능한 stay proposal이 없습니다.');
  const runnerUp = scored[1];
  const decidedBy =
    runnerUp === undefined || winner.min !== runnerUp.min
      ? 'MAXIMIN'
      : winner.total !== runnerUp.total
        ? 'TOTAL'
        : 'PROPOSAL_ID';
  return mvpStaySelectionSchema.parse({
    selectedProposalId: winner.proposalId,
    rankedProposalIds: scored.map((candidate) => candidate.proposalId),
    minSatisfactionBp: winner.min,
    totalSatisfactionBp: winner.total,
    decidedBy,
  });
}

export interface MvpGuardCheckInput {
  arbiterSelectedProposalId: string | null;
  deterministicSelection: MvpStaySelection;
  selectedProposal: MvpStayCandidate;
  profiles: readonly MvpConfirmedProfile[];
  participantCount: number;
  evidence: readonly MvpEvidenceRef[];
}

export function buildMvpGuardChecks(input: MvpGuardCheckInput): MvpGuardCheck[] {
  const protectedIds = new Set(
    input.profiles.flatMap((profile) => [
      ...profile.hardConstraints.map((constraint) => constraint.constraintId),
      ...profile.protectedObjectives.map((objective) => objective.constraintId),
    ]),
  );
  const evidenceById = new Map(input.evidence.map((item) => [item.evidenceId, item]));
  const checks: MvpGuardCheck[] = [
    {
      code: 'ARBITER_ALIGNED',
      passed: input.arbiterSelectedProposalId === input.deterministicSelection.selectedProposalId,
      message: 'Stay Arbiter 결과가 결정론 선택과 일치해야 합니다.',
      evidenceIds: [],
    },
    {
      code: 'CAPACITY_VALID',
      passed: input.selectedProposal.capacity >= input.participantCount,
      message: '숙소 수용 인원이 참여자 수 이상이어야 합니다.',
      evidenceIds: [...input.selectedProposal.evidenceIds],
    },
    {
      code: 'BUDGET_VALID',
      passed: input.profiles.every(
        (profile) => input.selectedProposal.costPerPersonKrw <= profile.budgetMaxKrw,
      ),
      message: '1인 숙소 비용이 모든 참여자의 확정 예산 이하여야 합니다.',
      evidenceIds: [...input.selectedProposal.evidenceIds],
    },
    {
      code: 'CONSTRAINTS_VALID',
      passed: input.selectedProposal.violatedConstraintIds.every((id) => !protectedIds.has(id)),
      message: '하드 조건과 보호 목표를 위반한 숙소는 확정할 수 없습니다.',
      evidenceIds: [...input.selectedProposal.evidenceIds],
    },
    {
      code: 'EVIDENCE_VERIFIED',
      passed: input.selectedProposal.evidenceIds.every(
        (id) => evidenceById.get(id)?.status === 'VERIFIED',
      ),
      message: '선택된 숙소의 근거가 모두 검증되어야 합니다.',
      evidenceIds: [...input.selectedProposal.evidenceIds],
    },
  ];
  return checks.map((check) => mvpGuardCheckSchema.parse(check));
}
