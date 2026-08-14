import {
  agentRunRequestSchema,
  agentRunResultSchema,
  candidateEvidenceResultSchema,
  categoryArbiterResultSchema,
  planFinalizerResultSchema,
  queryClasses,
  tripOrchestratorResultSchema,
  userProxyBallotResultSchema,
  userProxySearchBriefResultSchema,
  type AgentRole,
  type AgentCategory,
  type AgentRunRequest,
  type AgentRunResult,
  type CandidateEvidenceRequest,
  type CandidateEvidenceResult,
  type CategoryArbiterRequest,
  type CategoryArbiterResult,
  type CodexGatewayModelProfile,
  type PlanFinalizerRequest,
  type PlanFinalizerResult,
  type TripOrchestratorRequest,
  type TripOrchestratorResult,
  type UserProxyBallotRequest,
  type UserProxyBallotResult,
  type UserProxySearchBriefRequest,
  type UserProxySearchBriefResult,
} from '@tm/contracts';
import { assertAgentContextSafe } from '@tm/core';
import type { CodexGatewayClient } from './codex-gateway.js';

type JsonSchema = Record<string, unknown>;

const stringValue: JsonSchema = { type: 'string', minLength: 1 };
const stringArray: JsonSchema = { type: 'array', items: stringValue };
const integerValue: JsonSchema = { type: 'integer' };
const basisPointsValue: JsonSchema = { type: 'integer', minimum: 0, maximum: 10_000 };
const schemaVersionOne: JsonSchema = { type: 'integer', const: 1 };

function stringConst(value: string): JsonSchema {
  return { type: 'string', const: value };
}

function stringEnum(values: readonly string[]): JsonSchema {
  return { type: 'string', enum: [...values] };
}

function strictObject(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

function arrayOf(items: JsonSchema): JsonSchema {
  return { type: 'array', items };
}

function nullable(value: JsonSchema): JsonSchema {
  return { anyOf: [value, { type: 'null' }] };
}

const evidenceChallengeJsonSchema = strictObject({
  schemaVersion: schemaVersionOne,
  challengeId: stringValue,
  participantId: stringValue,
  proposalId: stringValue,
  factType: stringValue,
  reason: stringValue,
});

const candidateGapRequestJsonSchema = strictObject({
  schemaVersion: schemaVersionOne,
  requestId: stringValue,
  participantId: stringValue,
  category: stringEnum(['long_distance', 'stay', 'activity', 'dining', 'schedule']),
  missingPreferenceRefs: stringArray,
  reason: stringValue,
  suggestedSearchTerms: stringArray,
});

const proxySearchBriefJsonSchema = strictObject({
  schemaVersion: schemaVersionOne,
  briefId: stringValue,
  participantId: stringValue,
  category: stringEnum(['long_distance', 'stay', 'activity', 'dining', 'schedule']),
  profileVersion: stringValue,
  mustKeepRefs: stringArray,
  preferenceTargetRefs: stringArray,
  desiredTraits: stringArray,
  avoidTraits: stringArray,
  tradeoffs: stringArray,
  searchTerms: stringArray,
});

function proxyBallotJsonSchema(proposalIds: readonly string[]): JsonSchema {
  return strictObject({
    schemaVersion: schemaVersionOne,
    ballotId: stringValue,
    participantId: stringValue,
    category: stringEnum(['long_distance', 'stay', 'activity', 'dining', 'schedule']),
    proposalSetVersion: integerValue,
    rankedProposalIds: stringArray,
    satisfactionByProposalBp: strictObject(
      Object.fromEntries(proposalIds.map((proposalId) => [proposalId, basisPointsValue])),
    ),
    stanceByProposal: strictObject(
      Object.fromEntries(
        proposalIds.map((proposalId) => [
          proposalId,
          stringEnum(['support', 'conditional', 'oppose']),
        ]),
      ),
    ),
    profileFactRefs: stringArray,
    conditionalTerms: stringArray,
    rationale: stringValue,
    evidenceChallenges: arrayOf(evidenceChallengeJsonSchema),
    candidateGapRequest: nullable(candidateGapRequestJsonSchema),
  });
}

const queryPlanJsonSchema = strictObject({
  schemaVersion: schemaVersionOne,
  queryPlanId: stringValue,
  category: stringEnum(['long_distance', 'stay', 'activity', 'dining', 'schedule']),
  sourceBriefIds: stringArray,
  queryClass: stringEnum(queryClasses),
  providerOrder: stringArray,
  searchTerms: stringArray,
  params: strictObject({}),
  relaxationChanges: stringArray,
  rationale: stringValue,
});

const categoryDecisionJsonSchema = strictObject({
  schemaVersion: schemaVersionOne,
  contractId: stringValue,
  contractVersion: integerValue,
  category: stringEnum(['long_distance', 'stay', 'activity', 'dining', 'schedule']),
  charterVersion: stringValue,
  proposalSetVersion: integerValue,
  outcome: stringEnum(['CONCLUDED', 'CONTINUE', 'NO_SAFE_DECISION']),
  selectedProposalId: nullable(stringValue),
  deterministicSelectedProposalId: nullable(stringValue),
  rejectedProposalIds: stringArray,
  ballotIds: stringArray,
  summary: stringValue,
  unresolvedIssues: stringArray,
  obligationsForNextCategory: stringArray,
  blockReason: nullable(stringValue),
  evidenceIds: stringArray,
});

const findingJsonSchema = strictObject({
  code: stringValue,
  severity: stringEnum(['info', 'warning', 'error']),
  message: stringValue,
  refs: stringArray,
});

const tripOrchestratorReportJsonSchema = strictObject({
  schemaVersion: schemaVersionOne,
  reportId: stringValue,
  guardStatus: stringEnum(['CLEAR', 'RECHECK', 'HOLD']),
  observedContractIds: stringArray,
  findings: arrayOf(findingJsonSchema),
  recheckTargets: stringArray,
  summary: stringValue,
  evidenceIds: stringArray,
});

const finalPlanJsonSchema = strictObject({
  schemaVersion: schemaVersionOne,
  finalPlanId: stringValue,
  finalPlanVersion: integerValue,
  tripId: stringValue,
  status: stringEnum(['PROVISIONAL', 'VERIFIED', 'NEEDS_USER_CHOICE', 'BLOCKED']),
  evidenceMode: stringEnum(['LIVE', 'MIXED', 'FIXTURE']),
  categoryDecisionContractIds: stringArray,
  orchestratorReportId: stringValue,
  evidenceIds: stringArray,
  unresolvedIssues: stringArray,
  summary: stringValue,
});

function outputJsonSchema(request: AgentRunRequest): JsonSchema {
  if (request.role === 'USER_PROXY' && request.task === 'CREATE_SEARCH_BRIEF') {
    return strictObject({
      schemaVersion: schemaVersionOne,
      role: stringConst('USER_PROXY'),
      task: stringConst('CREATE_SEARCH_BRIEF'),
      brief: proxySearchBriefJsonSchema,
    });
  }
  if (request.role === 'USER_PROXY') {
    return strictObject({
      schemaVersion: schemaVersionOne,
      role: stringConst('USER_PROXY'),
      task: stringConst('CREATE_BALLOT'),
      ballot: proxyBallotJsonSchema(
        request.proposalSet.proposals.map((proposal) => proposal.proposalId),
      ),
    });
  }
  if (request.role === 'CANDIDATE_EVIDENCE') {
    return strictObject({
      schemaVersion: schemaVersionOne,
      role: stringConst('CANDIDATE_EVIDENCE'),
      status: stringEnum(['QUERY_PLAN_PROPOSED', 'NO_SAFE_QUERY']),
      queryPlans: arrayOf(queryPlanJsonSchema),
      warning: nullable(stringValue),
    });
  }
  if (request.role === 'CATEGORY_ARBITER') {
    return strictObject({
      schemaVersion: schemaVersionOne,
      role: stringConst('CATEGORY_ARBITER'),
      contract: categoryDecisionJsonSchema,
    });
  }
  if (request.role === 'TRIP_ORCHESTRATOR') {
    return strictObject({
      schemaVersion: schemaVersionOne,
      role: stringConst('TRIP_ORCHESTRATOR'),
      report: tripOrchestratorReportJsonSchema,
    });
  }
  return strictObject({
    schemaVersion: schemaVersionOne,
    role: stringConst('PLAN_FINALIZER'),
    finalPlan: finalPlanJsonSchema,
  });
}

const roleInstructions: Record<AgentRole, string> = {
  USER_PROXY:
    '자기 참가자 투영만 사용해 탐색 방향 또는 동일 버전 전체 Proposal의 투표를 작성한다. 다른 참가자 정보와 여행 API를 요청하지 않는다.',
  CANDIDATE_EVIDENCE:
    'Proxy별 Brief와 중립 Brief를 공정하게 QueryPlan으로 변환하고 MVP에서는 각 Brief를 정확히 한 QueryPlan에만 배정한다. 실제 HTTP, API Key, 검증 통과, 후보 선택은 수행하지 않는다.',
  CATEGORY_ARBITER:
    '결정론 선택을 변경하지 않고 갈등, 조건부 수용, 종료 또는 차단 이유를 CategoryDecisionContract로 작성한다.',
  TRIP_ORCHESTRATOR:
    '카테고리 결정을 다시 선택하지 않고 날짜, 페이스, 예산, 근거, 전역 제약을 감사한다.',
  PLAN_FINALIZER:
    'CategoryDecisionContract 연속성과 감사 결과를 설명하되 검증·상태 상한을 높이지 않는다.',
};

const defaultModelProfiles: Record<AgentRole, CodexGatewayModelProfile> = {
  USER_PROXY: 'FAST',
  CANDIDATE_EVIDENCE: 'BALANCED',
  CATEGORY_ARBITER: 'DEEP_REASONING',
  TRIP_ORCHESTRATOR: 'DEEP_REASONING',
  PLAN_FINALIZER: 'BALANCED',
};

const defaultReasoningEfforts: Record<AgentRole, 'low' | 'medium' | 'high'> = {
  USER_PROXY: 'low',
  CANDIDATE_EVIDENCE: 'medium',
  CATEGORY_ARBITER: 'high',
  TRIP_ORCHESTRATOR: 'high',
  PLAN_FINALIZER: 'medium',
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function collectEvidenceIds(value: unknown): string[] {
  const found: string[] = [];
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (typeof current !== 'object' || current === null) return;
    for (const [key, child] of Object.entries(current)) {
      if (key === 'evidenceId' && typeof child === 'string') found.push(child);
      if ((key === 'evidenceIds' || key === 'evidenceRefs') && Array.isArray(child)) {
        found.push(...child.filter((item): item is string => typeof item === 'string'));
      }
      visit(child);
    }
  };
  visit(value);
  return unique(found);
}

function categoryOf(request: AgentRunRequest): AgentCategory | undefined {
  return 'category' in request ? request.category : undefined;
}

function participantIdOf(request: AgentRunRequest): string | undefined {
  return request.role === 'USER_PROXY' ? request.participant.participantId : undefined;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

function hasUniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function hasOneQueryPlanPerBrief(
  queryPlans: CandidateEvidenceResult['queryPlans'],
  expectedBriefIds: readonly string[],
): boolean {
  const countByBrief = new Map<string, number>();
  for (const plan of queryPlans) {
    for (const briefId of plan.sourceBriefIds) {
      countByBrief.set(briefId, (countByBrief.get(briefId) ?? 0) + 1);
    }
  }
  return expectedBriefIds.every((briefId) => countByBrief.get(briefId) === 1);
}

function assertPlanFinalizerCeiling(
  request: PlanFinalizerRequest,
  result: PlanFinalizerResult,
): void {
  const finalPlan = result.finalPlan;
  if (
    finalPlan.tripId !== request.tripId ||
    finalPlan.evidenceMode !== request.evidenceMode ||
    finalPlan.orchestratorReportId !== request.orchestratorReport.reportId ||
    !sameStringSet(
      finalPlan.categoryDecisionContractIds,
      request.categoryContracts.map((contract) => contract.contractId),
    )
  ) {
    throw new Error('PlanFinalizerAgent가 입력 계약의 식별자 또는 근거 모드를 변경했습니다.');
  }

  const blocked = request.categoryContracts.some(
    (contract) => contract.outcome === 'NO_SAFE_DECISION',
  ) || request.orchestratorReport.guardStatus === 'HOLD';
  const needsUserChoice = request.orchestratorReport.guardStatus === 'RECHECK' ||
    request.categoryContracts.some(
      (contract) => contract.outcome === 'CONTINUE' || contract.unresolvedIssues.length > 0,
    );
  const requiredEvidenceIds = unique([
    ...request.categoryContracts.flatMap((contract) => contract.evidenceIds),
    ...request.orchestratorReport.evidenceIds,
  ]);
  const evidenceById = new Map(request.evidence.map((evidence) => [evidence.evidenceId, evidence]));
  const verifiedEvidenceComplete = requiredEvidenceIds.length > 0 &&
    requiredEvidenceIds.every((evidenceId) => {
      const evidence = evidenceById.get(evidenceId);
      return evidence?.status === 'PASS' && evidence.confidence === 'live';
    });

  if (blocked && finalPlan.status !== 'BLOCKED') {
    throw new Error('차단 계약 또는 HOLD 감사 결과는 BLOCKED로 보존해야 합니다.');
  }
  if (
    !blocked &&
    needsUserChoice &&
    finalPlan.status !== 'NEEDS_USER_CHOICE' &&
    finalPlan.status !== 'BLOCKED'
  ) {
    throw new Error('미해결 계약 또는 RECHECK 감사 결과에는 사용자 선택이 필요합니다.');
  }
  if (
    finalPlan.status === 'VERIFIED' &&
    (request.evidenceMode !== 'LIVE' || !verifiedEvidenceComplete)
  ) {
    throw new Error('LIVE PASS 근거가 모두 갖춰지지 않아 VERIFIED로 승격할 수 없습니다.');
  }
}

function assertResultMatchesRequest(request: AgentRunRequest, result: AgentRunResult): void {
  if (request.role !== result.role) throw new Error('Agent Runtime 결과 role이 요청과 다릅니다.');
  const allowedEvidenceIds = new Set(collectEvidenceIds(request));
  const unexpectedEvidenceIds = collectEvidenceIds(result).filter(
    (evidenceId) => !allowedEvidenceIds.has(evidenceId),
  );
  if (unexpectedEvidenceIds.length > 0) {
    throw new Error(
      `Agent Runtime 입력에 없는 Evidence ID가 출력에 포함되었습니다: ${unexpectedEvidenceIds.join(',')}`,
    );
  }
  if (
    request.role === 'USER_PROXY' &&
    result.role === 'USER_PROXY' &&
    request.task !== result.task
  ) {
    throw new Error('UserProxyAgent 결과 task가 요청과 다릅니다.');
  }
  if (request.role === 'USER_PROXY' && result.role === 'USER_PROXY') {
    if (request.task === 'CREATE_SEARCH_BRIEF' && result.task === 'CREATE_SEARCH_BRIEF') {
      if (
        result.brief.participantId !== request.participant.participantId ||
        result.brief.category !== request.category ||
        result.brief.profileVersion !== request.participant.profileVersion
      ) {
        throw new Error('UserProxyAgent가 자기 참가자·카테고리·프로필 경계를 벗어났습니다.');
      }
      const allowedFactIds = new Set(request.participant.facts.map((fact) => fact.factId));
      if (
        [...result.brief.mustKeepRefs, ...result.brief.preferenceTargetRefs]
          .some((factId) => !allowedFactIds.has(factId))
      ) {
        throw new Error('UserProxyAgent가 자기 projection 밖의 profile fact를 참조했습니다.');
      }
    }
    if (request.task === 'CREATE_BALLOT' && result.task === 'CREATE_BALLOT') {
      if (
        result.ballot.participantId !== request.participant.participantId ||
        result.ballot.category !== request.category ||
        result.ballot.proposalSetVersion !== request.proposalSet.proposalSetVersion ||
        !sameStringSet(
          result.ballot.rankedProposalIds,
          request.proposalSet.proposals.map((proposal) => proposal.proposalId),
        )
      ) {
        throw new Error('UserProxyAgent Ballot이 자기 참가자 또는 활성 ProposalSet을 벗어났습니다.');
      }
    }
  }
  if (request.role === 'CANDIDATE_EVIDENCE' && result.role === 'CANDIDATE_EVIDENCE') {
    if (result.status === 'QUERY_PLAN_PROPOSED') {
      const expectedBriefIds = [
        ...request.briefs.map((brief) => brief.briefId),
        request.neutralBrief.briefId,
      ];
      const sourceBriefIds = result.queryPlans.flatMap((plan) => plan.sourceBriefIds);
      const queryPlanIds = result.queryPlans.map((plan) => plan.queryPlanId);
      const allowedProviders = new Set(request.availableProviderIds);
      if (
        !sameStringSet(sourceBriefIds, expectedBriefIds) ||
        !hasUniqueStrings(queryPlanIds) ||
        !hasOneQueryPlanPerBrief(result.queryPlans, expectedBriefIds) ||
        result.queryPlans.some(
          (plan) =>
            plan.category !== request.category ||
            plan.providerOrder.some((providerId) => !allowedProviders.has(providerId)),
        )
      ) {
        throw new Error(
          'CandidateEvidenceAgent가 Brief별 계획 예산, queryPlanId 또는 승인 Provider 경계를 벗어났습니다.',
        );
      }
    }
  }
  if (request.role === 'CATEGORY_ARBITER' && result.role === 'CATEGORY_ARBITER') {
    const contract = result.contract;
    if (
      contract.category !== request.category ||
      contract.charterVersion !== request.charter.charterVersion ||
      contract.proposalSetVersion !== request.proposalSet.proposalSetVersion ||
      contract.deterministicSelectedProposalId !== request.deterministicSelection.selectedProposalId ||
      !sameStringSet(contract.ballotIds, request.ballots.map((ballot) => ballot.ballotId))
    ) {
      throw new Error('CategoryArbiterAgent가 결정론 선택 또는 활성 계약 버전을 변경했습니다.');
    }
  }
  if (request.role === 'TRIP_ORCHESTRATOR' && result.role === 'TRIP_ORCHESTRATOR') {
    if (
      !sameStringSet(
        result.report.observedContractIds,
        request.categoryContracts.map((contract) => contract.contractId),
      ) ||
      (request.guardChecks.some((check) => !check.passed) && result.report.guardStatus !== 'HOLD')
    ) {
      throw new Error('TripOrchestratorAgent가 계약 범위 또는 실패한 guard를 변경했습니다.');
    }
  }
  if (request.role === 'PLAN_FINALIZER' && result.role === 'PLAN_FINALIZER') {
    assertPlanFinalizerCeiling(request, result);
  }
}

export interface AgentRuntime {
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}

export class AgentRuntimeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'AgentRuntimeError';
  }
}

export interface CodexGatewayAgentRuntimeOptions {
  client: CodexGatewayClient;
  promptVersion?: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  modelProfiles?: Partial<Record<AgentRole, CodexGatewayModelProfile>>;
  reasoningEfforts?: Partial<Record<AgentRole, 'low' | 'medium' | 'high'>>;
}

export class CodexGatewayAgentRuntime implements AgentRuntime {
  private readonly promptVersion: string;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;

  constructor(private readonly options: CodexGatewayAgentRuntimeOptions) {
    this.promptVersion = options.promptVersion ?? 'canonical-v1';
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxOutputTokens = options.maxOutputTokens ?? 4_096;
  }

  async run(rawRequest: AgentRunRequest): Promise<AgentRunResult> {
    const request = agentRunRequestSchema.parse(rawRequest);
    assertAgentContextSafe(request);
    const category = categoryOf(request);
    const participantId = participantIdOf(request);
    const modelProfile =
      this.options.modelProfiles?.[request.role] ?? defaultModelProfiles[request.role];
    const reasoningEffort =
      this.options.reasoningEfforts?.[request.role] ?? defaultReasoningEfforts[request.role];
    let response;
    try {
      response = await this.options.client.run({
        schemaVersion: 1,
        runId: request.runId,
        tripId: request.tripId,
        planVersion: request.inputVersion,
        agent: {
          role: request.role,
          instanceId: [request.role.toLowerCase(), category, participantId].filter(Boolean).join('.'),
          ...(participantId === undefined ? {} : { participantId }),
          ...(category === undefined ? {} : { category }),
          promptVersion: this.promptVersion,
          inputContractVersion: 'agent-runtime.v1',
          outputContractVersion: 'agent-runtime.v1',
        },
        thread: { mode: 'NEW' },
        modelProfile,
        reasoningEffort,
        input: {
          instruction: roleInstructions[request.role],
          context: { ...request, planVersion: request.inputVersion },
          evidenceIds: collectEvidenceIds(request),
        },
        outputSchema: outputJsonSchema(request),
        limits: { timeoutMs: this.timeoutMs, maxOutputTokens: this.maxOutputTokens },
      });
    } catch {
      throw new AgentRuntimeError('GATEWAY_TRANSPORT_FAILED', 'Codex Gateway 호출에 실패했습니다.');
    }
    if (response.runId !== request.runId) {
      throw new AgentRuntimeError(
        'GATEWAY_RUN_ID_MISMATCH',
        'Codex Gateway 응답 runId가 요청과 일치하지 않습니다.',
      );
    }
    if (response.status !== 'SUCCEEDED' || response.output === null || response.output === undefined) {
      throw new AgentRuntimeError(
        response.error?.code ?? response.status,
        response.error?.safeMessage ?? 'Codex Gateway가 Agent 결과를 반환하지 않았습니다.',
      );
    }
    if (response.authContext.loginMethod !== 'CHATGPT') {
      throw new AgentRuntimeError(
        'UNSUPPORTED_AUTH_METHOD',
        'Canonical Agent Runtime은 로컬 ChatGPT Codex OAuth만 허용합니다.',
      );
    }
    if (response.threadId === null || response.threadId === undefined) {
      throw new AgentRuntimeError(
        'GATEWAY_THREAD_MISSING',
        'Codex Gateway 성공 응답에 격리된 threadId가 없습니다.',
      );
    }
    if (response.modelContext?.reasoningEffort !== reasoningEffort) {
      throw new AgentRuntimeError(
        'GATEWAY_MODEL_CONTEXT_MISMATCH',
        'Codex Gateway가 요청한 reasoning effort를 보존하지 않았습니다.',
      );
    }
    const result = agentRunResultSchema.parse(response.output);
    assertResultMatchesRequest(request, result);
    assertAgentContextSafe(result);
    return result;
  }
}

function runUserProxySearchBrief(
  request: UserProxySearchBriefRequest,
): UserProxySearchBriefResult {
  const hardFacts = request.participant.facts.filter((fact) => fact.hard);
  const preferenceFacts = request.participant.facts.filter((fact) => !fact.hard);
  const desiredTraits = request.participant.facts
    .filter((fact) => fact.polarity !== 'AVOID')
    .map((fact) => fact.statement);
  const searchTerms = unique([
    ...desiredTraits,
    `${request.charter.destination} ${request.category}`,
  ]);
  return userProxySearchBriefResultSchema.parse({
    schemaVersion: 1,
    role: 'USER_PROXY',
    task: 'CREATE_SEARCH_BRIEF',
    brief: {
      schemaVersion: 1,
      briefId: `brief:${request.participant.participantId}:${request.category}:1`,
      participantId: request.participant.participantId,
      category: request.category,
      profileVersion: request.participant.profileVersion,
      mustKeepRefs: hardFacts.map((fact) => fact.factId),
      preferenceTargetRefs: preferenceFacts.map((fact) => fact.factId),
      desiredTraits,
      avoidTraits: request.participant.facts
        .filter((fact) => fact.polarity === 'AVOID')
        .map((fact) => fact.statement),
      tradeoffs: [],
      searchTerms,
    },
  });
}

function runUserProxyBallot(request: UserProxyBallotRequest): UserProxyBallotResult {
  const proposalIds = request.proposalSet.proposals.map((proposal) => proposal.proposalId).sort();
  const evaluationIds = request.evaluations.map((evaluation) => evaluation.proposalId).sort();
  if (JSON.stringify(proposalIds) !== JSON.stringify(evaluationIds)) {
    throw new Error('UserProxyAgent 평가는 활성 Proposal 전체와 정확히 일치해야 합니다.');
  }
  const evaluations = [...request.evaluations].sort(
    (left, right) =>
      right.satisfactionBp - left.satisfactionBp ||
      left.proposalId.localeCompare(right.proposalId),
  );
  return userProxyBallotResultSchema.parse({
    schemaVersion: 1,
    role: 'USER_PROXY',
    task: 'CREATE_BALLOT',
    ballot: {
      schemaVersion: 1,
      ballotId: `ballot:${request.participant.participantId}:${request.category}:${request.proposalSet.proposalSetVersion}`,
      participantId: request.participant.participantId,
      category: request.category,
      proposalSetVersion: request.proposalSet.proposalSetVersion,
      rankedProposalIds: evaluations.map((evaluation) => evaluation.proposalId),
      satisfactionByProposalBp: Object.fromEntries(
        evaluations.map((evaluation) => [evaluation.proposalId, evaluation.satisfactionBp]),
      ),
      stanceByProposal: Object.fromEntries(
        evaluations.map((evaluation) => [evaluation.proposalId, evaluation.stance]),
      ),
      profileFactRefs: unique(evaluations.flatMap((evaluation) => evaluation.profileFactRefs)),
      conditionalTerms: unique(evaluations.flatMap((evaluation) => evaluation.conditionalTerms)),
      rationale: '코드가 계산한 동일 버전 전체 Proposal 평가를 순위화했습니다.',
      evidenceChallenges: [],
      candidateGapRequest: null,
    },
  });
}

const queryClassByCategory: Record<CandidateEvidenceRequest['category'], string> = {
  long_distance: 'flight.offers_search',
  stay: 'hotel.search',
  activity: 'poi.search',
  dining: 'dining.search',
  schedule: 'geo.matrix',
};

function runCandidateEvidence(request: CandidateEvidenceRequest): CandidateEvidenceResult {
  const inputs = [
    ...request.briefs.map((brief) => ({ briefId: brief.briefId, searchTerms: brief.searchTerms })),
    { briefId: request.neutralBrief.briefId, searchTerms: request.neutralBrief.searchTerms },
  ];
  const grouped = new Map<string, { sourceBriefIds: string[]; searchTerms: string[] }>();
  for (const input of inputs) {
    const key = JSON.stringify([...input.searchTerms].sort());
    const existing = grouped.get(key);
    if (existing === undefined) {
      grouped.set(key, { sourceBriefIds: [input.briefId], searchTerms: input.searchTerms });
    } else {
      existing.sourceBriefIds.push(input.briefId);
    }
  }
  return candidateEvidenceResultSchema.parse({
    schemaVersion: 1,
    role: 'CANDIDATE_EVIDENCE',
    status: 'QUERY_PLAN_PROPOSED',
    queryPlans: [...grouped.values()].map((group, index) => ({
      schemaVersion: 1,
      queryPlanId: `${request.runId}:${request.category}:query:${request.searchAttempt}:${index + 1}`,
      category: request.category,
      sourceBriefIds: group.sourceBriefIds,
      queryClass: queryClassByCategory[request.category],
      providerOrder: request.availableProviderIds,
      searchTerms: group.searchTerms,
      params: { searchAttempt: request.searchAttempt },
      relaxationChanges: [],
      rationale: 'Proxy별 Brief와 중립 Brief를 같은 호출 예산으로 변환했습니다.',
    })),
    warning: null,
  });
}

function runCategoryArbiter(request: CategoryArbiterRequest): CategoryArbiterResult {
  const selectedId = request.deterministicSelection.selectedProposalId;
  const selectedExists = request.proposalSet.proposals.some(
    (proposal) => proposal.proposalId === selectedId,
  );
  const outcome = selectedExists ? 'CONCLUDED' : 'NO_SAFE_DECISION';
  return categoryArbiterResultSchema.parse({
    schemaVersion: 1,
    role: 'CATEGORY_ARBITER',
    contract: {
      schemaVersion: 1,
      contractId: `contract:${request.tripId}:${request.category}:${request.proposalSet.proposalSetVersion}`,
      contractVersion: 1,
      category: request.category,
      charterVersion: request.charter.charterVersion,
      proposalSetVersion: request.proposalSet.proposalSetVersion,
      outcome,
      selectedProposalId: selectedExists ? selectedId : null,
      deterministicSelectedProposalId: selectedExists ? selectedId : null,
      rejectedProposalIds: request.proposalSet.proposals
        .map((proposal) => proposal.proposalId)
        .filter((proposalId) => proposalId !== selectedId),
      ballotIds: request.ballots.map((ballot) => ballot.ballotId),
      summary: selectedExists
        ? '결정론적 leximin 선택을 변경 없이 채택했습니다.'
        : '결정론 선택이 활성 ProposalSet에 없습니다.',
      unresolvedIssues: selectedExists ? [] : ['DETERMINISTIC_SELECTION_MISSING'],
      obligationsForNextCategory: [],
      blockReason: selectedExists ? null : '안전하게 채택할 Proposal이 없습니다.',
      evidenceIds: unique(request.receipts.flatMap((receipt) => receipt.evidenceIds)),
    },
  });
}

function runTripOrchestrator(request: TripOrchestratorRequest): TripOrchestratorResult {
  const failed = request.guardChecks.filter((check) => !check.passed);
  return tripOrchestratorResultSchema.parse({
    schemaVersion: 1,
    role: 'TRIP_ORCHESTRATOR',
    report: {
      schemaVersion: 1,
      reportId: `orchestrator:${request.tripId}:${request.inputVersion}`,
      guardStatus: failed.length === 0 ? 'CLEAR' : 'HOLD',
      observedContractIds: request.categoryContracts.map((contract) => contract.contractId),
      findings: failed.map((check) => ({
        code: check.code,
        severity: 'error',
        message: check.message,
        refs: check.refs,
      })),
      recheckTargets: unique(failed.flatMap((check) => check.refs)),
      summary: failed.length === 0 ? '전역 가드가 명시적 위반을 찾지 못했습니다.' : '전역 가드 위반으로 보류합니다.',
      evidenceIds: request.evidence.map((item) => item.evidenceId),
    },
  });
}

function runPlanFinalizer(request: PlanFinalizerRequest): PlanFinalizerResult {
  const blockedContract = request.categoryContracts.some(
    (contract) => contract.outcome === 'NO_SAFE_DECISION',
  );
  const requiredEvidenceIds = unique([
    ...request.categoryContracts.flatMap((contract) => contract.evidenceIds),
    ...request.orchestratorReport.evidenceIds,
  ]);
  const evidenceById = new Map(request.evidence.map((evidence) => [evidence.evidenceId, evidence]));
  const verifiedEvidenceComplete = requiredEvidenceIds.length > 0 &&
    requiredEvidenceIds.every((evidenceId) => {
      const evidence = evidenceById.get(evidenceId);
      return evidence?.status === 'PASS' && evidence.confidence === 'live';
    });
  const contractUnresolvedIssues = request.categoryContracts.flatMap(
    (contract) => contract.unresolvedIssues,
  );
  const needsUserChoice = request.orchestratorReport.guardStatus === 'RECHECK' ||
    request.categoryContracts.some((contract) => contract.outcome === 'CONTINUE') ||
    contractUnresolvedIssues.length > 0;
  const unresolvedIssues = unique([
    ...contractUnresolvedIssues,
    ...(request.evidenceMode === 'LIVE' ? [] : ['NON_LIVE_EVIDENCE']),
    ...(request.evidenceMode === 'LIVE' && !verifiedEvidenceComplete
      ? ['EVIDENCE_NOT_VERIFIED']
      : []),
  ]);
  const status = blockedContract || request.orchestratorReport.guardStatus === 'HOLD'
    ? 'BLOCKED'
    : needsUserChoice
      ? 'NEEDS_USER_CHOICE'
      : request.evidenceMode === 'LIVE' && verifiedEvidenceComplete
        ? 'VERIFIED'
        : 'PROVISIONAL';
  return planFinalizerResultSchema.parse({
    schemaVersion: 1,
    role: 'PLAN_FINALIZER',
    finalPlan: {
      schemaVersion: 1,
      finalPlanId: `final:${request.tripId}:${request.inputVersion}`,
      finalPlanVersion: 1,
      tripId: request.tripId,
      status,
      evidenceMode: request.evidenceMode,
      categoryDecisionContractIds: request.categoryContracts.map((contract) => contract.contractId),
      orchestratorReportId: request.orchestratorReport.reportId,
      evidenceIds: request.evidence.map((item) => item.evidenceId),
      unresolvedIssues,
      summary: status === 'PROVISIONAL'
        ? '계약 경로는 완료됐지만 실제 Provider 검증 전이므로 잠정 결과입니다.'
        : '계약 연속성과 전역 감사 결과를 반영했습니다.',
    },
  });
}

export class FixtureAgentRuntime implements AgentRuntime {
  async run(rawRequest: AgentRunRequest): Promise<AgentRunResult> {
    const request = agentRunRequestSchema.parse(rawRequest);
    assertAgentContextSafe(request);
    const result = request.role === 'USER_PROXY'
      ? request.task === 'CREATE_SEARCH_BRIEF'
        ? runUserProxySearchBrief(request)
        : runUserProxyBallot(request)
      : request.role === 'CANDIDATE_EVIDENCE'
        ? runCandidateEvidence(request)
        : request.role === 'CATEGORY_ARBITER'
          ? runCategoryArbiter(request)
          : request.role === 'TRIP_ORCHESTRATOR'
            ? runTripOrchestrator(request)
            : runPlanFinalizer(request);
    const parsed = agentRunResultSchema.parse(result);
    assertResultMatchesRequest(request, parsed);
    assertAgentContextSafe(parsed);
    return parsed;
  }
}
