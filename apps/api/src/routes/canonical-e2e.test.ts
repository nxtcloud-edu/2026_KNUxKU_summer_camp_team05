import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { destinationPackSchema } from '@tm/contracts';
import { createMemoryRepositories } from '@tm/db';
import { planStatusFromBadge } from '../../../web/src/features/results/adapters/planResultAdapter.js';
import { executeCanonicalProductionRun } from '../../../worker/src/canonical-production-run.js';
import { createInlineWorkerQueue } from '../queue.js';
import { loadEnv } from '../env.js';
import { buildServer } from '../server.js';

const env = loadEnv({
  ...process.env,
  DATABASE_URL: '',
  ENABLE_QUEUE: 'false',
  LOG_LEVEL: 'warn',
});

const isoDay = (offset: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

test('Felicia API mode reaches the canonical Worker result and replay surfaces', async () => {
  const repos = createMemoryRepositories();
  const queue = createInlineWorkerQueue(async (payload) => {
    if (payload.kind !== 'full_run') throw new Error('Expected a full run');
    await executeCanonicalProductionRun(
      repos,
      payload,
      { MOA_AGENT_RUNTIME: 'fixture', USE_DEMO_PROVIDER: 'true' },
    );
  });
  const app = await buildServer(env, { repos, queue });
  try {
    const pack = destinationPackSchema.parse(JSON.parse(
      await readFile(new URL('../../../../packs/jp-osaka.json', import.meta.url), 'utf8'),
    ) as unknown);
    await repos.packs.upsert(pack);

    const created = await app.inject({
      method: 'POST',
      url: '/api/trip-rooms',
      headers: { 'x-user-id': 'u1' },
      payload: { schemaVersion: 1, destinationId: 'osaka' },
    });
    assert.equal(created.statusCode, 201, created.body);
    const roomId = created.json<{ roomId: string }>().roomId;

    for (const [index, userId] of ['u1', 'u2', 'u3'].entries()) {
      const joined = await app.inject({
        method: 'POST',
        url: `/api/rooms/${roomId}/members`,
        headers: { 'x-user-id': userId },
        payload: { role: 'host' },
      });
      assert.equal(joined.statusCode, 201, joined.body);
      assert.equal(joined.json<{ role: string }>().role, index === 0 ? 'host' : 'member');
    }

    const planResponse = await app.inject({ method: 'GET', url: '/api/survey-plans/jp-osaka' });
    assert.equal(planResponse.statusCode, 200, planResponse.body);
    const surveyPlan = planResponse.json<{ planId: string; revision: string }>();
    const now = new Date().toISOString();
    const startDate = isoDay(20);
    const endDate = isoDay(23);
    for (const userId of ['u1', 'u2', 'u3']) {
      const submitted = await app.inject({
        method: 'POST',
        url: '/api/survey-responses',
        headers: { 'x-user-id': userId },
        payload: {
          schemaVersion: 4,
          planId: surveyPlan.planId,
          planRevision: surveyPlan.revision,
          destinationId: 'jp-osaka',
          tripRoomId: roomId,
          participantId: userId,
          status: 'complete',
          currentQuestionId: null,
          answers: [
            { questionId: 'dates', value: { kind: 'date-range', startDate, endDate, nights: 3 }, answeredAt: now },
            { questionId: 'budget', value: { kind: 'money-range', currency: 'KRW', targetAmount: 300000, maximumAmount: 400000, includesLongDistanceTransport: false }, answeredAt: now },
            { questionId: 'profile-confirmation', value: { kind: 'profile-confirmation', rememberForFuture: false }, answeredAt: now },
          ],
          startedAt: now,
          updatedAt: now,
          completedAt: now,
        },
      });
      assert.equal(submitted.statusCode, 201, submitted.body);

      const confirmed = await app.inject({
        method: 'POST',
        url: `/api/rooms/${roomId}/persona/confirm`,
        headers: { 'x-user-id': userId },
      });
      assert.equal(confirmed.statusCode, 200, confirmed.body);
    }

    const dateResponse = await app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/date-resolution`,
      headers: { 'x-user-id': 'u1' },
    });
    assert.equal(dateResponse.statusCode, 200, dateResponse.body);
    const dateResolution = dateResponse.json<{
      status: string;
      data: { windows: Array<{ start: string; end: string }> } | null;
    }>();
    assert.ok(dateResolution.data?.windows[0]);
    if (dateResolution.status === 'NEEDS_USER_CHOICE') {
      const choice = await app.inject({
        method: 'POST',
        url: `/api/rooms/${roomId}/date-resolution/choice`,
        headers: { 'x-user-id': 'u1' },
        payload: dateResolution.data.windows[0],
      });
      assert.equal(choice.statusCode, 200, choice.body);
    }

    const started = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/start`,
      headers: { 'x-user-id': 'u1' },
      payload: { trigger: 'all_done' },
    });
    assert.equal(started.statusCode, 202, started.body);

    const progress = await app.inject({
      method: 'GET', url: `/api/rooms/${roomId}/progress`, headers: { 'x-user-id': 'u1' },
    });
    assert.equal(progress.statusCode, 200, progress.body);
    assert.equal(progress.json<{ percent: number; runStatus: string }>().percent, 100);
    assert.equal(progress.json<{ runStatus: string }>().runStatus, 'COMPLETED');

    const plan = await app.inject({
      method: 'GET', url: `/api/rooms/${roomId}/plan`, headers: { 'x-user-id': 'u1' },
    });
    assert.equal(plan.statusCode, 200, plan.body);
    const planBody = plan.json<{
      availability: string;
      data: { badge: Parameters<typeof planStatusFromBadge>[0]; blockers: unknown[] } | null;
    }>();
    assert.equal(planBody.availability, 'partial');
    assert.ok(planBody.data);
    assert.equal(planStatusFromBadge(planBody.data.badge, planBody.data.blockers.length), 'BLOCKED');
    assert.doesNotMatch(plan.body, /BOOKABLE|BOOKED/);

    const transcript = await app.inject({
      method: 'GET', url: `/api/rooms/${roomId}/transcript`, headers: { 'x-user-id': 'u1' },
    });
    assert.equal(transcript.statusCode, 200, transcript.body);
    assert.equal(transcript.json<{ availability: string }>().availability, 'ready');
    assert.match(transcript.body, /canonical-worker/);

    const agentExecution = await app.inject({
      method: 'GET', url: `/api/rooms/${roomId}/agent-execution`, headers: { 'x-user-id': 'u1' },
    });
    assert.equal(agentExecution.statusCode, 200, agentExecution.body);
    const executionBody = agentExecution.json<{
      availability: string;
      data: { executionMode: string; completeRoleSet: boolean; receipts: unknown[] } | null;
    }>();
    assert.equal(executionBody.availability, 'ready');
    assert.equal(executionBody.data?.executionMode, 'FIXTURE');
    assert.equal(executionBody.data?.completeRoleSet, false);
    assert.equal(executionBody.data?.receipts.length, 4);
    assert.doesNotMatch(agentExecution.body, /threadId|authFingerprint|instanceId/);
  } finally {
    await app.close();
  }
});
