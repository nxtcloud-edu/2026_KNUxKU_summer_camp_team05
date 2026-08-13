import type { ObjectionRequest, SurveySubmission } from '@tm/contracts';
import { closePool, query } from './client.js';
import { createPostgresRepositories } from './postgres.js';

/**
 * PostgreSQL 경로 실행 검증. 마이그레이션이 적용된 DB에 실제로 쓰고 읽어본다.
 *
 * 타입 검사만으로는 SQL이 도는지 알 수 없다. 예약어·jsonb 캐스팅·조인은
 * 실행해야만 드러난다. 이 스크립트는 그 최소 확인이다.
 *
 *   npm run migrate --workspace @tm/db
 *   npm run smoke   --workspace @tm/db
 *
 * 만든 데이터는 끝에서 전부 지운다 (rooms 삭제 → CASCADE).
 */

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
}

const survey = (allergies: string[]): SurveySubmission => ({
  schemaVersion: 2,
  destinationId: 'jp-osaka',
  availability: {
    availableDates: ['2026-10-16', '2026-10-17', '2026-10-18'],
    unavailableDates: [],
    preferredNights: '2',
    nightFlexibility: 'plus-minus-one',
    weekdayFlexibility: 'friday-pto',
    flightTimeFlexibility: 'morning-onward',
  },
  hardConstraints: {
    budgetLimit: '900,000',
    includesFlight: true,
    dietary: [],
    allergies,
    beliefs: [],
    walkingDistanceKm: 8,
    mobilityNeeds: [],
    noGoItems: ['새벽 비행'],
  },
  travelStyles: { pace: 3, planning: 5 },
  activityScores: { 'osaka-spa-world': 9, 'osaka-shinsaibashi': 2 },
  mustDo: '온천',
  avoid: '쇼핑',
});

const objectionRequest = (roomId: string, userId: string): ObjectionRequest => ({
  roomId,
  userId,
  targetRoundId: 'r_2',
  targetCategory: 'accommodation',
  kind: 'add_condition',
  reason: '료칸 대신 역세권 호텔을 다시 검토해주세요',
  anchor: { claimIds: [], candidateIds: [], messageSeqs: [] },
  lateConstraints: [],
  budgetDeltaPerPersonKrw: 0,
  excludeCandidateIds: [],
});

async function main(): Promise<void> {
  const applied = await query<{ version: string }>('SELECT version FROM schema_migrations');
  if (applied.length === 0) {
    throw new Error('마이그레이션이 적용되지 않았습니다. npm run migrate --workspace @tm/db 먼저 실행하세요');
  }
  console.log(`migrations: ${applied.map((row) => row.version).join(', ')}`);

  const repos = createPostgresRepositories();
  let roomId: string | undefined;

  try {
    console.log('rooms');
    const room = await repos.rooms.create('jp-osaka', { budgetPerPersonKrw: 900000, pace: 'balanced' });
    roomId = room.roomId;
    check('create → COLLECTING', room.status === 'COLLECTING', room.status);

    await repos.rooms.updateStatus(room.roomId, 'RUNNING');
    check('updateStatus', (await repos.rooms.get(room.roomId))?.status === 'RUNNING');

    check('get(없는 방) → undefined', (await repos.rooms.get('rm_nope')) === undefined);

    console.log('surveys');
    const saved = await repos.surveys.save(room.roomId, 'user_a', survey(['갑각류']));
    check('save → allergens 승격', saved.allergens.includes('갑각류'), saved.allergens);

    const resaved = await repos.surveys.save(room.roomId, 'user_a', survey(['갑각류', '땅콩']));
    check('재제출 upsert (행 추가 없음)', resaved.allergens.length === 2, resaved.allergens);

    await repos.surveys.save(room.roomId, 'user_b', survey([]));
    const list = await repos.surveys.listByRoom(room.roomId);
    check('listByRoom → 2명', list.length === 2, list.length);
    check('payload 왕복', list[0]?.payload.hardConstraints.budgetLimit === '900,000');

    check('isMember(응답자)', await repos.surveys.isMember(room.roomId, 'user_a'));
    check('isMember(비참여자) → false', !(await repos.surveys.isMember(room.roomId, 'user_zzz')));

    console.log('runs → rooms.get 파생 조회');
    await query(
      `INSERT INTO runs (id, room_id, seq, trigger, status) VALUES ($1, $2, 1, 'all_completed', 'COMPLETED')`,
      ['run_smoke', room.roomId],
    );
    await query(
      `INSERT INTO rounds (id, run_id, round_id, category, seq, phase)
       VALUES ('rd_smoke_2', 'run_smoke', 'r_2', 'accommodation', 2, 'SETTLED'),
              ('rd_smoke_3', 'run_smoke', 'r_3', 'activity', 3, 'VERDICT')`,
    );
    await query(
      `INSERT INTO planning_nodes (run_id, node_id, input_hash, status, locked)
       VALUES ('run_smoke', 'accommodation', 'h1', 'BOOKED', false),
              ('run_smoke', 'activity', 'h2', 'VERIFIED', false)`,
    );

    const withFacts = await repos.rooms.get(room.roomId);
    check('completedRounds = SETTLED 라운드만', withFacts?.completedRounds.join(',') === 'r_2', withFacts?.completedRounds);
    check('bookedNodes = BOOKED/locked만', withFacts?.bookedNodes.join(',') === 'accommodation', withFacts?.bookedNodes);

    await repos.rooms.markCompleted(room.roomId, ['r_2'], 850000);
    const completed = await repos.rooms.get(room.roomId);
    check('markCompleted → COMPLETED', completed?.status === 'COMPLETED', completed?.status);
    check('예산 기준선 갱신', completed?.budgetBaselinePerPersonKrw === 850000, completed?.budgetBaselinePerPersonKrw);

    console.log('objections');
    const request = objectionRequest(room.roomId, 'user_a');
    const record = await repos.objections.save(request, {
      request,
      status: 'accepted',
      rejectReason: null,
      impact: {
        staleNodes: ['accommodation'],
        rerunRounds: ['r_2', 'r_3'],
        estimatedDurationSec: 420,
        estimatedCostUsd: 0.18,
        bookedNodesAffected: [],
        cancellationRisk: 'none',
        approvalRequired: [],
        remainingAfterThis: { room: 2, user: 0 },
      },
      runId: null,
      submittedAt: new Date().toISOString(),
      resolvedAt: null,
      outcome: null,
    });
    check('save → impact 왕복', record.impact?.rerunRounds.join(',') === 'r_2,r_3', record.impact);

    const used = await repos.objections.used(room.roomId, 'user_a');
    check('used 집계', used.room === 1 && used.user === 1, used);
    check('used(타인) → user 0', (await repos.objections.used(room.roomId, 'user_b')).user === 0);

    const updated = await repos.objections.update(record.objectionId, {
      status: 'queued',
      runId: 'run_smoke',
      resolvedAt: new Date().toISOString(),
    });
    check('update → queued', updated?.status === 'queued', updated?.status);
    check('update → runId', updated?.runId === 'run_smoke', updated?.runId);
    check('update → resolvedAt 기록', updated?.resolvedAt !== null);
    check('update(없는 id) → undefined', (await repos.objections.update('obj_nope', { status: 'applied' })) === undefined);

    const rejected = objectionRequest(room.roomId, 'user_b');
    await repos.objections.save(rejected, {
      request: rejected,
      status: 'rejected',
      rejectReason: 'duplicate_target',
      impact: null,
      runId: null,
      submittedAt: new Date().toISOString(),
      resolvedAt: null,
      outcome: null,
    });
    check('listByRoom → 2건', (await repos.objections.listByRoom(room.roomId)).length === 2);
    check('countedByRoom → rejected 제외', (await repos.objections.countedByRoom(room.roomId)).length === 1);

    console.log('제약');
    let duplicateBlocked = false;
    try {
      await repos.objections.save(request, {
        request,
        status: 'accepted',
        rejectReason: null,
        impact: null,
        runId: null,
        submittedAt: new Date().toISOString(),
        resolvedAt: null,
        outcome: null,
      });
    } catch {
      duplicateBlocked = true;
    }
    check('같은 사용자·같은 라운드 중복 이의 차단', duplicateBlocked);
  } finally {
    if (roomId !== undefined) {
      await query('DELETE FROM rooms WHERE id = $1', [roomId]);
      const leftover = await query<{ count: string }>('SELECT count(*) FROM objections WHERE room_id = $1', [roomId]);
      check('CASCADE 정리', leftover[0]?.count === '0', leftover[0]?.count);
    }
  }
}

try {
  await main();
  console.log(failures === 0 ? '\nPostgreSQL 경로 검증 통과' : `\n실패 ${failures}건`);
  if (failures > 0) process.exitCode = 1;
} catch (error) {
  console.error(`\n중단: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
