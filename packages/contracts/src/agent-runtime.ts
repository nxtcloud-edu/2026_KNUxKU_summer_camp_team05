import { z } from 'zod';
import { queryClasses } from './data-agent.js';

const identifierSchema = z.string().min(1);
const basisPointsSchema = z.number().int().min(0).max(10_000);
const nonNegativeKrwSchema = z.number().int().nonnegative();
const isoDateTimeSchema = z.string().datetime();

export const agentCategories = [
  'long_distance',
  'stay',
  'activity',
  'dining',
  'schedule',
] as const;
export const agentCategorySchema = z.enum(agentCategories);

export const agentRoles = [
  'USER_PROXY',
  'CANDIDATE_EVIDENCE',
  'CATEGORY_ARBITER',
  'TRIP_ORCHESTRATOR',
  'PLAN_FINALIZER',
] as const;
export const agentRoleSchema = z.enum(agentRoles);

export const finalPlanStatuses = [
  'PROVISIONAL',
  'VERIFIED',
  'NEEDS_USER_CHOICE',
  'BLOCKED',
] as const;
export const finalPlanStatusSchema = z.enum(finalPlanStatuses);

export const verificationStatusSchema = z.enum([
  'PASS',
  'FAIL',
  'UNKNOWN',
  'STALE',
  'CONTRADICTED',
]);

export const agentProfileFactSchema = z
  .object({
    factId: identifierSchema,
    statement: z.string().min(1),
    importance: z.union([z.literal(1), z.literal(3), z.literal(5)]),
    hard: z.boolean(),
    polarity: z.enum(['REQUIRE', 'AVOID', 'PREFER']),
  })
  .strict();

export const userProxyProfileViewSchema = z
  .object({
    participantId: identifierSchema,
    profileVersion: identifierSchema,
    facts: z.array(agentProfileFactSchema),
    budgetMaxKrw: nonNegativeKrwSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const factIds = value.facts.map((fact) => fact.factId);
    if (new Set(factIds).size !== factIds.length) {
      context.addIssue({ code: 'custom', message: 'profile factId는 중복될 수 없습니다.' });
    }
  });

export const tripCharterSchema = z
  .object({
    schemaVersion: z.literal(1),
    charterVersion: identifierSchema,
    destination: z.string().min(1),
    startDate: z.string().date(),
    endDate: z.string().date(),
    participantIds: z.array(identifierSchema).min(1),
    partySize: z.number().int().positive(),
    pace: z.string().min(1),
    budgetMaxByParticipantKrw: z.record(nonNegativeKrwSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.participantIds).size !== value.participantIds.length) {
      context.addIssue({ code: 'custom', message: 'TripCharter participantId는 중복될 수 없습니다.' });
    }
    if (value.partySize !== value.participantIds.length) {
      context.addIssue({ code: 'custom', message: 'partySize는 participantIds 수와 같아야 합니다.' });
    }
    const budgetIds = Object.keys(value.budgetMaxByParticipantKrw).sort();
    const participantIds = [...value.participantIds].sort();
    if (JSON.stringify(budgetIds) !== JSON.stringify(participantIds)) {
      context.addIssue({
        code: 'custom',
        message: '모든 참가자에게 정확히 하나의 예산 상한이 필요합니다.',
      });
    }
    if (value.startDate >= value.endDate) {
      context.addIssue({ code: 'custom', message: 'endDate는 startDate보다 뒤여야 합니다.' });
    }
  });

export const proxySearchBriefSchema = z
  .object({
    schemaVersion: z.literal(1),
    briefId: identifierSchema,
    participantId: identifierSchema,
    category: agentCategorySchema,
    profileVersion: identifierSchema,
    mustKeepRefs: z.array(identifierSchema),
    preferenceTargetRefs: z.array(identifierSchema),
    desiredTraits: z.array(z.string().min(1)),
    avoidTraits: z.array(z.string().min(1)),
    tradeoffs: z.array(z.string().min(1)),
    searchTerms: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const neutralSearchBriefSchema = z
  .object({
    schemaVersion: z.literal(1),
    briefId: identifierSchema,
    category: agentCategorySchema,
    charterVersion: identifierSchema,
    hardConstraintRefs: z.array(identifierSchema),
    searchTerms: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const candidateEvidenceQueryPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    queryPlanId: identifierSchema,
    category: agentCategorySchema,
    sourceBriefIds: z.array(identifierSchema).min(1),
    queryClass: z.enum(queryClasses),
    providerOrder: z.array(identifierSchema).min(1),
    searchTerms: z.array(z.string().min(1)).min(1),
    params: z.record(z.unknown()),
    relaxationChanges: z.array(identifierSchema),
    rationale: z.string().min(1),
  })
  .strict();

export const evidenceSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    evidenceId: identifierSchema,
    queryPlanId: identifierSchema,
    providerId: identifierSchema,
    providerCandidateId: identifierSchema.nullable(),
    sourceUrl: z.string().url().nullable(),
    retrievedAt: isoDateTimeSchema,
    validUntil: isoDateTimeSchema.nullable(),
    confidence: z.enum(['unknown', 'estimated', 'live']),
    status: verificationStatusSchema,
    termsRef: z.string().min(1),
    fieldStates: z.record(verificationStatusSchema),
  })
  .strict();

export const candidateRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    candidateId: identifierSchema,
    category: agentCategorySchema,
    sourceBriefIds: z.array(identifierSchema).min(1),
    providerId: identifierSchema,
    providerCandidateId: identifierSchema,
    title: z.string().min(1),
    sourceMode: z.enum(['fixture', 'unknown', 'estimated', 'live']),
    poolEligibility: z.enum(['ELIGIBLE', 'UNVERIFIED', 'BLOCKED']),
    exclusionReasons: z.array(z.string().min(1)),
    evidenceIds: z.array(identifierSchema).min(1),
    payload: z.record(z.unknown()),
  })
  .strict();

export const candidatePoolVersionSchema = z
  .object({
    schemaVersion: z.literal(1),
    poolId: identifierSchema,
    category: agentCategorySchema,
    version: z.number().int().positive(),
    candidateIds: z.array(identifierSchema),
    representativeCandidateByParticipantId: z.record(identifierSchema),
    neutralCandidateIds: z.array(identifierSchema),
    excludedCandidates: z.array(
      z
        .object({ candidateId: identifierSchema, reasons: z.array(z.string().min(1)).min(1) })
        .strict(),
    ),
    createdAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const candidateIds = new Set(value.candidateIds);
    for (const candidateId of Object.values(value.representativeCandidateByParticipantId)) {
      if (!candidateIds.has(candidateId)) {
        context.addIssue({
          code: 'custom',
          message: '대표 후보는 활성 candidateIds에 포함되어야 합니다.',
        });
      }
    }
    for (const candidateId of value.neutralCandidateIds) {
      if (!candidateIds.has(candidateId)) {
        context.addIssue({
          code: 'custom',
          message: '중립 후보는 활성 candidateIds에 포함되어야 합니다.',
        });
      }
    }
  });

export const capacityAllocationSchema = z
  .object({
    resourceUnitId: identifierSchema,
    confirmedCapacity: z.number().int().nonnegative(),
    assignedParticipantIds: z.array(identifierSchema),
  })
  .strict();

export const capacityPlanSchema = z
  .object({
    requestedPartySize: z.number().int().positive(),
    confirmedCapacity: z.number().int().nonnegative(),
    allocations: z.array(capacityAllocationSchema),
    unassignedParticipantIds: z.array(identifierSchema),
    evidenceIds: z.array(identifierSchema),
    splitAuthorityRef: identifierSchema.nullable(),
  })
  .strict();

export const categoryProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    proposalId: identifierSchema,
    category: agentCategorySchema,
    proposalSetVersion: z.number().int().positive(),
    summary: z.string().min(1),
    candidateIds: z.array(identifierSchema).min(1),
    costByParticipantKrw: z.record(nonNegativeKrwSchema),
    capacityPlan: capacityPlanSchema,
    violatedConstraintIds: z.array(identifierSchema),
    evidenceIds: z.array(identifierSchema).min(1),
    attributesBp: z.record(basisPointsSchema),
    concessionByParticipantBp: z.record(basisPointsSchema),
    totalCostKrw: nonNegativeKrwSchema,
    travelBurdenMinutes: z.number().int().nonnegative(),
    cancellationScoreBp: basisPointsSchema,
    evidenceQualityBp: basisPointsSchema,
  })
  .strict();

export const categoryProposalSetSchema = z
  .object({
    schemaVersion: z.literal(1),
    proposalSetId: identifierSchema,
    category: agentCategorySchema,
    proposalSetVersion: z.number().int().positive(),
    candidatePoolVersion: z.number().int().positive(),
    proposals: z.array(categoryProposalSchema).min(1),
    sealedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const proposalIds = value.proposals.map((proposal) => proposal.proposalId);
    if (new Set(proposalIds).size !== proposalIds.length) {
      context.addIssue({ code: 'custom', message: 'proposalId는 중복될 수 없습니다.' });
    }
    for (const proposal of value.proposals) {
      if (
        proposal.category !== value.category ||
        proposal.proposalSetVersion !== value.proposalSetVersion
      ) {
        context.addIssue({
          code: 'custom',
          message: '모든 Proposal은 같은 category와 proposalSetVersion을 사용해야 합니다.',
        });
      }
    }
  });

export const evidenceChallengeSchema = z
  .object({
    schemaVersion: z.literal(1),
    challengeId: identifierSchema,
    participantId: identifierSchema,
    proposalId: identifierSchema,
    factType: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

export const candidateGapRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: identifierSchema,
    participantId: identifierSchema,
    category: agentCategorySchema,
    missingPreferenceRefs: z.array(identifierSchema).min(1),
    reason: z.string().min(1),
    suggestedSearchTerms: z.array(z.string().min(1)),
  })
  .strict();

export const proposalEvaluationSchema = z
  .object({
    proposalId: identifierSchema,
    satisfactionBp: basisPointsSchema,
    stance: z.enum(['support', 'conditional', 'oppose']),
    profileFactRefs: z.array(identifierSchema),
    evidenceIds: z.array(identifierSchema),
    conditionalTerms: z.array(z.string().min(1)),
  })
  .strict();

export const proxyBallotSchema = z
  .object({
    schemaVersion: z.literal(1),
    ballotId: identifierSchema,
    participantId: identifierSchema,
    category: agentCategorySchema,
    proposalSetVersion: z.number().int().positive(),
    rankedProposalIds: z.array(identifierSchema).min(1),
    satisfactionByProposalBp: z.record(basisPointsSchema),
    stanceByProposal: z.record(z.enum(['support', 'conditional', 'oppose'])),
    profileFactRefs: z.array(identifierSchema),
    conditionalTerms: z.array(z.string().min(1)),
    rationale: z.string().min(1),
    evidenceChallenges: z.array(evidenceChallengeSchema),
    candidateGapRequest: candidateGapRequestSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const ranked = value.rankedProposalIds;
    if (new Set(ranked).size !== ranked.length) {
      context.addIssue({ code: 'custom', message: 'Ballot 순위에 중복 Proposal이 있습니다.' });
    }
    const expected = [...ranked].sort();
    for (const actual of [
      Object.keys(value.satisfactionByProposalBp).sort(),
      Object.keys(value.stanceByProposal).sort(),
    ]) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        context.addIssue({
          code: 'custom',
          message: 'Ballot은 동일 Proposal 전체의 순위·만족도·입장을 포함해야 합니다.',
        });
      }
    }
  });

export const deterministicSelectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    selectedProposalId: identifierSchema,
    rankedProposalIds: z.array(identifierSchema).min(1),
    satisfactionVectorByProposal: z.record(z.array(basisPointsSchema).min(1)),
    decidedBy: z.enum([
      'LEXIMIN',
      'AVERAGE',
      'CONCESSION_IMBALANCE',
      'TOTAL_COST',
      'TRAVEL_BURDEN',
      'CANCELLATION',
      'EVIDENCE_QUALITY',
      'PROPOSAL_ID',
    ]),
    trace: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const verificationReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    receiptId: identifierSchema,
    proposalId: identifierSchema,
    ruleId: identifierSchema,
    status: verificationStatusSchema,
    evidenceIds: z.array(identifierSchema),
    explanation: z.string().min(1),
  })
  .strict();

export const categoryDecisionContractSchema = z
  .object({
    schemaVersion: z.literal(1),
    contractId: identifierSchema,
    contractVersion: z.number().int().positive(),
    category: agentCategorySchema,
    charterVersion: identifierSchema,
    proposalSetVersion: z.number().int().positive(),
    outcome: z.enum(['CONCLUDED', 'CONTINUE', 'NO_SAFE_DECISION']),
    selectedProposalId: identifierSchema.nullable(),
    deterministicSelectedProposalId: identifierSchema.nullable(),
    rejectedProposalIds: z.array(identifierSchema),
    ballotIds: z.array(identifierSchema),
    summary: z.string().min(1),
    unresolvedIssues: z.array(z.string().min(1)),
    obligationsForNextCategory: z.array(z.string().min(1)),
    blockReason: z.string().min(1).nullable(),
    evidenceIds: z.array(identifierSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.outcome === 'CONCLUDED') {
      if (
        value.selectedProposalId === null ||
        value.selectedProposalId !== value.deterministicSelectedProposalId
      ) {
        context.addIssue({
          code: 'custom',
          message: 'CONCLUDED 계약은 결정론 선택을 변경 없이 보존해야 합니다.',
        });
      }
    } else if (value.selectedProposalId !== null) {
      context.addIssue({
        code: 'custom',
        message: 'CONCLUDED가 아닌 계약은 Proposal을 선택할 수 없습니다.',
      });
    }
    if (value.outcome === 'NO_SAFE_DECISION' && value.blockReason === null) {
      context.addIssue({ code: 'custom', message: 'NO_SAFE_DECISION에는 blockReason이 필요합니다.' });
    }
  });

export const orchestratorGuardCheckSchema = z
  .object({
    code: identifierSchema,
    passed: z.boolean(),
    message: z.string().min(1),
    refs: z.array(identifierSchema),
  })
  .strict();

export const tripOrchestratorFindingSchema = z
  .object({
    code: identifierSchema,
    severity: z.enum(['info', 'warning', 'error']),
    message: z.string().min(1),
    refs: z.array(identifierSchema),
  })
  .strict();

export const tripOrchestratorReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    reportId: identifierSchema,
    guardStatus: z.enum(['CLEAR', 'RECHECK', 'HOLD']),
    observedContractIds: z.array(identifierSchema),
    findings: z.array(tripOrchestratorFindingSchema),
    recheckTargets: z.array(identifierSchema),
    summary: z.string().min(1),
    evidenceIds: z.array(identifierSchema),
  })
  .strict();

export const finalPlanRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    finalPlanId: identifierSchema,
    finalPlanVersion: z.number().int().positive(),
    tripId: identifierSchema,
    status: finalPlanStatusSchema,
    evidenceMode: z.enum(['LIVE', 'MIXED', 'FIXTURE']),
    categoryDecisionContractIds: z.array(identifierSchema),
    orchestratorReportId: identifierSchema,
    evidenceIds: z.array(identifierSchema),
    unresolvedIssues: z.array(z.string().min(1)),
    summary: z.string().min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.evidenceMode !== 'LIVE' && value.status === 'VERIFIED') {
      context.addIssue({
        code: 'custom',
        message: 'fixture 또는 혼합 근거는 VERIFIED 최종 상태를 만들 수 없습니다.',
      });
    }
    if (value.status === 'VERIFIED' && value.unresolvedIssues.length > 0) {
      context.addIssue({
        code: 'custom',
        message: '미해결 항목이 있는 최종 계획은 VERIFIED가 될 수 없습니다.',
      });
    }
    if (value.status === 'VERIFIED' && value.evidenceIds.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'VERIFIED 최종 계획에는 검증 근거가 필요합니다.',
      });
    }
  });

const agentEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  runId: identifierSchema,
  tripId: identifierSchema,
  inputVersion: z.number().int().nonnegative(),
});

export const userProxySearchBriefRequestSchema = agentEnvelopeSchema
  .extend({
    role: z.literal('USER_PROXY'),
    task: z.literal('CREATE_SEARCH_BRIEF'),
    category: agentCategorySchema,
    participant: userProxyProfileViewSchema,
    charter: tripCharterSchema,
    priorContractRefs: z.array(identifierSchema),
  })
  .strict();

export const userProxySearchBriefResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    role: z.literal('USER_PROXY'),
    task: z.literal('CREATE_SEARCH_BRIEF'),
    brief: proxySearchBriefSchema,
  })
  .strict();

export const userProxyBallotRequestSchema = agentEnvelopeSchema
  .extend({
    role: z.literal('USER_PROXY'),
    task: z.literal('CREATE_BALLOT'),
    category: agentCategorySchema,
    participant: userProxyProfileViewSchema,
    proposalSet: categoryProposalSetSchema,
    evaluations: z.array(proposalEvaluationSchema).min(1),
    evidence: z.array(evidenceSnapshotSchema),
  })
  .strict();

export const userProxyBallotResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    role: z.literal('USER_PROXY'),
    task: z.literal('CREATE_BALLOT'),
    ballot: proxyBallotSchema,
  })
  .strict();

export const candidateEvidenceRequestSchema = agentEnvelopeSchema
  .extend({
    role: z.literal('CANDIDATE_EVIDENCE'),
    category: agentCategorySchema,
    briefs: z.array(proxySearchBriefSchema).min(1),
    neutralBrief: neutralSearchBriefSchema,
    availableProviderIds: z.array(identifierSchema).min(1),
    searchAttempt: z.number().int().min(0).max(1),
    currentCandidateIds: z.array(identifierSchema),
  })
  .strict();

export const candidateEvidenceResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    role: z.literal('CANDIDATE_EVIDENCE'),
    status: z.enum(['QUERY_PLAN_PROPOSED', 'NO_SAFE_QUERY']),
    queryPlans: z.array(candidateEvidenceQueryPlanSchema),
    warning: z.string().min(1).nullable(),
  })
  .strict();

export const categoryArbiterRequestSchema = agentEnvelopeSchema
  .extend({
    role: z.literal('CATEGORY_ARBITER'),
    category: agentCategorySchema,
    charter: tripCharterSchema,
    proposalSet: categoryProposalSetSchema,
    ballots: z.array(proxyBallotSchema).min(1),
    deterministicSelection: deterministicSelectionSchema,
    receipts: z.array(verificationReceiptSchema),
    priorObligations: z.array(z.string().min(1)),
  })
  .strict();

export const categoryArbiterResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    role: z.literal('CATEGORY_ARBITER'),
    contract: categoryDecisionContractSchema,
  })
  .strict();

export const tripOrchestratorRequestSchema = agentEnvelopeSchema
  .extend({
    role: z.literal('TRIP_ORCHESTRATOR'),
    charter: tripCharterSchema,
    categoryContracts: z.array(categoryDecisionContractSchema).min(1),
    guardChecks: z.array(orchestratorGuardCheckSchema).min(1),
    evidence: z.array(evidenceSnapshotSchema),
  })
  .strict();

export const tripOrchestratorResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    role: z.literal('TRIP_ORCHESTRATOR'),
    report: tripOrchestratorReportSchema,
  })
  .strict();

export const planFinalizerRequestSchema = agentEnvelopeSchema
  .extend({
    role: z.literal('PLAN_FINALIZER'),
    charter: tripCharterSchema,
    categoryContracts: z.array(categoryDecisionContractSchema).min(1),
    orchestratorReport: tripOrchestratorReportSchema,
    evidenceMode: z.enum(['LIVE', 'MIXED', 'FIXTURE']),
    evidence: z.array(evidenceSnapshotSchema),
  })
  .strict();

export const planFinalizerResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    role: z.literal('PLAN_FINALIZER'),
    finalPlan: finalPlanRecordSchema,
  })
  .strict();

export const agentRunRequestSchema = z.union([
  userProxySearchBriefRequestSchema,
  userProxyBallotRequestSchema,
  candidateEvidenceRequestSchema,
  categoryArbiterRequestSchema,
  tripOrchestratorRequestSchema,
  planFinalizerRequestSchema,
]);

export const agentRunResultSchema = z.union([
  userProxySearchBriefResultSchema,
  userProxyBallotResultSchema,
  candidateEvidenceResultSchema,
  categoryArbiterResultSchema,
  tripOrchestratorResultSchema,
  planFinalizerResultSchema,
]);

export type AgentCategory = z.infer<typeof agentCategorySchema>;
export type AgentRole = z.infer<typeof agentRoleSchema>;
export type UserProxyProfileView = z.infer<typeof userProxyProfileViewSchema>;
export type TripCharter = z.infer<typeof tripCharterSchema>;
export type ProxySearchBrief = z.infer<typeof proxySearchBriefSchema>;
export type NeutralSearchBrief = z.infer<typeof neutralSearchBriefSchema>;
export type CandidateEvidenceQueryPlan = z.infer<typeof candidateEvidenceQueryPlanSchema>;
export type EvidenceSnapshot = z.infer<typeof evidenceSnapshotSchema>;
export type CandidateRecord = z.infer<typeof candidateRecordSchema>;
export type CandidatePoolVersion = z.infer<typeof candidatePoolVersionSchema>;
export type CategoryProposal = z.infer<typeof categoryProposalSchema>;
export type CategoryProposalSet = z.infer<typeof categoryProposalSetSchema>;
export type EvidenceChallenge = z.infer<typeof evidenceChallengeSchema>;
export type CandidateGapRequest = z.infer<typeof candidateGapRequestSchema>;
export type ProposalEvaluation = z.infer<typeof proposalEvaluationSchema>;
export type ProxyBallot = z.infer<typeof proxyBallotSchema>;
export type DeterministicSelection = z.infer<typeof deterministicSelectionSchema>;
export type VerificationReceipt = z.infer<typeof verificationReceiptSchema>;
export type CategoryDecisionContract = z.infer<typeof categoryDecisionContractSchema>;
export type OrchestratorGuardCheck = z.infer<typeof orchestratorGuardCheckSchema>;
export type TripOrchestratorReport = z.infer<typeof tripOrchestratorReportSchema>;
export type FinalPlanRecord = z.infer<typeof finalPlanRecordSchema>;
export type UserProxySearchBriefRequest = z.infer<typeof userProxySearchBriefRequestSchema>;
export type UserProxySearchBriefResult = z.infer<typeof userProxySearchBriefResultSchema>;
export type UserProxyBallotRequest = z.infer<typeof userProxyBallotRequestSchema>;
export type UserProxyBallotResult = z.infer<typeof userProxyBallotResultSchema>;
export type CandidateEvidenceRequest = z.infer<typeof candidateEvidenceRequestSchema>;
export type CandidateEvidenceResult = z.infer<typeof candidateEvidenceResultSchema>;
export type CategoryArbiterRequest = z.infer<typeof categoryArbiterRequestSchema>;
export type CategoryArbiterResult = z.infer<typeof categoryArbiterResultSchema>;
export type TripOrchestratorRequest = z.infer<typeof tripOrchestratorRequestSchema>;
export type TripOrchestratorResult = z.infer<typeof tripOrchestratorResultSchema>;
export type PlanFinalizerRequest = z.infer<typeof planFinalizerRequestSchema>;
export type PlanFinalizerResult = z.infer<typeof planFinalizerResultSchema>;
export type AgentRunRequest = z.infer<typeof agentRunRequestSchema>;
export type AgentRunResult = z.infer<typeof agentRunResultSchema>;
