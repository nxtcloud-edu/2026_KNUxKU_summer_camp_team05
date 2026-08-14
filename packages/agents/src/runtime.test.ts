import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  agentRoles,
  type AgentRunRequest,
  type CandidateEvidenceRequest,
  type CodexGatewayAgentRunRequest,
  type CodexGatewayAgentRunResult,
  type PlanFinalizerRequest,
  type ProxySearchBrief,
  type TripCharter,
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
  await assert.rejects(
    () => new CodexGatewayAgentRuntime({ client }).run(request),
    /LIVE PASS 근거가 모두 갖춰지지 않아 VERIFIED로 승격할 수 없습니다/,
  );
});
