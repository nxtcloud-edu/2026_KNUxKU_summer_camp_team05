import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { destinationPackSchema, planDocumentSchema, surveySubmissionSchema } from '@tm/contracts';
import { createMemoryRepositories } from '@tm/db';
import { executeCanonicalProductionRun } from './canonical-production-run.js';

test('기본 full_run이 B1/B2/B4 canonical 경로를 사용하고 미검증 근거를 BLOCKED로 저장한다', async () => {
  const repos = createMemoryRepositories();
  try {
    const pack = JSON.parse(
      await readFile(new URL('../../../packs/jp-osaka.json', import.meta.url), 'utf8'),
    ) as unknown;
    const parsedPack = destinationPackSchema.parse(pack);
    await repos.packs.upsert(parsedPack);
    const room = await repos.rooms.create('jp-osaka');
    const dates = ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19'];
    for (const userId of ['u1', 'u2', 'u3']) {
      await repos.members.join(room.roomId, userId, userId === 'u1' ? 'host' : 'member');
      await repos.surveys.save(room.roomId, userId, surveySubmissionSchema.parse({
        schemaVersion: 2,
        destinationId: 'jp-osaka',
        availability: {
          availableDates: dates,
          unavailableDates: [],
          preferredNights: '3',
          nightFlexibility: 'fixed',
          weekdayFlexibility: null,
          flightTimeFlexibility: null,
        },
        hardConstraints: {
          budgetLimit: '400000',
          includesFlight: false,
          dietary: [],
          allergies: [],
          beliefs: [],
          walkingDistanceKm: null,
          mobilityNeeds: [],
          noGoItems: [],
        },
        travelStyles: {},
        activityScores: {},
        mustDo: '',
        avoid: '',
      }));
      await repos.members.confirmPersona(room.roomId, userId);
    }
    const result = await executeCanonicalProductionRun(
      repos,
      { kind: 'full_run', runId: 'run:production-fixture:1', roomId: room.roomId, trigger: 'host' },
      { MOA_AGENT_RUNTIME: 'fixture', USE_DEMO_PROVIDER: 'true' },
    );
    const itinerary = await repos.itineraries.latest(room.roomId);
    const run = await repos.runs.get('run:production-fixture:1');

    assert.equal(result.executionStatus, 'COMPLETED');
    assert.equal(result.resultStatus, 'BLOCKED');
    assert.equal(result.failure?.stage, 'FACT_CONSTRAINT_VALIDATION');
    assert.equal(run?.status, 'COMPLETED');
    assert.ok(planDocumentSchema.safeParse(itinerary?.plan).success);
    const plan = planDocumentSchema.parse(itinerary?.plan);
    assert.deepEqual(plan.dateRange, { start: '2026-10-16', end: '2026-10-19' });
    assert.equal(itinerary?.publishedAt, null);
  } finally {
    await repos.close();
  }
});
