import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FixtureAgentRuntime, type AgentRuntime } from '@tm/agents';
import type { AgentRunRequest } from '@tm/contracts';
import {
  createCandidateEvidenceExecutionPort,
  createDataAgent,
  createDemoProvider,
  createStaticRegistry,
  type ProviderAdapter,
} from '@tm/data-agents';
import { createMemoryRepositories } from '@tm/db';
import { runCanonicalStayContractFixture } from './canonical-fixture-run.js';

class RecordingRuntime implements AgentRuntime {
  readonly requests: AgentRunRequest[] = [];
  private readonly fixture = new FixtureAgentRuntime();

  async run(request: AgentRunRequest) {
    this.requests.push(request);
    return this.fixture.run(request);
  }
}

test('공식 다섯 역할 계약으로 stay fixture를 종단 실행한다', async () => {
  const runtime = new RecordingRuntime();
  const result = await runCanonicalStayContractFixture(runtime);
  assert.equal(result.status, 'FIXTURE_CONTRACT_CLEAR');
  assert.deepEqual([...new Set(result.roleTrace)], [
    'USER_PROXY',
    'CANDIDATE_EVIDENCE',
    'CATEGORY_ARBITER',
    'TRIP_ORCHESTRATOR',
    'PLAN_FINALIZER',
  ]);
  assert.equal(result.selection.selectedProposalId, 'stay:b');
  assert.equal(result.categoryContract.selectedProposalId, result.selection.selectedProposalId);
  assert.equal(result.orchestratorReport.guardStatus, 'CLEAR');
  assert.equal(result.finalPlan.status, 'PROVISIONAL');
  assert.equal(result.finalPlan.evidenceMode, 'FIXTURE');
  assert.deepEqual(result.finalPlan.unresolvedIssues, ['NON_LIVE_EVIDENCE']);
});

test('세 Proxy의 SearchBrief와 중립 Brief가 모두 QueryPlan에 연결된다', async () => {
  const result = await runCanonicalStayContractFixture();
  assert.equal(new Set(result.searchBriefs.map((brief) => JSON.stringify(brief.searchTerms))).size, 3);
  const sourceBriefIds = new Set(result.queryPlans.flatMap((plan) => plan.sourceBriefIds));
  assert.deepEqual(
    [...sourceBriefIds].sort(),
    [...result.searchBriefs.map((brief) => brief.briefId), 'brief:neutral:stay:1'].sort(),
  );
});

test('모든 Proxy는 동일 ProposalSet 전체를 평가하고 비밀 키를 받지 않는다', async () => {
  const runtime = new RecordingRuntime();
  const result = await runCanonicalStayContractFixture(runtime);
  for (const ballot of result.ballots) {
    assert.equal(ballot.proposalSetVersion, 1);
    assert.deepEqual([...ballot.rankedProposalIds].sort(), ['stay:a', 'stay:b', 'stay:c']);
  }
  const serialized = JSON.stringify(runtime.requests);
  for (const forbidden of ['apiKey', 'credentials', 'providerRaw', 'TRIP_SUPERVISOR', 'STAY_ARBITER']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('공식 QueryPlan이 Provider Gateway를 거쳐 CandidateRecord와 EvidenceSnapshot을 만든다', async () => {
  const demo = createDemoProvider();
  let providerCalls = 0;
  const provider: ProviderAdapter = {
    id: 'rakuten_travel',
    supports: (queryClass) => demo.supports(queryClass),
    async fetch(request) {
      providerCalls += 1;
      return demo.fetch(request);
    },
  };
  const repos = createMemoryRepositories();
  const gateway = createDataAgent({
    cache: repos.cache,
    providers: createStaticRegistry([provider], {
      'jp-osaka': { hotel: ['rakuten_travel'] },
    }),
  });
  try {
    const result = await runCanonicalStayContractFixture(
      new FixtureAgentRuntime(),
      createCandidateEvidenceExecutionPort(gateway),
    );
    assert.equal(providerCalls, 1);
    assert.equal(result.providerExecution?.status, 'SUCCEEDED');
    assert.equal(result.providerExecution?.requestedQueryPlans, 4);
    assert.equal(result.providerExecution?.executedProviderRequests, 1);
    assert.equal(result.providerExecution?.deduplicatedQueryPlans, 3);
    assert.ok((result.providerExecution?.candidates.length ?? 0) > 0);
    assert.ok(
      result.providerExecution?.candidates.every(
        (candidate) => candidate.poolEligibility === 'UNVERIFIED',
      ),
    );
    assert.ok(
      result.providerExecution?.evidence.every((item) => item.status === 'UNKNOWN'),
    );
    assert.equal(result.finalPlan.status, 'PROVISIONAL');
  } finally {
    await repos.close();
  }
});
