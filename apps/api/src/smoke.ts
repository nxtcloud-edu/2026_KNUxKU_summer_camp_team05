import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import type {
  FairnessView,
  PlanResult,
  ResultEnvelope,
  RoomProgress,
  SurveySubmission,
  TranscriptView,
} from '@tm/contracts';
import { createRepositories, isDatabaseConfigured, type Repositories } from '@tm/db';
import { buildServer } from './server.js';
import { loadEnv } from './env.js';

/**
 * API 실행 검증 — 타입체크가 잡지 못하는 것을 잡는다.
 *
 * 세션 쿠키가 실제로 왕복하는지, 결과 조회가 데이터 없이도 정직한 빈 상태를
 * 돌려주는지는 **띄워봐야만** 알 수 있다. `@tm/db`의 smoke와 같은 역할이다.
 *
 * 실행:
 *   DATABASE_URL=postgres://tm:tm_local@localhost:5432/travel_mediation \
 *     npm run smoke --workspace @tm/api
 */

let passed = 0;
const check = (label: string, condition: boolean, detail?: unknown): void => {
  if (!condition) {
    console.error(`  실패  ${label}`, detail ?? '');
    throw new Error(`검증 실패: ${label}`);
  }
  passed += 1;
  console.log(`  ok   ${label}`);
};

/** Set-Cookie 헤더에서 쿠키 하나를 꺼낸다 */
function cookieFrom(header: string | string[] | undefined): string | null {
  if (header === undefined) return null;
  const first = Array.isArray(header) ? header[0] : header;
  return first?.split(';')[0] ?? null;
}

const surveyPayload = (destinationId: string): SurveySubmission => ({
  schemaVersion: 2,
  destinationId,
  availability: {
    availableDates: ['2026-10-02', '2026-10-03', '2026-10-04'],
    unavailableDates: [],
    preferredNights: '2',
    nightFlexibility: 'fixed',
    weekdayFlexibility: 'weekends',
    flightTimeFlexibility: 'morning-onward',
  },
  hardConstraints: {
    budgetLimit: '900,000',
    includesFlight: true,
    dietary: [],
    allergies: ['새우'],
    beliefs: [],
    walkingDistanceKm: 8,
    mobilityNeeds: [],
    noGoItems: [],
  },
  travelStyles: { pace: 4 },
  activityScores: { onsen: 9 },
  mustDo: '온천에서 하루 쉬고 싶다',
  avoid: '새벽 비행',
});

async function run(app: FastifyInstance, repos: Repositories): Promise<void> {
  console.log('세션');

  const first = await app.inject({ method: 'GET', url: '/api/session' });
  check('GET /api/session → 200', first.statusCode === 200, first.statusCode);
  const cookie = cookieFrom(first.headers['set-cookie']);
  check('신규 방문자에게 쿠키를 발급한다', cookie !== null);
  const issuedUserId = first.json<{ userId: string }>().userId;
  check('발급된 userId가 비어 있지 않다', issuedUserId.length > 0, issuedUserId);

  const second = await app.inject({
    method: 'GET',
    url: '/api/session',
    headers: { cookie: cookie as string },
  });
  check(
    '같은 쿠키로 다시 오면 같은 사용자다',
    second.json<{ userId: string }>().userId === issuedUserId,
  );
  check('쿠키가 있으면 다시 발급하지 않는다', second.headers['set-cookie'] === undefined);

  const withHeader = await app.inject({
    method: 'GET',
    url: '/api/session',
    headers: { cookie: cookie as string, 'x-user-id': 'u_script' },
  });
  check(
    'x-user-id 헤더가 쿠키를 이긴다 (스크립트 경로 보존)',
    withHeader.json<{ userId: string }>().userId === 'u_script',
  );

  console.log('방 생성과 참여');

  const created = await app.inject({
    method: 'POST',
    url: '/api/trip-rooms',
    headers: { cookie: cookie as string },
    payload: { schemaVersion: 1, destinationId: 'jp-osaka' },
  });
  check('POST /api/trip-rooms → 201', created.statusCode === 201, created.body);
  const roomId = created.json<{ roomId: string }>().roomId;

  const survey = await app.inject({
    method: 'POST',
    url: '/api/survey-responses',
    headers: { cookie: cookie as string, 'x-room-id': roomId },
    payload: surveyPayload('jp-osaka'),
  });
  check('POST /api/survey-responses → 201', survey.statusCode === 201, survey.body);

  const room = await app.inject({
    method: 'GET',
    url: `/api/rooms/${roomId}`,
    headers: { cookie: cookie as string },
  });
  const me = room.json<{ me: { userId: string; surveySubmitted: boolean } | null }>().me;
  check('쿠키만으로 내 멤버 행을 찾는다 — 헤더 없이', me !== null, room.body);
  check('설문 제출이 내 상태에 반영된다', me?.surveySubmitted === true);
  check('쿠키의 userId로 참여자가 만들어졌다', me?.userId === issuedUserId, me?.userId);

  console.log('결과 조회 — 회의 전');

  const progress = await app.inject({
    method: 'GET', url: `/api/rooms/${roomId}/progress`, headers: { cookie: cookie as string },
  });
  check('GET /progress → 200', progress.statusCode === 200, progress.body);
  const progressBody = progress.json<RoomProgress>();
  check('회의 전에는 runId가 null이다', progressBody.runId === null);
  check('진행률 0%', progressBody.percent === 0, progressBody.percent);
  check('전체 라운드 수가 8이다', progressBody.totalRounds === 8, progressBody.totalRounds);
  check('방 상태를 그대로 싣는다', progressBody.roomStatus === 'COLLECTING', progressBody.roomStatus);

  for (const path of ['plan', 'transcript', 'fairness']) {
    const response = await app.inject({
      method: 'GET', url: `/api/rooms/${roomId}/${path}`, headers: { cookie: cookie as string },
    });
    check(`GET /${path} → 200`, response.statusCode === 200, response.body);
    const body = response.json<ResultEnvelope<PlanResult | TranscriptView | FairnessView>>();
    check(`/${path}: 없는 결과를 지어내지 않는다 (data=null)`, body.data === null, body.data);
    check(`/${path}: availability=pending`, body.availability === 'pending', body.availability);
    check(`/${path}: 왜 없는지 사유가 있다`, (body.reason ?? '').length > 0, body.reason);
  }

  console.log('결과 조회 — run이 진행 중일 때');

  // 워커 없이 run·라운드 행을 직접 만든다. 여기서 검증하는 것은 조회 경로다.
  const runId = `run_smoke_${Date.now().toString(36)}`;
  await repos.runs.start({ runId, roomId, trigger: 'host_start' });
  await repos.runs.recordRound({
    runId,
    roundId: 'r_0',
    category: 'supervisor',
    seq: 1,
    phase: 'SETTLED',
  });
  await repos.runs.recordRound({
    runId,
    roundId: 'r_1a',
    category: 'flight',
    seq: 2,
    phase: 'SOURCING',
  });

  const running = await app.inject({
    method: 'GET', url: `/api/rooms/${roomId}/progress`, headers: { cookie: cookie as string },
  });
  const runningBody = running.json<RoomProgress>();
  check('최신 run을 찾는다 (latestByRoom)', runningBody.runId === runId, runningBody.runId);
  check('run 상태가 RUNNING이다', runningBody.runStatus === 'RUNNING', runningBody.runStatus);
  check('라운드 2건을 seq 순으로 읽는다 (listRounds)', runningBody.rounds.length === 2, runningBody.rounds);
  check('첫 라운드가 r_0이다', runningBody.rounds[0]?.roundId === 'r_0', runningBody.rounds[0]);
  check('category를 잃지 않는다', runningBody.rounds[1]?.category === 'flight', runningBody.rounds[1]);
  check('SETTLED만 완료로 센다 → 1/8 = 13%', runningBody.percent === 13, runningBody.percent);
  check('진행 중에는 실패 사유가 없다', runningBody.failureReason === null);

  const runningPlan = await app.inject({
    method: 'GET', url: `/api/rooms/${roomId}/plan`, headers: { cookie: cookie as string },
  });
  check(
    '진행 중 계획서는 running으로 표시한다',
    runningPlan.json<ResultEnvelope<PlanResult>>().availability === 'running',
    runningPlan.json<ResultEnvelope<PlanResult>>().availability,
  );

  console.log('결과 조회 — run이 실패했을 때');

  await repos.runs.finish(runId, 'FAILED', '심판 에이전트가 아직 없어 후보를 조달하지 못했습니다');
  const failed = await app.inject({
    method: 'GET', url: `/api/rooms/${roomId}/progress`, headers: { cookie: cookie as string },
  });
  const failedBody = failed.json<RoomProgress>();
  check('실패 사유를 숨기지 않는다 (failureReason)', failedBody.failureReason !== null, failedBody);
  check('run 상태가 FAILED다', failedBody.runStatus === 'FAILED', failedBody.runStatus);
  check('종료 시각이 남는다', failedBody.finishedAt !== null);

  const failedPlan = await app.inject({
    method: 'GET', url: `/api/rooms/${roomId}/plan`, headers: { cookie: cookie as string },
  });
  const failedPlanBody = failedPlan.json<ResultEnvelope<PlanResult>>();
  check('실패한 run의 계획서는 failed다', failedPlanBody.availability === 'failed', failedPlanBody);
  check(
    '사용자에게 실패 사유를 그대로 전달한다',
    (failedPlanBody.reason ?? '').includes('심판'),
    failedPlanBody.reason,
  );

  console.log('결과 조회 — 없는 방');

  const missing = await app.inject({ method: 'GET', url: '/api/rooms/nope/progress' });
  check('없는 방은 404다 (빈 결과로 위장하지 않는다)', missing.statusCode === 404, missing.statusCode);
}

async function main(): Promise<void> {
  if (!isDatabaseConfigured()) {
    console.error('DATABASE_URL이 없습니다. 인메모리로는 왕복을 검증하는 의미가 없습니다.');
    process.exit(1);
  }

  // 큐는 끈다. 여기서 검증하는 것은 조회 경로이지 잡 실행이 아니다.
  const app = await buildServer(loadEnv({ ...process.env, ENABLE_QUEUE: 'false', LOG_LEVEL: 'warn' }));
  // 워커가 쓰는 쪽을 흉내 내기 위한 별도 핸들. 같은 DB를 본다.
  const repos = createRepositories();
  try {
    await run(app, repos);
    console.log(`\nAPI 경로 검증 통과 (검사 ${passed}개)`);
  } finally {
    await repos.close();
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
