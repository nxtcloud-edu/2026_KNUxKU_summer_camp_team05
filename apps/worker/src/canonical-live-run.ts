import type { AgentRuntime } from '@tm/agents';
import type {
  AgentCategory,
  AgentExecutionReceipt,
  CandidateEvidenceQueryPlan,
  CandidatePoolVersion,
  CandidateRecord,
  CategoryDecisionContract,
  CategoryProposalSet,
  DeterministicSelection,
  EvidenceSnapshot,
  FinalPlanRecord,
  NeutralSearchBrief,
  OrchestratorGuardCheck,
  ProposalEvaluation,
  ProxyBallot,
  ProxySearchBrief,
  TripCharter,
  TripOrchestratorReport,
  UserProxyProfileView,
  VerificationReceipt,
} from '@tm/contracts';
import {
  resolveDates,
  selectCategoryProposalLeximin,
  type DateResolution,
  type DateResolverInput,
  type StayCandidateValidationResult,
  type StayHardConstraint,
} from '@tm/core';

export type CanonicalExecutionStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type CanonicalResultStatus = FinalPlanRecord['status'];

export type CanonicalStage =
  | 'DATE_RESOLVER'
  | 'TRIP_CHARTER'
  | 'USER_PROXY_SEARCH_BRIEFS'
  | 'STRUCTURED_SEARCH_CONTEXT'
  | 'CANDIDATE_EVIDENCE_QUERY_PLAN'
  | 'PROVIDER_EXECUTION'
  | 'FACT_CONSTRAINT_VALIDATION'
  | 'CANDIDATE_POOL_VERSION'
  | 'CATEGORY_PROPOSAL_SET'
  | 'USER_PROXY_BALLOTS'
  | 'DETERMINISTIC_LEXIMIN'
  | 'CATEGORY_ARBITER'
  | 'TRIP_ORCHESTRATOR'
  | 'PLAN_FINALIZER'
  | 'DB_PERSISTENCE';

export interface CanonicalRoomContext {
  roomId: string;
  tripId: string;
  packId: string;
  destination: string;
  pace: string;
  category: AgentCategory;
}

/**
 * The composition root consumes a normalized Room + Survey/Profile snapshot.
 * Loading and normalizing database rows remains an integration adapter concern.
 */
export interface CanonicalLiveRunInput {
  runId: string;
  inputVersion: number;
  room: CanonicalRoomContext;
  profiles: readonly UserProxyProfileView[];
  dateResolverInput: DateResolverInput;
  dateChoice?: { start: string; end: string };
  priorContractRefs?: readonly string[];
  priorObligations?: readonly string[];
}

export interface DateResolverPort {
  resolve(input: DateResolverInput): DateResolution | Promise<DateResolution>;
}

export const coreDateResolverPort: DateResolverPort = {
  resolve: (input) => resolveDates(input),
};

export interface ProviderExecutionContext {
  packId: string;
  area: string;
  center: { lat: number; lng: number };
  roomCount: number;
  limit: number;
  searchRadiusKm: number;
  queryBudget: number;
}

export interface StructuredSearchContext {
  neutralBrief: NeutralSearchBrief;
  availableProviderIds: string[];
  providerExecution: ProviderExecutionContext;
  hardConstraints: readonly StayHardConstraint[];
  allowedRoomSplitAuthorityRefs: readonly string[];
  representativeBriefIdByParticipantId: Readonly<Record<string, string>>;
}

/** B1 integration point: assemble provider-safe, structured search context. */
export interface StructuredSearchPort {
  build(input: {
    runId: string;
    room: CanonicalRoomContext;
    charter: TripCharter;
    briefs: readonly ProxySearchBrief[];
    profiles: readonly UserProxyProfileView[];
  }): Promise<StructuredSearchContext>;
}

export interface CandidateEvidenceExecutionInput {
  runId: string;
  tripId: string;
  inputVersion: number;
  searchAttempt: 0 | 1;
  packId: string;
  category: AgentCategory;
  charter: TripCharter;
  queryPlans: readonly CandidateEvidenceQueryPlan[];
  expectedBriefIds: readonly string[];
  queryBudget: number;
  area: string;
  center: { lat: number; lng: number };
  roomCount: number;
  limit: number;
  searchRadiusKm: number;
}

export interface CandidateEvidenceExecutionResult {
  status: 'SUCCEEDED' | 'PARTIAL' | 'NO_CANDIDATES' | 'FAILED';
  candidates: CandidateRecord[];
  evidence: EvidenceSnapshot[];
  failures: readonly { code: string; message: string }[];
}

/** B2 integration point: execute QueryPlans through provider gateways, never HTTP here. */
export interface CandidateEvidenceExecutionPort {
  execute(input: CandidateEvidenceExecutionInput): Promise<CandidateEvidenceExecutionResult>;
}

export interface CandidateValidationResult {
  status: 'READY' | 'BLOCKED';
  candidatePool: CandidatePoolVersion | null;
  candidates: CandidateRecord[];
  evidence: EvidenceSnapshot[];
  receipts: VerificationReceipt[];
  validations: StayCandidateValidationResult[];
  reason: string | null;
}

/** B3 integration point: FactConstraintValidator owns all fact and constraint rules. */
export interface CandidateValidationPort {
  validate(input: {
    runId: string;
    room: CanonicalRoomContext;
    charter: TripCharter;
    profiles: readonly UserProxyProfileView[];
    execution: CandidateEvidenceExecutionResult;
    searchContext: StructuredSearchContext;
  }): Promise<CandidateValidationResult>;
}

export interface ProposalSetResult {
  proposalSet: CategoryProposalSet;
  evaluationsByParticipantId: Readonly<Record<string, readonly ProposalEvaluation[]>>;
}

/** B4 integration point: build proposals and evaluations from the sealed pool. */
export interface ProposalSetPort {
  create(input: {
    runId: string;
    room: CanonicalRoomContext;
    charter: TripCharter;
    profiles: readonly UserProxyProfileView[];
    candidatePool: CandidatePoolVersion;
    candidates: readonly CandidateRecord[];
    evidence: readonly EvidenceSnapshot[];
    receipts: readonly VerificationReceipt[];
    validations: readonly StayCandidateValidationResult[];
  }): Promise<ProposalSetResult>;
}

export interface CanonicalCompletedArtifacts {
  charter: TripCharter;
  searchBriefs: ProxySearchBrief[];
  queryPlans: CandidateEvidenceQueryPlan[];
  candidatePool: CandidatePoolVersion;
  proposalSet: CategoryProposalSet;
  ballots: ProxyBallot[];
  selection: DeterministicSelection;
  categoryContract: CategoryDecisionContract;
  orchestratorReport: TripOrchestratorReport;
  finalPlan: FinalPlanRecord;
}

export interface CanonicalLiveRunResult {
  runId: string;
  executionStatus: Extract<CanonicalExecutionStatus, 'COMPLETED' | 'FAILED'>;
  resultStatus: CanonicalResultStatus;
  idempotent: boolean;
  trace: CanonicalStage[];
  agentExecutionReceipts: AgentExecutionReceipt[];
  finalPlan: FinalPlanRecord | null;
  artifacts: CanonicalCompletedArtifacts | null;
  failure: { stage: CanonicalStage; code: string; message: string } | null;
}

export interface CanonicalPersistedRun {
  runId: string;
  executionStatus: CanonicalExecutionStatus;
  result: CanonicalLiveRunResult | null;
}

/** DB adapter boundary. No schema assumption is made by the Worker. */
export interface CanonicalRunPersistencePort {
  load(runId: string): Promise<CanonicalPersistedRun | null>;
  markQueued(input: CanonicalLiveRunInput): Promise<void>;
  markRunning(runId: string): Promise<void>;
  complete(result: CanonicalLiveRunResult): Promise<void>;
  fail(result: CanonicalLiveRunResult): Promise<void>;
}

export interface CanonicalLiveRunDependencies {
  agentRuntime: AgentRuntime;
  structuredSearch: StructuredSearchPort;
  candidateEvidence: CandidateEvidenceExecutionPort;
  candidateValidator: CandidateValidationPort;
  proposalSet: ProposalSetPort;
  persistence: CanonicalRunPersistencePort;
  dateResolver?: DateResolverPort;
}

class CanonicalStageError extends Error {
  constructor(
    readonly stage: CanonicalStage,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CanonicalStageError';
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function buildCharter(input: CanonicalLiveRunInput, dates: DateResolution): TripCharter {
  if (dates.chosen === null) {
    throw new CanonicalStageError('DATE_RESOLVER', 'DATES_UNRESOLVED', dates.reason);
  }
  const participantIds = input.profiles.map((profile) => profile.participantId);
  return {
    schemaVersion: 1,
    charterVersion: `charter:${input.room.tripId}:${input.inputVersion}`,
    destination: input.room.destination,
    startDate: dates.chosen.start,
    endDate: dates.chosen.end,
    participantIds,
    partySize: participantIds.length,
    pace: input.room.pace,
    budgetMaxByParticipantKrw: Object.fromEntries(
      input.profiles.map((profile) => [profile.participantId, profile.budgetMaxKrw]),
    ),
  };
}

function evidenceModeOf(evidence: readonly EvidenceSnapshot[]): FinalPlanRecord['evidenceMode'] {
  if (evidence.length > 0 && evidence.every((item) => item.confidence === 'live')) return 'LIVE';
  if (evidence.length > 0 && evidence.every((item) => item.providerId === 'fixture')) return 'FIXTURE';
  return 'MIXED';
}

function hasCompleteLiveEvidence(evidence: readonly EvidenceSnapshot[]): boolean {
  return evidence.length > 0 && evidence.every(
    (item) => item.confidence === 'live' && item.status === 'PASS',
  );
}

function applyEvidenceCeiling(
  finalPlan: FinalPlanRecord,
  evidence: readonly EvidenceSnapshot[],
): FinalPlanRecord {
  if (finalPlan.status !== 'VERIFIED' || hasCompleteLiveEvidence(evidence)) return finalPlan;
  return {
    ...finalPlan,
    status: 'PROVISIONAL',
    unresolvedIssues: unique([...finalPlan.unresolvedIssues, 'EVIDENCE_NOT_VERIFIED']),
  };
}

function handledResult(
  runId: string,
  resultStatus: Extract<CanonicalResultStatus, 'NEEDS_USER_CHOICE' | 'BLOCKED'>,
  trace: CanonicalStage[],
  stage: CanonicalStage,
  code: string,
  message: string,
  agentExecutionReceipts: AgentExecutionReceipt[],
): CanonicalLiveRunResult {
  return {
    runId,
    executionStatus: 'COMPLETED',
    resultStatus,
    idempotent: false,
    trace,
    agentExecutionReceipts,
    finalPlan: null,
    artifacts: null,
    failure: { stage, code, message },
  };
}

function agentExecutionReceiptsOf(runtime: AgentRuntime): AgentExecutionReceipt[] {
  return runtime.executionReceipts?.().map((receipt) => ({
    ...receipt,
    usage: receipt.usage === null ? null : { ...receipt.usage },
  })) ?? [];
}

function safeFailure(error: unknown, stage: CanonicalStage): CanonicalLiveRunResult['failure'] {
  if (error instanceof CanonicalStageError) {
    return { stage: error.stage, code: error.code, message: error.message };
  }
  return {
    stage,
    code: 'CANONICAL_RUNTIME_FAILED',
    message: error instanceof Error ? error.message : 'Canonical runtime failed.',
  };
}

/**
 * Canonical live composition root. It only sequences canonical components and
 * enforces lifecycle/idempotency and the external-evidence status ceiling.
 */
export async function runCanonicalLive(
  deps: CanonicalLiveRunDependencies,
  input: CanonicalLiveRunInput,
): Promise<CanonicalLiveRunResult> {
  const existing = await deps.persistence.load(input.runId);
  if (existing?.executionStatus === 'COMPLETED' && existing.result !== null) {
    return { ...existing.result, idempotent: true };
  }
  if (existing?.executionStatus === 'RUNNING') {
    return handledResult(
      input.runId,
      'BLOCKED',
      [],
      'DB_PERSISTENCE',
      'RUN_ALREADY_IN_PROGRESS',
      'The canonical run is already in progress.',
      agentExecutionReceiptsOf(deps.agentRuntime),
    );
  }

  const trace: CanonicalStage[] = [];
  let activeStage: CanonicalStage = 'DB_PERSISTENCE';
  try {
    await deps.persistence.markQueued(input);
    await deps.persistence.markRunning(input.runId);

    activeStage = 'DATE_RESOLVER';
    trace.push(activeStage);
    const rawDateResolution = await (deps.dateResolver ?? coreDateResolverPort).resolve(
      input.dateResolverInput,
    );
    const chosenByUser = input.dateChoice === undefined
      ? undefined
      : rawDateResolution.windows.find(
          (window) => window.start === input.dateChoice?.start && window.end === input.dateChoice.end,
        );
    const dateResolution: DateResolution = chosenByUser === undefined
      ? rawDateResolution
      : { ...rawDateResolution, status: 'confirmed', chosen: chosenByUser };
    if (dateResolution.chosen === null) {
      const result = handledResult(
        input.runId,
        dateResolution.status === 'impossible' ? 'BLOCKED' : 'NEEDS_USER_CHOICE',
        trace,
        activeStage,
        'DATES_UNRESOLVED',
        dateResolution.reason,
        agentExecutionReceiptsOf(deps.agentRuntime),
      );
      trace.push('DB_PERSISTENCE');
      await deps.persistence.complete(result);
      return result;
    }

    activeStage = 'TRIP_CHARTER';
    trace.push(activeStage);
    const charter = buildCharter(input, dateResolution);

    activeStage = 'USER_PROXY_SEARCH_BRIEFS';
    trace.push(activeStage);
    const searchBriefs: ProxySearchBrief[] = [];
    for (const profile of input.profiles) {
      const output = await deps.agentRuntime.run({
        schemaVersion: 1,
        role: 'USER_PROXY',
        task: 'CREATE_SEARCH_BRIEF',
        runId: input.runId,
        tripId: input.room.tripId,
        inputVersion: input.inputVersion,
        category: input.room.category,
        participant: profile,
        charter,
        priorContractRefs: [...(input.priorContractRefs ?? [])],
      });
      if (output.role !== 'USER_PROXY' || output.task !== 'CREATE_SEARCH_BRIEF') {
        throw new CanonicalStageError(activeStage, 'INVALID_AGENT_RESULT', 'Expected UserProxy SearchBrief.');
      }
      searchBriefs.push(output.brief);
    }

    activeStage = 'STRUCTURED_SEARCH_CONTEXT';
    trace.push(activeStage);
    const searchContext = await deps.structuredSearch.build({
      runId: input.runId,
      room: input.room,
      charter,
      briefs: searchBriefs,
      profiles: input.profiles,
    });

    activeStage = 'CANDIDATE_EVIDENCE_QUERY_PLAN';
    trace.push(activeStage);
    const queryOutput = await deps.agentRuntime.run({
      schemaVersion: 1,
      role: 'CANDIDATE_EVIDENCE',
      runId: input.runId,
      tripId: input.room.tripId,
      inputVersion: input.inputVersion,
      category: input.room.category,
      briefs: searchBriefs,
      neutralBrief: searchContext.neutralBrief,
      availableProviderIds: searchContext.availableProviderIds,
      searchAttempt: 0,
      currentCandidateIds: [],
    });
    if (queryOutput.role !== 'CANDIDATE_EVIDENCE' || queryOutput.queryPlans.length === 0) {
      const result = handledResult(
        input.runId,
        'BLOCKED',
        trace,
        activeStage,
        'NO_SAFE_QUERY',
        queryOutput.role === 'CANDIDATE_EVIDENCE'
          ? (queryOutput.warning ?? 'CandidateEvidence produced no safe query.')
          : 'Expected CandidateEvidence QueryPlan.',
        agentExecutionReceiptsOf(deps.agentRuntime),
      );
      trace.push('DB_PERSISTENCE');
      await deps.persistence.complete(result);
      return result;
    }

    activeStage = 'PROVIDER_EXECUTION';
    trace.push(activeStage);
    const execution = await deps.candidateEvidence.execute({
      runId: input.runId,
      tripId: input.room.tripId,
      inputVersion: input.inputVersion,
      searchAttempt: 0,
      packId: searchContext.providerExecution.packId,
      category: input.room.category,
      charter,
      queryPlans: queryOutput.queryPlans,
      expectedBriefIds: [
        ...searchBriefs.map((brief) => brief.briefId),
        searchContext.neutralBrief.briefId,
      ],
      queryBudget: searchContext.providerExecution.queryBudget,
      area: searchContext.providerExecution.area,
      center: searchContext.providerExecution.center,
      roomCount: searchContext.providerExecution.roomCount,
      limit: searchContext.providerExecution.limit,
      searchRadiusKm: searchContext.providerExecution.searchRadiusKm,
    });
    if (execution.status === 'FAILED' || execution.status === 'NO_CANDIDATES') {
      const firstFailure = execution.failures[0];
      const result = handledResult(
        input.runId,
        'BLOCKED',
        trace,
        activeStage,
        firstFailure?.code ?? 'NO_CANDIDATES',
        firstFailure?.message ?? 'Provider execution returned no candidates.',
        agentExecutionReceiptsOf(deps.agentRuntime),
      );
      trace.push('DB_PERSISTENCE');
      await deps.persistence.complete(result);
      return result;
    }

    activeStage = 'FACT_CONSTRAINT_VALIDATION';
    trace.push(activeStage);
    const validated = await deps.candidateValidator.validate({
      runId: input.runId,
      room: input.room,
      charter,
      profiles: input.profiles,
      execution,
      searchContext,
    });
    if (validated.status === 'BLOCKED' || validated.candidatePool === null) {
      const result = handledResult(
        input.runId,
        'BLOCKED',
        trace,
        activeStage,
        'FACT_CONSTRAINT_BLOCKED',
        validated.reason ?? 'FactConstraintValidator blocked the candidate pool.',
        agentExecutionReceiptsOf(deps.agentRuntime),
      );
      trace.push('DB_PERSISTENCE');
      await deps.persistence.complete(result);
      return result;
    }

    activeStage = 'CANDIDATE_POOL_VERSION';
    trace.push(activeStage);
    const candidatePool = validated.candidatePool;

    activeStage = 'CATEGORY_PROPOSAL_SET';
    trace.push(activeStage);
    const proposals = await deps.proposalSet.create({
      runId: input.runId,
      room: input.room,
      charter,
      profiles: input.profiles,
      candidatePool,
      candidates: validated.candidates,
      evidence: validated.evidence,
      receipts: validated.receipts,
      validations: validated.validations,
    });

    activeStage = 'USER_PROXY_BALLOTS';
    trace.push(activeStage);
    const ballots: ProxyBallot[] = [];
    for (const profile of input.profiles) {
      const evaluations = proposals.evaluationsByParticipantId[profile.participantId];
      if (evaluations === undefined) {
        throw new CanonicalStageError(activeStage, 'MISSING_EVALUATIONS', `Missing evaluations for ${profile.participantId}.`);
      }
      const output = await deps.agentRuntime.run({
        schemaVersion: 1,
        role: 'USER_PROXY',
        task: 'CREATE_BALLOT',
        runId: input.runId,
        tripId: input.room.tripId,
        inputVersion: input.inputVersion,
        category: input.room.category,
        participant: profile,
        proposalSet: proposals.proposalSet,
        evaluations: [...evaluations],
        evidence: validated.evidence,
      });
      if (output.role !== 'USER_PROXY' || output.task !== 'CREATE_BALLOT') {
        throw new CanonicalStageError(activeStage, 'INVALID_AGENT_RESULT', 'Expected UserProxy Ballot.');
      }
      ballots.push(output.ballot);
    }

    activeStage = 'DETERMINISTIC_LEXIMIN';
    trace.push(activeStage);
    const selection = selectCategoryProposalLeximin(ballots, proposals.proposalSet);

    activeStage = 'CATEGORY_ARBITER';
    trace.push(activeStage);
    const arbiter = await deps.agentRuntime.run({
      schemaVersion: 1,
      role: 'CATEGORY_ARBITER',
      runId: input.runId,
      tripId: input.room.tripId,
      inputVersion: input.inputVersion,
      category: input.room.category,
      charter,
      proposalSet: proposals.proposalSet,
      ballots,
      deterministicSelection: selection,
      receipts: validated.receipts,
      priorObligations: [...(input.priorObligations ?? [])],
    });
    if (arbiter.role !== 'CATEGORY_ARBITER') {
      throw new CanonicalStageError(activeStage, 'INVALID_AGENT_RESULT', 'Expected CategoryArbiter contract.');
    }

    const guardChecks: OrchestratorGuardCheck[] = [
      {
        code: 'ARBITER_SELECTION_ALIGNED',
        passed: arbiter.contract.selectedProposalId === selection.selectedProposalId,
        message: 'CategoryArbiter must preserve deterministic leximin selection.',
        refs: [selection.selectedProposalId],
      },
      {
        code: 'BALLOT_VERSION_ALIGNED',
        passed: ballots.every(
          (ballot) => ballot.proposalSetVersion === proposals.proposalSet.proposalSetVersion,
        ),
        message: 'Every ballot must target the sealed ProposalSet version.',
        refs: ballots.map((ballot) => ballot.ballotId),
      },
    ];

    activeStage = 'TRIP_ORCHESTRATOR';
    trace.push(activeStage);
    const orchestrator = await deps.agentRuntime.run({
      schemaVersion: 1,
      role: 'TRIP_ORCHESTRATOR',
      runId: input.runId,
      tripId: input.room.tripId,
      inputVersion: input.inputVersion,
      charter,
      categoryContracts: [arbiter.contract],
      guardChecks,
      evidence: validated.evidence,
    });
    if (orchestrator.role !== 'TRIP_ORCHESTRATOR') {
      throw new CanonicalStageError(activeStage, 'INVALID_AGENT_RESULT', 'Expected TripOrchestrator report.');
    }

    activeStage = 'PLAN_FINALIZER';
    trace.push(activeStage);
    const finalizer = await deps.agentRuntime.run({
      schemaVersion: 1,
      role: 'PLAN_FINALIZER',
      runId: input.runId,
      tripId: input.room.tripId,
      inputVersion: input.inputVersion,
      charter,
      categoryContracts: [arbiter.contract],
      orchestratorReport: orchestrator.report,
      evidenceMode: evidenceModeOf(validated.evidence),
      evidence: validated.evidence,
    });
    if (finalizer.role !== 'PLAN_FINALIZER') {
      throw new CanonicalStageError(activeStage, 'INVALID_AGENT_RESULT', 'Expected PlanFinalizer record.');
    }
    const finalPlan = applyEvidenceCeiling(finalizer.finalPlan, validated.evidence);

    const artifacts: CanonicalCompletedArtifacts = {
      charter,
      searchBriefs,
      queryPlans: queryOutput.queryPlans,
      candidatePool,
      proposalSet: proposals.proposalSet,
      ballots,
      selection,
      categoryContract: arbiter.contract,
      orchestratorReport: orchestrator.report,
      finalPlan,
    };
    const result: CanonicalLiveRunResult = {
      runId: input.runId,
      executionStatus: 'COMPLETED',
      resultStatus: finalPlan.status,
      idempotent: false,
      trace,
      agentExecutionReceipts: agentExecutionReceiptsOf(deps.agentRuntime),
      finalPlan,
      artifacts,
      failure: null,
    };
    activeStage = 'DB_PERSISTENCE';
    trace.push(activeStage);
    await deps.persistence.complete(result);
    return result;
  } catch (error) {
    const result: CanonicalLiveRunResult = {
      runId: input.runId,
      executionStatus: 'FAILED',
      resultStatus: 'BLOCKED',
      idempotent: false,
      trace,
      agentExecutionReceipts: agentExecutionReceiptsOf(deps.agentRuntime),
      finalPlan: null,
      artifacts: null,
      failure: safeFailure(error, activeStage),
    };
    try {
      if (trace.at(-1) !== 'DB_PERSISTENCE') trace.push('DB_PERSISTENCE');
      await deps.persistence.fail(result);
    } catch {
      // The original failure remains the primary diagnostic; persistence adapters log their own error.
    }
    return result;
  }
}
