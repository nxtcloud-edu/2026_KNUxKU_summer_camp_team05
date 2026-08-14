import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FixtureAgentRuntime, type AgentRuntime } from '@tm/agents';
import type { AgentRunRequest } from '@tm/contracts';
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
