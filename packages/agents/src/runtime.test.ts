import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  agentRoles,
  type AgentRunRequest,
  type CandidateEvidenceRequest,
  type CategoryArbiterRequest,
  type CategoryProposalSet,
  type CodexGatewayAgentRunRequest,
  type CodexGatewayAgentRunResult,
  type PlanFinalizerRequest,
  type ProxySearchBrief,
  type TripOrchestratorRequest,
  type TripCharter,
  type UserProxyBallotRequest,
  type UserProxySearchBriefRequest,
} from '@tm/contracts';
import type { CodexGatewayClient } from './codex-gateway.js';
import {
  AgentRuntimeError,
  CodexGatewayAgentRuntime,
  FixtureAgentRuntime,
} from './runtime.js';

const charter: TripCharter = {
  schemaVersion: 1,
  charterVersion: 'charter:1',
  destination: '오사카',
  startDate: '2026-10-16',
  endDate: '2026-10-19',
  participantIds: ['u1', 'u2', 'u3'],
  partySize: 3,
  pace: 'balanced',
  budgetMaxByParticipantKrw: { u1: 300_000, u2: 400_000, u3: 500_000 },
};

function searchBriefRequest(
  participantId = 'u1',
  statement = '난바 접근성',
): UserProxySearchBriefRequest {
  return {
    schemaVersion: 1,
    role: 'USER_PROXY',
    task: 'CREATE_SEARCH_BRIEF',
    runId: 'run:1',
    tripId: 'trip:1',
    inputVersion: 1,
    category: 'stay',
    participant: {
      participantId,
      profileVersion: `profile:${participantId}:1`,
      facts: [
        { factId: `fact:${participantId}:preference`, statement, importance: 5, hard: false, polarity: 'PREFER' },
        { factId: `fact:${participantId}:hard`, statement: '도미토리 제외', importance: 5, hard: true, polarity: 'AVOID' },
      ],
      budgetMaxKrw: charter.budgetMaxByParticipantKrw[participantId] ?? 300_000,
    },
    charter,
    priorContractRefs: [],
  };
}

function candidateEvidenceRequest(): CandidateEvidenceRequest {
  const briefs: ProxySearchBrief[] = ['u1', 'u2', 'u3'].map((participantId, index) => ({
    schemaVersion: 1,
    briefId: `brief:${participantId}:stay:1`,
    participantId,
    category: 'stay',
    profileVersion: `profile:${participantId}:1`,
    mustKeepRefs: [],
    preferenceTargetRefs: [`fact:${participantId}:preference`],
    desiredTraits: [`선호 ${index + 1}`],
    avoidTraits: [],
    tradeoffs: [],
    searchTerms: [`오사카 숙소 선호 ${index + 1}`],
  }));
  return {
    schemaVersion: 1,
    role: 'CANDIDATE_EVIDENCE',
    runId: 'run:1',
    tripId: 'trip:1',
    inputVersion: 1,
    category: 'stay',
    briefs,
    neutralBrief: {
      schemaVersion: 1,
      briefId: 'brief:neutral:stay:1',
      category: 'stay',
      charterVersion: charter.charterVersion,
      hardConstraintRefs: [],
      searchTerms: ['오사카 3인 숙소'],
    },
    availableProviderIds: ['rakuten_travel'],
    searchAttempt: 0,
    currentCandidateIds: [],
  };
}

function proposalSetFixture(): CategoryProposalSet {
  return {
    schemaVersion: 1,
    proposalSetId: 'proposal-set:stay:1',
    category: 'stay',
    proposalSetVersion: 1,
    candidatePoolVersion: 1,
    proposals: [
      {
        schemaVersion: 1,
        proposalId: 'stay:a',
        category: 'stay',
        proposalSetVersion: 1,
        summary: '난바 중심 숙소',
        candidateIds: ['candidate:stay:a'],
        costByParticipantKrw: { u1: 100_000, u2: 100_000, u3: 100_000 },
        capacityPlan: {
          requestedPartySize: 3,
          confirmedCapacity: 3,
          allocations: [
            {
              resourceUnitId: 'room:stay:a',
              confirmedCapacity: 3,
              assignedParticipantIds: ['u1', 'u2', 'u3'],
            },
          ],
          unassignedParticipantIds: [],
          evidenceIds: ['evidence:stay:a'],
          splitAuthorityRef: null,
        },
        violatedConstraintIds: [],
        evidenceIds: ['evidence:stay:a'],
        attributesBp: {},
        concessionByParticipantBp: { u1: 1_000, u2: 1_000, u3: 1_000 },
        totalCostKrw: 300_000,
        travelBurdenMinutes: 20,
        cancellationScoreBp: 7_000,
        evidenceQualityBp: 4_000,
      },
    ],
    sealedAt: '2026-08-14T00:00:00.000Z',
  };
}

function ballotRequest(): UserProxyBallotRequest {
  return {
    schemaVersion: 1,
    role: 'USER_PROXY',
    task: 'CREATE_BALLOT',
    runId: 'run:ballot:1',
    tripId: 'trip:1',
    inputVersion: 1,
    category: 'stay',
    participant: searchBriefRequest().participant,
    proposalSet: proposalSetFixture(),
    evaluations: [
      {
        proposalId: 'stay:a',
        satisfactionBp: 9_000,
        stance: 'support',
        profileFactRefs: ['fact:u1:preference'],
        evidenceIds: ['evidence:stay:a'],
        conditionalTerms: [],
      },
    ],
    evidence: [],
  };
}

function categoryArbiterRequest(): CategoryArbiterRequest {
  const proposalSet = proposalSetFixture();
  return {
    schemaVersion: 1,
    role: 'CATEGORY_ARBITER',
    runId: 'run:arbiter:1',
    tripId: 'trip:1',
    inputVersion: 1,
    category: 'stay',
    charter,
    proposalSet,
    ballots: [
      {
        schemaVersion: 1,
        ballotId: 'ballot:u1:stay:1',
        participantId: 'u1',
        category: 'stay',
        proposalSetVersion: 1,
        rankedProposalIds: ['stay:a'],
        satisfactionByProposalBp: { 'stay:a': 9_000 },
        stanceByProposal: { 'stay:a': 'support' },
        profileFactRefs: ['fact:u1:preference'],
        conditionalTerms: [],
        rationale: 'fixture ballot',
        evidenceChallenges: [],
        candidateGapRequest: null,
      },
    ],
    deterministicSelection: {
      schemaVersion: 1,
      selectedProposalId: 'stay:a',
      rankedProposalIds: ['stay:a'],
      satisfactionVectorByProposal: { 'stay:a': [9_000] },
      decidedBy: 'LEXIMIN',
      trace: ['fixture selection'],
    },
    receipts: [],
    priorObligations: [],
  };
}

async function canonicalRoleRequests(): Promise<AgentRunRequest[]> {
  const fixture = new FixtureAgentRuntime();
  const arbiterRequest = categoryArbiterRequest();
  const arbiterResult = await fixture.run(arbiterRequest);
  if (arbiterResult.role !== 'CATEGORY_ARBITER') throw new Error('Arbiter fixture가 아닙니다.');
  const orchestratorRequest: TripOrchestratorRequest = {
    schemaVersion: 1,
    role: 'TRIP_ORCHESTRATOR',
    runId: 'run:orchestrator:1',
    tripId: 'trip:1',
    inputVersion: 1,
    charter,
    categoryContracts: [arbiterResult.contract],
    guardChecks: [
      { code: 'SELECTION_ALIGNED', passed: true, message: '선택 일치', refs: ['stay:a'] },
    ],
    evidence: [],
  };
  const orchestratorResult = await fixture.run(orchestratorRequest);
  if (orchestratorResult.role !== 'TRIP_ORCHESTRATOR') {
    throw new Error('Orchestrator fixture가 아닙니다.');
  }
  const finalizerRequest: PlanFinalizerRequest = {
    schemaVersion: 1,
    role: 'PLAN_FINALIZER',
    runId: 'run:finalizer:1',
    tripId: 'trip:1',
    inputVersion: 1,
    charter,
    categoryContracts: [arbiterResult.contract],
    orchestratorReport: orchestratorResult.report,
    evidenceMode: 'FIXTURE',
    evidence: [],
  };
  return [
    searchBriefRequest(),
    candidateEvidenceRequest(),
    arbiterRequest,
    orchestratorRequest,
    finalizerRequest,
  ];
}

function runtimeReturning(output: Record<string, unknown>): CodexGatewayAgentRuntime {
  const client: CodexGatewayClient = {
    async ready() {
      return { ready: true, authMode: 'chatgpt', modelCount: 1, allowedModelCount: 1, allowlistConfigured: true };
    },
    async listModels() {
      return { fetchedAt: '2026-08-14T00:00:00.000Z', models: [] };
    },
    async run(request) {
      return successfulGatewayResult(request, output);
    },
  };
  return new CodexGatewayAgentRuntime({ client });
}

function successfulGatewayResult(
  request: CodexGatewayAgentRunRequest,
  output: Record<string, unknown>,
): CodexGatewayAgentRunResult {
  return {
    runId: request.runId,
    status: 'SUCCEEDED',
    authContext: { loginMethod: 'CHATGPT', authFingerprint: 'fixture-fingerprint' },
    modelContext: {
      model: 'fixture-model',
      reasoningEffort: request.reasoningEffort,
      catalogFetchedAt: '2026-08-14T00:00:00.000Z',
    },
    threadId: 'thread:1',
    output,
    usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 10 },
    repairUsed: false,
  };
}

test('공식 Agent role은 승인된 다섯 종류뿐이다', () => {
  assert.deepEqual(agentRoles, [
    'USER_PROXY',
    'CANDIDATE_EVIDENCE',
    'CATEGORY_ARBITER',
    'TRIP_ORCHESTRATOR',
    'PLAN_FINALIZER',
  ]);
});

test('Fixture UserProxy는 자기 프로필만으로 서로 다른 SearchBrief를 만든다', async () => {
  const runtime = new FixtureAgentRuntime();
  const first = await runtime.run(searchBriefRequest('u1', '난바 접근성'));
  const second = await runtime.run(searchBriefRequest('u2', '조용하고 넓은 객실'));
  assert.equal(first.role, 'USER_PROXY');
  assert.equal(second.role, 'USER_PROXY');
  if (first.role !== 'USER_PROXY' || first.task !== 'CREATE_SEARCH_BRIEF') return;
  if (second.role !== 'USER_PROXY' || second.task !== 'CREATE_SEARCH_BRIEF') return;
  assert.notDeepEqual(first.brief.searchTerms, second.brief.searchTerms);
  assert.equal(JSON.stringify(first).includes('u2'), false);
  assert.equal(JSON.stringify(second).includes('u1'), false);
});

test('CandidateEvidence는 Proxy Brief와 중립 Brief를 모두 QueryPlan lineage에 남긴다', async () => {
  const runtime = new FixtureAgentRuntime();
  const briefs: ProxySearchBrief[] = [];
  for (const [participantId, statement] of [
    ['u1', '난바 접근성'],
    ['u2', '조용하고 넓은 객실'],
    ['u3', '대욕장'],
  ] as const) {
    const result = await runtime.run(searchBriefRequest(participantId, statement));
    if (result.role !== 'USER_PROXY' || result.task !== 'CREATE_SEARCH_BRIEF') {
      throw new Error('SearchBrief fixture 결과가 아닙니다.');
    }
    briefs.push(result.brief);
  }
  const result = await runtime.run({
    schemaVersion: 1,
    role: 'CANDIDATE_EVIDENCE',
    runId: 'run:1',
    tripId: 'trip:1',
    inputVersion: 1,
    category: 'stay',
    briefs,
    neutralBrief: {
      schemaVersion: 1,
      briefId: 'brief:neutral:stay:1',
      category: 'stay',
      charterVersion: charter.charterVersion,
      hardConstraintRefs: [],
      searchTerms: ['오사카 3인 숙소'],
    },
    availableProviderIds: ['rakuten_travel', 'tourapi'],
    searchAttempt: 0,
    currentCandidateIds: [],
  });
  assert.equal(result.role, 'CANDIDATE_EVIDENCE');
  if (result.role !== 'CANDIDATE_EVIDENCE') return;
  const sourceBriefIds = new Set(result.queryPlans.flatMap((plan) => plan.sourceBriefIds));
  assert.deepEqual(
    [...sourceBriefIds].sort(),
    [...briefs.map((brief) => brief.briefId), 'brief:neutral:stay:1'].sort(),
  );
});

test('Codex CandidateEvidence 결과는 queryPlanId가 고유해야 한다', async () => {
  const request = candidateEvidenceRequest();
  const fixtureResult = await new FixtureAgentRuntime().run(request);
  if (fixtureResult.role !== 'CANDIDATE_EVIDENCE') {
    throw new Error('CandidateEvidence fixture 결과가 아닙니다.');
  }
  const firstPlanId = fixtureResult.queryPlans[0]?.queryPlanId;
  if (firstPlanId === undefined) throw new Error('CandidateEvidence QueryPlan이 없습니다.');
  const output = {
    ...fixtureResult,
    queryPlans: fixtureResult.queryPlans.map((plan, index) =>
      index === 1 ? { ...plan, queryPlanId: firstPlanId } : plan),
  };
  await assert.rejects(
    () => runtimeReturning(output).run(request),
    /Brief별 계획 예산, queryPlanId 또는 승인 Provider 경계를 벗어났습니다/,
  );
});

test('Codex CandidateEvidence 결과는 같은 Brief를 여러 QueryPlan에 재배정하지 않는다', async () => {
  const request = candidateEvidenceRequest();
  const fixtureResult = await new FixtureAgentRuntime().run(request);
  if (fixtureResult.role !== 'CANDIDATE_EVIDENCE') {
    throw new Error('CandidateEvidence fixture 결과가 아닙니다.');
  }
  const firstBriefId = request.briefs[0]?.briefId;
  if (firstBriefId === undefined) throw new Error('ProxySearchBrief가 없습니다.');
  const output = {
    ...fixtureResult,
    queryPlans: fixtureResult.queryPlans.map((plan, index) =>
      index === 1
        ? { ...plan, sourceBriefIds: [...plan.sourceBriefIds, firstBriefId] }
        : plan),
  };
  await assert.rejects(
    () => runtimeReturning(output).run(request),
    /Brief별 계획 예산, queryPlanId 또는 승인 Provider 경계를 벗어났습니다/,
  );
});

test('Codex Runtime은 공식 role과 최소 투영을 Gateway 계약으로 보낸다', async () => {
  let captured: CodexGatewayAgentRunRequest | undefined;
  const request = searchBriefRequest();
  const output = await new FixtureAgentRuntime().run(request);
  const client: CodexGatewayClient = {
    async ready() {
      return { ready: true, authMode: 'chatgpt', modelCount: 1, allowedModelCount: 1, allowlistConfigured: true };
    },
    async listModels() {
      return { fetchedAt: '2026-08-14T00:00:00.000Z', models: [] };
    },
    async run(gatewayRequest) {
      captured = gatewayRequest;
      return successfulGatewayResult(gatewayRequest, output);
    },
  };
  const runtime = new CodexGatewayAgentRuntime({ client });
  const result = await runtime.run(request);
  assert.equal(result.role, 'USER_PROXY');
  assert.equal(captured?.agent.role, 'USER_PROXY');
  assert.equal(captured?.agent.category, 'stay');
  assert.equal(captured?.agent.participantId, 'u1');
  assert.equal(captured?.thread.mode, 'NEW');
  assert.equal(JSON.stringify(captured).includes('apiKey'), false);
  assert.equal((captured?.outputSchema['additionalProperties'] as unknown), false);
});

test('Codex Runtime은 다섯 역할의 실행 메타데이터와 planVersion을 같은 Gateway 계약에 보존한다', async () => {
  const fixture = new FixtureAgentRuntime();
  const expectedProfile = {
    USER_PROXY: ['FAST', 'low'],
    CANDIDATE_EVIDENCE: ['BALANCED', 'medium'],
    CATEGORY_ARBITER: ['DEEP_REASONING', 'high'],
    TRIP_ORCHESTRATOR: ['DEEP_REASONING', 'high'],
    PLAN_FINALIZER: ['BALANCED', 'medium'],
  } as const;
  for (const request of await canonicalRoleRequests()) {
    const output = await fixture.run(request);
    let captured: CodexGatewayAgentRunRequest | undefined;
    const client: CodexGatewayClient = {
      async ready() {
        return { ready: true, authMode: 'chatgpt', modelCount: 1, allowedModelCount: 1, allowlistConfigured: true };
      },
      async listModels() {
        return { fetchedAt: '2026-08-14T00:00:00.000Z', models: [] };
      },
      async run(gatewayRequest) {
        captured = gatewayRequest;
        return successfulGatewayResult(gatewayRequest, output);
      },
    };
    const result = await new CodexGatewayAgentRuntime({ client }).run(request);
    assert.equal(result.role, request.role);
    assert.equal(captured?.schemaVersion, 1);
    assert.equal(captured?.agent.role, request.role);
    assert.equal(captured?.agent.promptVersion, 'canonical-v1');
    assert.equal(captured?.agent.inputContractVersion, 'agent-runtime.v1');
    assert.equal(captured?.agent.outputContractVersion, 'agent-runtime.v1');
    assert.equal(captured?.modelProfile, expectedProfile[request.role][0]);
    assert.equal(captured?.reasoningEffort, expectedProfile[request.role][1]);
    assert.equal(captured?.thread.mode, 'NEW');
    assert.equal(captured?.input.context['planVersion'], request.inputVersion);
  }
});

test('Codex Runtime의 모든 역할·task 출력 Schema는 Codex strict structured-output subset을 지킨다', async () => {
  function assertStrictSchema(value: unknown, path = '$'): void {
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertStrictSchema(item, `${path}[${index}]`));
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const node = value as Record<string, unknown>;
    if ('const' in node || 'enum' in node) {
      assert.equal(typeof node['type'], 'string', `${path} const/enum에는 type이 필요합니다.`);
    }
    assert.equal('oneOf' in node, false, `${path}는 oneOf 대신 anyOf를 사용해야 합니다.`);
    if (node['type'] === 'object') {
      assert.equal(node['additionalProperties'], false, `${path} 객체는 strict여야 합니다.`);
      const properties = node['properties'];
      const required = node['required'];
      assert.equal(typeof properties, 'object', `${path} 객체에는 properties가 필요합니다.`);
      assert.ok(Array.isArray(required), `${path} 객체에는 required가 필요합니다.`);
      assert.deepEqual(
        [...required as string[]].sort(),
        Object.keys(properties as Record<string, unknown>).sort(),
        `${path} 객체의 모든 property가 required여야 합니다.`,
      );
    }
    for (const [key, child] of Object.entries(node)) {
      assertStrictSchema(child, `${path}.${key}`);
    }
  }

  const fixture = new FixtureAgentRuntime();
  for (const request of [...await canonicalRoleRequests(), ballotRequest()]) {
    const output = await fixture.run(request);
    let captured: CodexGatewayAgentRunRequest | undefined;
    const client: CodexGatewayClient = {
      async ready() {
        return { ready: true, authMode: 'chatgpt', modelCount: 1, allowedModelCount: 1, allowlistConfigured: true };
      },
      async listModels() {
        return { fetchedAt: '2026-08-14T00:00:00.000Z', models: [] };
      },
      async run(gatewayRequest) {
        captured = gatewayRequest;
        return successfulGatewayResult(gatewayRequest, output);
      },
    };
    await new CodexGatewayAgentRuntime({ client }).run(request);
    if (captured === undefined) throw new Error('Gateway request가 캡처되지 않았습니다.');
    assertStrictSchema(captured.outputSchema);
  }
});

test('Codex Runtime은 다섯 역할 각각의 출력 Zod 계약을 통과하지 못한 응답을 거부한다', async () => {
  const fixture = new FixtureAgentRuntime();
  const payloadKey = {
    USER_PROXY: 'brief',
    CANDIDATE_EVIDENCE: 'queryPlans',
    CATEGORY_ARBITER: 'contract',
    TRIP_ORCHESTRATOR: 'report',
    PLAN_FINALIZER: 'finalPlan',
  } as const;
  for (const request of await canonicalRoleRequests()) {
    const invalid: Record<string, unknown> = { ...(await fixture.run(request)) };
    delete invalid[payloadKey[request.role]];
    await assert.rejects(() => runtimeReturning(invalid).run(request));
  }
});

test('Codex Runtime은 입력에 없던 evidence ID를 fake Gateway 응답에서도 거부한다', async () => {
  const request = (await canonicalRoleRequests()).find(
    (item): item is PlanFinalizerRequest => item.role === 'PLAN_FINALIZER',
  );
  if (request === undefined) throw new Error('Finalizer request가 없습니다.');
  const output = await new FixtureAgentRuntime().run(request);
  if (output.role !== 'PLAN_FINALIZER') throw new Error('Finalizer fixture가 아닙니다.');
  await assert.rejects(
    () => runtimeReturning({
      ...output,
      finalPlan: { ...output.finalPlan, evidenceIds: ['evidence:invented'] },
    }).run(request),
    /입력에 없는 Evidence ID/,
  );
});

test('Codex UserProxy는 fake Gateway 응답에서도 다른 참가자 profile projection을 참조하지 못한다', async () => {
  const request = searchBriefRequest();
  const output = await new FixtureAgentRuntime().run(request);
  if (output.role !== 'USER_PROXY' || output.task !== 'CREATE_SEARCH_BRIEF') {
    throw new Error('UserProxy fixture가 아닙니다.');
  }
  await assert.rejects(
    () => runtimeReturning({
      ...output,
      brief: {
        ...output.brief,
        participantId: 'u2',
        preferenceTargetRefs: ['fact:u2:private'],
      },
    }).run(request),
    /자기 참가자·카테고리·프로필 경계/,
  );
});

test('Codex Runtime은 CategoryArbiter가 결정론 선택을 바꾼 응답을 거부한다', async () => {
  const request = categoryArbiterRequest();
  const output = await new FixtureAgentRuntime().run(request);
  if (output.role !== 'CATEGORY_ARBITER') throw new Error('Arbiter fixture가 아닙니다.');
  await assert.rejects(
    () => runtimeReturning({
      ...output,
      contract: {
        ...output.contract,
        selectedProposalId: 'stay:other',
        deterministicSelectedProposalId: 'stay:other',
      },
    }).run(request),
    /결정론 선택/,
  );
});

test('Codex TripOrchestrator는 실패한 deterministic guard를 CLEAR로 바꾸지 못한다', async () => {
  const request = (await canonicalRoleRequests()).find(
    (item): item is TripOrchestratorRequest => item.role === 'TRIP_ORCHESTRATOR',
  );
  if (request === undefined) throw new Error('Orchestrator request가 없습니다.');
  const failedRequest: TripOrchestratorRequest = {
    ...request,
    guardChecks: request.guardChecks.map((check) => ({ ...check, passed: false })),
  };
  const output = await new FixtureAgentRuntime().run(failedRequest);
  if (output.role !== 'TRIP_ORCHESTRATOR') throw new Error('Orchestrator fixture가 아닙니다.');
  await assert.rejects(
    () => runtimeReturning({
      ...output,
      report: { ...output.report, guardStatus: 'CLEAR' },
    }).run(failedRequest),
    /실패한 guard/,
  );
});

test('Codex Runtime은 성공 응답의 runId, threadId, ChatGPT OAuth 경계를 검증한다', async () => {
  const request = searchBriefRequest();
  const output = await new FixtureAgentRuntime().run(request);
  const invalidResponse = (
    overrides: Partial<CodexGatewayAgentRunResult>,
  ): CodexGatewayAgentRuntime => {
    const client: CodexGatewayClient = {
      async ready() {
        return { ready: true, authMode: 'chatgpt', modelCount: 1, allowedModelCount: 1, allowlistConfigured: true };
      },
      async listModels() {
        return { fetchedAt: '2026-08-14T00:00:00.000Z', models: [] };
      },
      async run(gatewayRequest) {
        return { ...successfulGatewayResult(gatewayRequest, output), ...overrides };
      },
    };
    return new CodexGatewayAgentRuntime({ client });
  };
  await assert.rejects(
    () => invalidResponse({ runId: 'run:other' }).run(request),
    (error: unknown) => error instanceof AgentRuntimeError && error.code === 'GATEWAY_RUN_ID_MISMATCH',
  );
  await assert.rejects(
    () => invalidResponse({ threadId: null }).run(request),
    (error: unknown) => error instanceof AgentRuntimeError && error.code === 'GATEWAY_THREAD_MISSING',
  );
  await assert.rejects(
    () => invalidResponse({
      authContext: { loginMethod: 'CODEX_ACCESS_TOKEN', authFingerprint: 'fixture-fingerprint' },
    }).run(request),
    (error: unknown) => error instanceof AgentRuntimeError && error.code === 'UNSUPPORTED_AUTH_METHOD',
  );
  await assert.rejects(
    () => invalidResponse({
      modelContext: {
        model: 'fixture-model',
        reasoningEffort: 'medium',
        catalogFetchedAt: '2026-08-14T00:00:00.000Z',
      },
    }).run(request),
    (error: unknown) =>
      error instanceof AgentRuntimeError && error.code === 'GATEWAY_MODEL_CONTEXT_MISMATCH',
  );
});

test('Codex Gateway 실패는 Gemini나 fixture로 fallback하지 않는다', async () => {
  const client: CodexGatewayClient = {
    async ready() {
      return { ready: false, authMode: 'unknown', modelCount: 0, allowedModelCount: 0, allowlistConfigured: false };
    },
    async listModels() {
      return { fetchedAt: '2026-08-14T00:00:00.000Z', models: [] };
    },
    async run(request) {
      return {
        runId: request.runId,
        status: 'AUTH_REQUIRED',
        authContext: { loginMethod: 'UNKNOWN', authFingerprint: 'fixture-fingerprint' },
        output: null,
        repairUsed: false,
        error: { code: 'AUTH_REQUIRED', retryable: false, safeMessage: 'Codex 로그인이 필요합니다.' },
      };
    },
  };
  const runtime = new CodexGatewayAgentRuntime({ client });
  await assert.rejects(
    () => runtime.run(searchBriefRequest()),
    (error: unknown) => error instanceof AgentRuntimeError && error.code === 'AUTH_REQUIRED',
  );
});

test('Fixture Finalizer는 CLEAR여도 VERIFIED로 승격하지 않는다', async () => {
  const request: PlanFinalizerRequest = {
    schemaVersion: 1,
    role: 'PLAN_FINALIZER',
    runId: 'run:1',
    tripId: 'trip:1',
    inputVersion: 1,
    charter,
    categoryContracts: [
      {
        schemaVersion: 1,
        contractId: 'contract:stay:1',
        contractVersion: 1,
        category: 'stay',
        charterVersion: charter.charterVersion,
        proposalSetVersion: 1,
        outcome: 'CONCLUDED',
        selectedProposalId: 'stay:a',
        deterministicSelectedProposalId: 'stay:a',
        rejectedProposalIds: [],
        ballotIds: ['ballot:u1', 'ballot:u2', 'ballot:u3'],
        summary: 'fixture',
        unresolvedIssues: [],
        obligationsForNextCategory: [],
        blockReason: null,
        evidenceIds: [],
      },
    ],
    orchestratorReport: {
      schemaVersion: 1,
      reportId: 'orchestrator:1',
      guardStatus: 'CLEAR',
      observedContractIds: ['contract:stay:1'],
      findings: [],
      recheckTargets: [],
      summary: 'fixture',
      evidenceIds: [],
    },
    evidenceMode: 'FIXTURE',
    evidence: [],
  };
  const result = await new FixtureAgentRuntime().run(request as AgentRunRequest);
  assert.equal(result.role, 'PLAN_FINALIZER');
  if (result.role !== 'PLAN_FINALIZER') return;
  assert.equal(result.finalPlan.status, 'PROVISIONAL');
  assert.deepEqual(result.finalPlan.unresolvedIssues, ['NON_LIVE_EVIDENCE']);
});

test('LIVE 표지만 있고 PASS 근거가 없으면 Finalizer도 VERIFIED로 승격하지 않는다', async () => {
  const request: PlanFinalizerRequest = {
    schemaVersion: 1,
    role: 'PLAN_FINALIZER',
    runId: 'run:live-unverified',
    tripId: 'trip:1',
    inputVersion: 1,
    charter,
    categoryContracts: [
      {
        schemaVersion: 1,
        contractId: 'contract:stay:1',
        contractVersion: 1,
        category: 'stay',
        charterVersion: charter.charterVersion,
        proposalSetVersion: 1,
        outcome: 'CONCLUDED',
        selectedProposalId: 'stay:a',
        deterministicSelectedProposalId: 'stay:a',
        rejectedProposalIds: [],
        ballotIds: ['ballot:u1', 'ballot:u2', 'ballot:u3'],
        summary: 'fixture',
        unresolvedIssues: [],
        obligationsForNextCategory: [],
        blockReason: null,
        evidenceIds: ['evidence:stay:a'],
      },
    ],
    orchestratorReport: {
      schemaVersion: 1,
      reportId: 'orchestrator:1',
      guardStatus: 'CLEAR',
      observedContractIds: ['contract:stay:1'],
      findings: [],
      recheckTargets: [],
      summary: 'fixture',
      evidenceIds: ['evidence:stay:a'],
    },
    evidenceMode: 'LIVE',
    evidence: [
      {
        schemaVersion: 1,
        evidenceId: 'evidence:stay:a',
        queryPlanId: 'query:1',
        providerId: 'rakuten_travel',
        providerCandidateId: 'hotel:1',
        sourceUrl: 'https://example.test/hotel/1',
        retrievedAt: '2026-08-14T00:00:00.000Z',
        validUntil: null,
        confidence: 'live',
        status: 'UNKNOWN',
        termsRef: 'terms:1',
        fieldStates: { availability: 'UNKNOWN' },
      },
    ],
  };
  const fixtureResult = await new FixtureAgentRuntime().run(request);
  assert.equal(fixtureResult.role, 'PLAN_FINALIZER');
  if (fixtureResult.role !== 'PLAN_FINALIZER') return;
  assert.equal(fixtureResult.finalPlan.status, 'PROVISIONAL');
  assert.deepEqual(fixtureResult.finalPlan.unresolvedIssues, ['EVIDENCE_NOT_VERIFIED']);

  const client: CodexGatewayClient = {
    async ready() {
      return { ready: true, authMode: 'chatgpt', modelCount: 1, allowedModelCount: 1, allowlistConfigured: true };
    },
    async listModels() {
      return { fetchedAt: '2026-08-14T00:00:00.000Z', models: [] };
    },
    async run(gatewayRequest) {
      return successfulGatewayResult(gatewayRequest, {
        ...fixtureResult,
        finalPlan: {
          ...fixtureResult.finalPlan,
          status: 'VERIFIED',
          unresolvedIssues: [],
        },
      });
    },
  };
  const guardedResult = await new CodexGatewayAgentRuntime({ client }).run(request);
  assert.equal(guardedResult.role, 'PLAN_FINALIZER');
  if (guardedResult.role !== 'PLAN_FINALIZER') return;
  assert.equal(guardedResult.finalPlan.status, 'PROVISIONAL');
  assert.deepEqual(guardedResult.finalPlan.unresolvedIssues, ['EVIDENCE_NOT_VERIFIED']);
});

test('Codex Finalizer가 RECHECK 상태를 과대 승격해도 결정론 ceiling이 NEEDS_USER_CHOICE로 낮춘다', async () => {
  const request = (await canonicalRoleRequests()).find(
    (item): item is PlanFinalizerRequest => item.role === 'PLAN_FINALIZER',
  );
  if (request === undefined) throw new Error('Finalizer request가 없습니다.');
  const recheckRequest: PlanFinalizerRequest = {
    ...request,
    orchestratorReport: {
      ...request.orchestratorReport,
      guardStatus: 'RECHECK',
      recheckTargets: ['availability'],
    },
  };
  const fixture = await new FixtureAgentRuntime().run(recheckRequest);
  if (fixture.role !== 'PLAN_FINALIZER') throw new Error('Finalizer fixture가 아닙니다.');
  const runtime = runtimeReturning({
    ...fixture,
    finalPlan: {
      ...fixture.finalPlan,
      status: 'PROVISIONAL',
      unresolvedIssues: [],
    },
  });

  const result = await runtime.run(recheckRequest);
  assert.equal(result.role, 'PLAN_FINALIZER');
  if (result.role !== 'PLAN_FINALIZER') return;
  assert.equal(result.finalPlan.status, 'NEEDS_USER_CHOICE');
  assert.ok(result.finalPlan.unresolvedIssues.includes('ORCHESTRATOR_RECHECK'));
});

test('Codex Runtime은 OAuth model thread token 정보를 비식별 실행 영수증으로 보존한다', async () => {
  const request = searchBriefRequest();
  const output = await new FixtureAgentRuntime().run(request);
  const runtime = runtimeReturning(output);

  await runtime.run(request);

  assert.equal('executionReceipts' in runtime, true);
  if (!('executionReceipts' in runtime) || typeof runtime.executionReceipts !== 'function') return;
  assert.deepEqual(runtime.executionReceipts(), [
    {
      schemaVersion: 1,
      role: 'USER_PROXY',
      instanceId: 'user_proxy.stay.u1',
      promptVersion: 'canonical-v1',
      executionMode: 'CODEX_OAUTH',
      status: 'SUCCEEDED',
      model: 'fixture-model',
      reasoningEffort: 'low',
      threadCreated: true,
      usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 10 },
      repairUsed: false,
      errorCode: null,
      contractValidation: 'ACCEPTED',
    },
  ]);
});

test('Gateway 성공이어도 canonical 출력 계약 거부는 영수증에 REJECTED로 남는다', async () => {
  const request = searchBriefRequest();
  const runtime = runtimeReturning({ schemaVersion: 1, role: 'USER_PROXY' });

  await assert.rejects(() => runtime.run(request));

  assert.equal('executionReceipts' in runtime, true);
  if (!('executionReceipts' in runtime) || typeof runtime.executionReceipts !== 'function') return;
  assert.equal(runtime.executionReceipts()[0]?.status, 'SUCCEEDED');
  assert.equal(runtime.executionReceipts()[0]?.contractValidation, 'REJECTED');
});
