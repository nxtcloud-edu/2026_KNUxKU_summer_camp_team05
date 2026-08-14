import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FixtureMvpAgentRuntime, type MvpAgentRuntime } from '@tm/agents';
import { mvpStayFixtureInputSchema, type MvpAgentRunRequest } from '@tm/contracts';
import { runMvpStayFixture } from './mvp-fixture-run.js';

function loadFixture(): ReturnType<typeof mvpStayFixtureInputSchema.parse> {
  return mvpStayFixtureInputSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(
          '../../../packages/contracts/fixtures/mvp-agent-runtime/osaka-stay-run.v1.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as unknown,
  );
}

class RecordingRuntime implements MvpAgentRuntime {
  readonly requests: MvpAgentRunRequest[] = [];
  private readonly fixture = new FixtureMvpAgentRuntime();

  async run(request: MvpAgentRunRequest) {
    this.requests.push(request);
    return this.fixture.run(request);
  }
}

test('Worker fixture는 세 역할을 거쳐 stay 결정을 종단 실행한다', async () => {
  const runtime = new RecordingRuntime();
  const result = await runMvpStayFixture(loadFixture(), runtime);
  assert.equal(result.status, 'FIXTURE_PATH_CLEAR');
  assert.equal(result.selection?.selectedProposalId, 'stay-b');
  assert.deepEqual(result.roleTrace, [
    'USER_PROXY',
    'USER_PROXY',
    'USER_PROXY',
    'STAY_ARBITER',
    'TRIP_SUPERVISOR',
  ]);
  assert.equal(result.supervisor?.guardStatus, 'CLEAR');
  assert.equal(result.guardChecks.every((check) => check.passed), true);
  const proxyRequests = runtime.requests.filter((request) => request.role === 'USER_PROXY');
  assert.equal(proxyRequests.length, 3);
  for (const request of proxyRequests) {
    const serialized = JSON.stringify(request);
    for (const otherId of ['user-1', 'user-2', 'user-3']) {
      if (otherId !== request.participant.participantId) {
        assert.equal(serialized.includes(`\"participantId\":\"${otherId}\"`), false);
      }
    }
  }
});

test('안전 조건 완화 요청은 Agent 호출 전에 종단 거부한다', async () => {
  const runtime = new RecordingRuntime();
  const fixture = loadFixture();
  const result = await runMvpStayFixture(
    {
      ...fixture,
      search: {
        ...fixture.search,
        allowedRelaxationIds: ['hc.smoke-free'],
        requestedRelaxationIds: ['hc.smoke-free'],
      },
    },
    runtime,
  );
  assert.equal(result.status, 'NO_SAFE_QUERY');
  assert.equal(result.search.status, 'NO_SAFE_QUERY');
  assert.equal(runtime.requests.length, 0);
});

test('Arbiter가 결정론 결과를 바꾸면 Supervisor가 HOLD하고 Worker가 차단한다', async () => {
  const fixtureRuntime = new FixtureMvpAgentRuntime();
  const runtime: MvpAgentRuntime = {
    async run(request) {
      const output = await fixtureRuntime.run(request);
      if (output.role !== 'STAY_ARBITER') return output;
      return { ...output, selectedProposalId: 'stay-a' };
    },
  };
  const result = await runMvpStayFixture(loadFixture(), runtime);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.supervisor?.guardStatus, 'HOLD');
  assert.equal(
    result.guardChecks.find((check) => check.code === 'ARBITER_ALIGNED')?.passed,
    false,
  );
});
