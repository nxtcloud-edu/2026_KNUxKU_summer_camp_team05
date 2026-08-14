import { z } from 'zod';

const identifierSchema = z.string().min(1);
const basisPointsSchema = z.number().int().min(0).max(10_000);

export const mvpEvidenceRefSchema = z
  .object({
    evidenceId: identifierSchema,
    status: z.enum(['VERIFIED', 'UNKNOWN', 'STALE', 'FAILED']),
    summary: z.string().min(1),
  })
  .strict();

export const mvpProfileConstraintSchema = z
  .object({
    constraintId: identifierSchema,
    statement: z.string().min(1),
    factId: identifierSchema,
  })
  .strict();

export const mvpProfilePreferenceSchema = z
  .object({
    preferenceId: identifierSchema,
    statement: z.string().min(1),
    weightBp: basisPointsSchema,
    factId: identifierSchema,
  })
  .strict();

export const mvpConfirmedProfileSchema = z
  .object({
    participantId: identifierSchema,
    confirmedFactIds: z.array(identifierSchema),
    preferences: z.array(mvpProfilePreferenceSchema),
    hardConstraints: z.array(mvpProfileConstraintSchema),
    protectedObjectives: z.array(mvpProfileConstraintSchema).max(2),
    budgetMaxKrw: z.number().int().nonnegative(),
  })
  .strict();

export const mvpUserProxyProfileViewSchema = mvpConfirmedProfileSchema;

export const mvpStayCandidateSchema = z
  .object({
    proposalId: identifierSchema,
    proposalSetVersion: z.number().int().positive(),
    headline: z.string().min(1),
    costPerPersonKrw: z.number().int().nonnegative(),
    capacity: z.number().int().positive(),
    attributesBp: z.record(basisPointsSchema),
    violatedConstraintIds: z.array(identifierSchema),
    evidenceIds: z.array(identifierSchema).min(1),
  })
  .strict();

const searchScalarSchema = z.union([z.string(), z.number(), z.boolean()]);

export const candidateSearchInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: identifierSchema,
    tripId: identifierSchema,
    planVersion: z.number().int().nonnegative(),
    category: z.literal('stay'),
    shortageReason: z.enum([
      'NO_CANDIDATES',
      'ALL_DISQUALIFIED',
      'LOW_CONFIDENCE',
      'UNSTRUCTURED_REQUEST',
    ]),
    unresolvedTerms: z.array(z.string().min(1)),
    canonicalConstraints: z
      .object({
        hardConstraintIds: z.array(identifierSchema),
        protectedObjectiveIds: z.array(identifierSchema),
        filters: z.record(searchScalarSchema),
      })
      .strict(),
    allowedRelaxationIds: z.array(identifierSchema),
    requestedRelaxationIds: z.array(identifierSchema),
    currentCandidateIds: z.array(identifierSchema),
  })
  .strict();

export const searchQueryPlanSchema = z
  .object({
    queryId: identifierSchema,
    keywords: z.array(z.string().min(1)).min(1),
    filters: z.record(searchScalarSchema),
    relaxationChanges: z.array(identifierSchema),
    rationale: z.string().min(1),
  })
  .strict();

export const candidateSearchOutputSchema = z
  .object({
    status: z.enum(['QUERY_PLAN_PROPOSED', 'NO_SAFE_QUERY']),
    queryPlans: z.array(searchQueryPlanSchema),
    warning: z.string().min(1).nullable(),
  })
  .strict();

export const mvpStayFixtureInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: identifierSchema,
    tripId: identifierSchema,
    planVersion: z.number().int().nonnegative(),
    participantIds: z.array(identifierSchema).min(1),
    profileSource: z
      .object({
        profiles: z.record(mvpConfirmedProfileSchema),
      })
      .strict(),
    search: candidateSearchInputSchema,
    candidates: z.array(mvpStayCandidateSchema).min(1),
    evidence: z.array(mvpEvidenceRefSchema).min(1),
  })
  .strict();

export const mvpProposalEvaluationSchema = z
  .object({
    proposalId: identifierSchema,
    satisfactionBp: basisPointsSchema,
    profileFactIds: z.array(identifierSchema),
    evidenceIds: z.array(identifierSchema),
  })
  .strict();

export const mvpUserProxyInputSchema = z
  .object({
    role: z.literal('USER_PROXY'),
    runId: identifierSchema,
    tripId: identifierSchema,
    planVersion: z.number().int().nonnegative(),
    participant: mvpUserProxyProfileViewSchema,
    proposals: z.array(mvpStayCandidateSchema).min(1),
    evaluations: z.array(mvpProposalEvaluationSchema).min(1),
    evidence: z.array(mvpEvidenceRefSchema),
  })
  .strict();

export const mvpProxyBallotSchema = z
  .object({
    participantId: identifierSchema,
    rankedProposalIds: z.array(identifierSchema).min(1),
    satisfactionByProposalBp: z.record(basisPointsSchema),
    profileFactIds: z.array(identifierSchema),
    evidenceIds: z.array(identifierSchema),
    rationale: z.string().min(1),
  })
  .strict();

export const mvpUserProxyOutputSchema = z
  .object({
    role: z.literal('USER_PROXY'),
    ballot: mvpProxyBallotSchema,
  })
  .strict();

export const mvpStaySelectionSchema = z
  .object({
    selectedProposalId: identifierSchema,
    rankedProposalIds: z.array(identifierSchema).min(1),
    minSatisfactionBp: basisPointsSchema,
    totalSatisfactionBp: z.number().int().nonnegative(),
    decidedBy: z.enum(['MAXIMIN', 'TOTAL', 'PROPOSAL_ID']),
  })
  .strict();

export const mvpStayArbiterInputSchema = z
  .object({
    role: z.literal('STAY_ARBITER'),
    runId: identifierSchema,
    tripId: identifierSchema,
    planVersion: z.number().int().nonnegative(),
    proposals: z.array(mvpStayCandidateSchema).min(1),
    ballots: z.array(mvpProxyBallotSchema).min(1),
    deterministicSelection: mvpStaySelectionSchema,
    evidence: z.array(mvpEvidenceRefSchema),
  })
  .strict();

export const mvpStayArbiterOutputSchema = z
  .object({
    role: z.literal('STAY_ARBITER'),
    outcome: z.enum(['CONCLUDED', 'NO_SAFE_DECISION']),
    selectedProposalId: identifierSchema.nullable(),
    summary: z.string().min(1),
    unresolvedIssues: z.array(z.string().min(1)),
    evidenceIds: z.array(identifierSchema),
  })
  .strict();

export const mvpGuardCheckSchema = z
  .object({
    code: z.enum([
      'ARBITER_ALIGNED',
      'CAPACITY_VALID',
      'BUDGET_VALID',
      'CONSTRAINTS_VALID',
      'EVIDENCE_VERIFIED',
    ]),
    passed: z.boolean(),
    message: z.string().min(1),
    evidenceIds: z.array(identifierSchema),
  })
  .strict();

export const mvpTripSupervisorInputSchema = z
  .object({
    role: z.literal('TRIP_SUPERVISOR'),
    runId: identifierSchema,
    tripId: identifierSchema,
    planVersion: z.number().int().nonnegative(),
    selectedProposal: mvpStayCandidateSchema,
    participantCount: z.number().int().positive(),
    guardChecks: z.array(mvpGuardCheckSchema).min(1),
    evidence: z.array(mvpEvidenceRefSchema),
  })
  .strict();

export const mvpSupervisorFindingSchema = z
  .object({
    code: mvpGuardCheckSchema.shape.code,
    message: z.string().min(1),
    evidenceIds: z.array(identifierSchema),
  })
  .strict();

export const mvpTripSupervisorOutputSchema = z
  .object({
    role: z.literal('TRIP_SUPERVISOR'),
    guardStatus: z.enum(['CLEAR', 'HOLD']),
    observedSelectedProposalId: identifierSchema,
    findings: z.array(mvpSupervisorFindingSchema),
    evidenceIds: z.array(identifierSchema),
  })
  .strict();

export const mvpAgentRunRequestSchema = z.discriminatedUnion('role', [
  mvpUserProxyInputSchema,
  mvpStayArbiterInputSchema,
  mvpTripSupervisorInputSchema,
]);

export const mvpAgentRunResultSchema = z.discriminatedUnion('role', [
  mvpUserProxyOutputSchema,
  mvpStayArbiterOutputSchema,
  mvpTripSupervisorOutputSchema,
]);

export const mvpStayFixtureRunResultSchema = z
  .object({
    status: z.enum(['FIXTURE_PATH_CLEAR', 'NO_SAFE_QUERY', 'BLOCKED']),
    runId: identifierSchema,
    tripId: identifierSchema,
    search: candidateSearchOutputSchema,
    roleTrace: z.array(z.enum(['USER_PROXY', 'STAY_ARBITER', 'TRIP_SUPERVISOR'])),
    ballots: z.array(mvpProxyBallotSchema),
    selection: mvpStaySelectionSchema.nullable(),
    arbiter: mvpStayArbiterOutputSchema.nullable(),
    guardChecks: z.array(mvpGuardCheckSchema),
    supervisor: mvpTripSupervisorOutputSchema.nullable(),
  })
  .strict();

export type MvpEvidenceRef = z.infer<typeof mvpEvidenceRefSchema>;
export type MvpConfirmedProfile = z.infer<typeof mvpConfirmedProfileSchema>;
export type MvpUserProxyProfileView = z.infer<typeof mvpUserProxyProfileViewSchema>;
export type MvpStayCandidate = z.infer<typeof mvpStayCandidateSchema>;
export type CandidateSearchInput = z.infer<typeof candidateSearchInputSchema>;
export type SearchQueryPlan = z.infer<typeof searchQueryPlanSchema>;
export type CandidateSearchOutput = z.infer<typeof candidateSearchOutputSchema>;
export type MvpStayFixtureInput = z.infer<typeof mvpStayFixtureInputSchema>;
export type MvpProposalEvaluation = z.infer<typeof mvpProposalEvaluationSchema>;
export type MvpUserProxyInput = z.infer<typeof mvpUserProxyInputSchema>;
export type MvpProxyBallot = z.infer<typeof mvpProxyBallotSchema>;
export type MvpUserProxyOutput = z.infer<typeof mvpUserProxyOutputSchema>;
export type MvpStaySelection = z.infer<typeof mvpStaySelectionSchema>;
export type MvpStayArbiterInput = z.infer<typeof mvpStayArbiterInputSchema>;
export type MvpStayArbiterOutput = z.infer<typeof mvpStayArbiterOutputSchema>;
export type MvpGuardCheck = z.infer<typeof mvpGuardCheckSchema>;
export type MvpTripSupervisorInput = z.infer<typeof mvpTripSupervisorInputSchema>;
export type MvpTripSupervisorOutput = z.infer<typeof mvpTripSupervisorOutputSchema>;
export type MvpAgentRunRequest = z.infer<typeof mvpAgentRunRequestSchema>;
export type MvpAgentRunResult = z.infer<typeof mvpAgentRunResultSchema>;
export type MvpStayFixtureRunResult = z.infer<typeof mvpStayFixtureRunResultSchema>;
