import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DestinationPack, SurveySubmission } from '@tm/contracts';
import { createMemoryRepositories } from '@tm/db';
import { loadEnv } from '../env.js';
import { buildServer } from '../server.js';

const env = loadEnv({
  ...process.env,
  DATABASE_URL: '',
  ENABLE_QUEUE: 'false',
  LOG_LEVEL: 'warn',
});

const pack: DestinationPack = {
  packId: 'jp-osaka',
  displayName: '오사카',
  country: 'JP',
  coverage: 'B',
  active: true,
  center: { lat: 34.6937, lng: 135.5023 },
  areas: ['난바', '우메다'],
  airports: ['KIX'],
  requiresAirTravel: true,
  cardDeck: 'osaka',
  providers: { hotel: ['fixture'], dining: ['fixture'], poi: ['fixture'], transit: ['fixture'], flight: ['fixture'] },
  config: {
    currency: 'JPY', displayCurrency: 'KRW', mealTimes: { lunch: '12:00', dinner: '18:00' },
    tipping: false, defaultTransit: 'rail', commonClosedDay: null, reservationCulture: null,
    avgCosts: { mealMid: 1500, subwayRide: 240, taxiBase: 680 }, timezone: 'Asia/Tokyo',
  },
  typicalDurations: [2, 3],
  recommendedNights: 2,
  peakSeasons: [],
  avoidDates: [],
  weatherProfile: { bestMonths: [4, 5, 10, 11], rainyMonths: [6] },
  roundPreset: 'standard_overseas',
  transitPasses: [],
  priceBands: [],
  verification: [],
};

const isoDay = (offset: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

const canonicalSurvey = (): SurveySubmission => ({
  schemaVersion: 2,
  destinationId: 'jp-osaka',
  availability: {
    availableDates: [isoDay(10), isoDay(11), isoDay(12), isoDay(13)],
    unavailableDates: [],
    preferredNights: '2',
    nightFlexibility: 'fixed',
    weekdayFlexibility: null,
    flightTimeFlexibility: null,
  },
  hardConstraints: {
    budgetLimit: '900000', includesFlight: true, dietary: [], allergies: [], beliefs: [],
    walkingDistanceKm: null, mobilityNeeds: [], noGoItems: [],
  },
  travelStyles: {}, activityScores: {}, mustDo: '', avoid: '',
});

test('Felicia Osaka destination id creates a room on the canonical jp-osaka Pack', async () => {
  const repos = createMemoryRepositories();
  const app = await buildServer(env, { repos });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/trip-rooms',
      headers: { 'x-user-id': 'anonymous' },
      payload: { schemaVersion: 1, destinationId: 'osaka' },
    });
    assert.equal(response.statusCode, 201);
    const roomId = response.json<{ roomId: string }>().roomId;
    assert.equal((await repos.rooms.get(roomId))?.packId, 'jp-osaka');
    assert.equal((await repos.members.get(roomId, 'anonymous'))?.role, 'host');
  } finally {
    await app.close();
  }
});

test('Production session rejects spoofing and unsafe cross-site writes', async () => {
  const productionEnv = loadEnv({
    NODE_ENV: 'production',
    LOG_LEVEL: 'warn',
    WEB_ORIGIN: 'https://moa.example',
    SESSION_SECRET: '0123456789abcdef0123456789abcdef',
    ENABLE_QUEUE: 'false',
  });
  const app = await buildServer(productionEnv, { repos: createMemoryRepositories() });
  try {
    const issued = await app.inject({ method: 'GET', url: '/api/session' });
    const setCookie = issued.headers['set-cookie'];
    assert.equal(typeof setCookie, 'string');
    assert.match(setCookie as string, /HttpOnly/);
    assert.match(setCookie as string, /SameSite=None/);
    assert.match(setCookie as string, /Secure/);

    const cookiePair = (setCookie as string).split(';')[0] as string;
    const originalValue = decodeURIComponent(cookiePair.slice(cookiePair.indexOf('=') + 1));
    const signature = originalValue.slice(originalValue.lastIndexOf('.'));
    const tamperedCookie = `moa_uid=${encodeURIComponent(`u_spoofed${signature}`)}`;
    const tampered = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { cookie: tamperedCookie, 'x-user-id': 'u_header_spoof' },
    });
    const tamperedUser = tampered.json<{ userId: string }>().userId;
    assert.notEqual(tamperedUser, 'u_spoofed');
    assert.notEqual(tamperedUser, 'u_header_spoof');

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/trip-rooms',
      headers: { cookie: cookiePair, origin: 'https://evil.example' },
      payload: { schemaVersion: 1, destinationId: 'osaka' },
    });
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.json<{ error: string }>().error, 'origin_not_allowed');
  } finally {
    await app.close();
  }
});

test('Survey v4 routes reuse canonical final submission storage', async () => {
  const repos = createMemoryRepositories();
  const app = await buildServer(env, { repos });
  try {
    const room = await repos.rooms.create('jp-osaka');
    await repos.members.join(room.roomId, 'host', 'host');
    const planResponse = await app.inject({ method: 'GET', url: '/api/survey-plans/jp-osaka' });
    assert.equal(planResponse.statusCode, 200);
    const plan = planResponse.json<{ planId: string; revision: string; schemaVersion: number }>();
    assert.equal(plan.schemaVersion, 4);

    const empty = await app.inject({
      method: 'GET', url: `/api/survey-progress/${plan.planId}`, headers: { 'x-user-id': 'host' },
    });
    assert.equal(empty.statusCode, 200);
    assert.equal(empty.body, 'null');

    const now = new Date().toISOString();
    const draft = {
      schemaVersion: 4,
      planId: plan.planId,
      planRevision: plan.revision,
      destinationId: 'jp-osaka',
      tripRoomId: room.roomId,
      participantId: 'host',
      status: 'draft',
      currentQuestionId: 'budget',
      answers: [{ questionId: 'dates', value: { kind: 'date-range', startDate: isoDay(10), endDate: isoDay(12), nights: 2 }, answeredAt: now }],
      startedAt: now,
      updatedAt: now,
      completedAt: null,
    } as const;
    const saved = await app.inject({
      method: 'POST', url: `/api/survey-progress/${plan.planId}`, headers: { 'x-user-id': 'host' }, payload: draft,
    });
    assert.equal(saved.statusCode, 200, saved.body);
    const restored = await app.inject({
      method: 'GET', url: `/api/survey-progress/${plan.planId}`, headers: { 'x-user-id': 'host' },
    });
    assert.equal(restored.json<{ currentQuestionId: string }>().currentQuestionId, 'budget');
    const isolated = await app.inject({
      method: 'GET', url: `/api/survey-progress/${plan.planId}`, headers: { 'x-user-id': 'other-user' },
    });
    assert.equal(isolated.body, 'null');

    const missingRoom = await app.inject({
      method: 'POST', url: `/api/survey-progress/${plan.planId}`, headers: { 'x-user-id': 'host' },
      payload: { ...draft, tripRoomId: 'missing' },
    });
    assert.equal(missingRoom.statusCode, 404);

    const mismatch = await app.inject({
      method: 'POST', url: `/api/survey-progress/${plan.planId}`, headers: { 'x-user-id': 'host' },
      payload: { ...draft, planId: 'survey-v4-other' },
    });
    assert.equal(mismatch.statusCode, 409);

    const complete = {
      ...draft,
      status: 'complete',
      currentQuestionId: null,
      completedAt: now,
      answers: [
        ...draft.answers,
        { questionId: 'budget', value: { kind: 'money-range', currency: 'KRW', targetAmount: 700000, maximumAmount: 900000, includesLongDistanceTransport: true }, answeredAt: now },
        { questionId: 'profile-confirmation', value: { kind: 'profile-confirmation', rememberForFuture: false }, answeredAt: now },
      ],
    } as const;
    const submitted = await app.inject({
      method: 'POST', url: '/api/survey-responses', headers: { 'x-user-id': 'host' }, payload: complete,
    });
    assert.equal(submitted.statusCode, 201, submitted.body);
    assert.equal(typeof submitted.json<{ submissionId: string }>().submissionId, 'string');
    const canonical = await repos.surveys.listByRoom(room.roomId);
    assert.equal(canonical.length, 1);
    assert.equal(canonical[0]?.schemaVersion, 2);
    assert.equal(canonical[0]?.payload.hardConstraints.budgetLimit, '900000');
  } finally {
    await app.close();
  }
});

test('Date Resolution reports missing evidence, offered choices, and a verified host choice', async () => {
  const repos = createMemoryRepositories();
  const app = await buildServer(env, { repos });
  try {
    const missing = await app.inject({ method: 'GET', url: '/api/rooms/missing/date-resolution' });
    assert.equal(missing.statusCode, 404);

    const room = await repos.rooms.create('jp-osaka');
    await repos.members.join(room.roomId, 'host', 'host');
    await repos.members.join(room.roomId, 'guest');

    const noPack = await app.inject({
      method: 'GET', url: `/api/rooms/${room.roomId}/date-resolution`, headers: { 'x-user-id': 'host' },
    });
    assert.equal(noPack.json<{ status: string }>().status, 'BLOCKED');
    assert.equal(noPack.json<{ reason: string }>().reason, 'destination_pack_not_found');

    await repos.packs.upsert(pack);
    const pending = await app.inject({
      method: 'GET', url: `/api/rooms/${room.roomId}/date-resolution`, headers: { 'x-user-id': 'host' },
    });
    assert.equal(pending.json<{ status: string }>().status, 'PROVISIONAL');
    assert.equal(pending.json<{ data: unknown }>().data, null);

    await repos.surveys.save(room.roomId, 'host', canonicalSurvey());
    const partial = await app.inject({
      method: 'GET', url: `/api/rooms/${room.roomId}/date-resolution`, headers: { 'x-user-id': 'host' },
    });
    assert.equal(partial.json<{ status: string }>().status, 'PROVISIONAL');
    assert.equal(partial.json<{ reason: string }>().reason, 'member_survey_evidence_incomplete');

    await repos.surveys.save(room.roomId, 'guest', canonicalSurvey());
    const offered = await app.inject({
      method: 'GET', url: `/api/rooms/${room.roomId}/date-resolution`, headers: { 'x-user-id': 'host' },
    });
    assert.equal(offered.statusCode, 200);
    const offeredBody = offered.json<{ status: string; data: { windows: Array<{ start: string; end: string }> } }>();
    assert.ok(['VERIFIED', 'NEEDS_USER_CHOICE'].includes(offeredBody.status));
    assert.ok(offeredBody.data.windows.length > 0);

    const rejected = await app.inject({
      method: 'POST', url: `/api/rooms/${room.roomId}/date-resolution/choice`,
      headers: { 'x-user-id': 'host' }, payload: { start: '2000-01-01', end: '2000-01-02' },
    });
    assert.equal(rejected.statusCode, 409);

    const selected = offeredBody.data.windows[0] as { start: string; end: string };
    const memberChoice = await app.inject({
      method: 'POST', url: `/api/rooms/${room.roomId}/date-resolution/choice`,
      headers: { 'x-user-id': 'guest' }, payload: selected,
    });
    assert.equal(memberChoice.statusCode, 403);
    assert.equal(memberChoice.json<{ error: string }>().error, 'host_only');

    const choice = await app.inject({
      method: 'POST', url: `/api/rooms/${room.roomId}/date-resolution/choice`,
      headers: { 'x-user-id': 'host' }, payload: selected,
    });
    assert.equal(choice.statusCode, 200, choice.body);
    assert.equal(choice.json<{ status: string }>().status, 'VERIFIED');

    const persistedView = await app.inject({
      method: 'GET', url: `/api/rooms/${room.roomId}/date-resolution`, headers: { 'x-user-id': 'host' },
    });
    assert.equal(persistedView.json<{ data: { chosen: { start: string } } }>().data.chosen.start, selected.start);
    assert.deepEqual((await repos.rooms.get(room.roomId))?.setting['canonicalDateChoice'], selected);
  } finally {
    await app.close();
  }
});

test('Canonical result routes preserve pending, partial, failed, and room-not-found states', async () => {
  const repos = createMemoryRepositories();
  const app = await buildServer(env, { repos });
  try {
    const pendingRoom = await repos.rooms.create('jp-osaka');
    await repos.members.join(pendingRoom.roomId, 'host', 'host');
    const denied = await app.inject({
      method: 'GET', url: `/api/rooms/${pendingRoom.roomId}/plan`, headers: { 'x-user-id': 'outsider' },
    });
    assert.equal(denied.statusCode, 403);
    const pending = await app.inject({
      method: 'GET', url: `/api/rooms/${pendingRoom.roomId}/plan`, headers: { 'x-user-id': 'host' },
    });
    assert.equal(pending.statusCode, 200);
    assert.equal(pending.json<{ availability: string; data: unknown }>().availability, 'pending');
    assert.equal(pending.json<{ data: unknown }>().data, null);

    const partialRun = 'run_partial';
    await repos.runs.start({ runId: partialRun, roomId: pendingRoom.roomId, trigger: 'host_start' });
    await repos.runs.finish(partialRun, 'COMPLETED');
    const partial = await app.inject({
      method: 'GET', url: `/api/rooms/${pendingRoom.roomId}/plan`, headers: { 'x-user-id': 'host' },
    });
    assert.equal(partial.json<{ availability: string; data: unknown }>().availability, 'partial');
    assert.equal(partial.json<{ data: unknown }>().data, null);

    const failedRoom = await repos.rooms.create('jp-osaka');
    await repos.members.join(failedRoom.roomId, 'host', 'host');
    const failedRun = 'run_failed';
    await repos.runs.start({ runId: failedRun, roomId: failedRoom.roomId, trigger: 'host_start' });
    await repos.runs.finish(failedRun, 'FAILED', 'provider evidence unavailable');
    const failed = await app.inject({
      method: 'GET', url: `/api/rooms/${failedRoom.roomId}/plan`, headers: { 'x-user-id': 'host' },
    });
    assert.equal(failed.json<{ availability: string }>().availability, 'failed');
    assert.match(failed.json<{ reason: string }>().reason, /provider evidence unavailable/);

    const missing = await app.inject({ method: 'GET', url: '/api/rooms/missing/plan' });
    assert.equal(missing.statusCode, 404);
  } finally {
    await app.close();
  }
});
