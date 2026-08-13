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

  // 이전 실행이 중간에 죽었으면 외래키 없는 테이블에 찌꺼기가 남는다. 먼저 지운다.
  await query('DELETE FROM llm_usage WHERE run_id = $1', ['run_smoke']);
  await query('DELETE FROM data_requests WHERE run_id = $1', ['run_smoke']);

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

    console.log('runs');
    const run = await repos.runs.start({ runId: 'run_smoke', roomId: room.roomId, trigger: 'all_completed' });
    check('start → RUNNING', run.status === 'RUNNING', run.status);
    check('seq 발급', run.seq === 1, run.seq);
    check('start 중 방 상태 RUNNING', (await repos.rooms.get(room.roomId))?.status === 'RUNNING');

    const restarted = await repos.runs.start({ runId: 'run_smoke', roomId: room.roomId, trigger: 'all_completed' });
    check('같은 runId 재시작 → seq 유지 (멱등)', restarted.seq === run.seq, restarted.seq);

    await repos.runs.recordRound({ runId: 'run_smoke', roundId: 'r_2', category: 'accommodation', seq: 2, phase: 'SETTLED' });
    await repos.runs.recordRound({ runId: 'run_smoke', roundId: 'r_3', category: 'activity', seq: 3, phase: 'VERDICT' });
    await repos.runs.recordRound({ runId: 'run_smoke', roundId: 'r_2', category: 'accommodation', seq: 2, phase: 'SETTLED' });
    const roundCount = await query<{ count: string }>(
      `SELECT count(*) FROM rounds WHERE run_id = 'run_smoke'`,
    );
    check('같은 라운드 재기록 → 행 추가 없음', roundCount[0]?.count === '2', roundCount[0]?.count);

    await repos.runs.finish('run_smoke', 'COMPLETED');
    check('finish → COMPLETED', (await repos.runs.get('run_smoke'))?.status === 'COMPLETED');
    check('finish → finishedAt 기록', (await repos.runs.get('run_smoke'))?.finishedAt !== null);

    console.log('planning_nodes');
    await repos.planningNodes.appendVersions('run_smoke', [
      {
        nodeId: 'accommodation',
        version: 1,
        status: 'VERIFIED',
        confidence: 'live',
        inputHash: 'h1',
        dependencyVersions: { accommodation_area: 1 },
        evidenceRefs: ['sha256:abc'],
        locked: false,
      },
      {
        nodeId: 'dining',
        version: 1,
        status: 'BLOCKED',
        confidence: 'unknown',
        inputHash: 'h2',
        dependencyVersions: {},
        evidenceRefs: [],
        locked: false,
      },
    ]);
    // 상위가 바뀌어 숙소가 v2로 올라가고 식사는 STALE v2로 내려간 상황
    await repos.planningNodes.appendVersions('run_smoke', [
      {
        nodeId: 'accommodation',
        version: 2,
        status: 'BOOKED',
        confidence: 'live',
        inputHash: 'h3',
        dependencyVersions: { accommodation_area: 2 },
        evidenceRefs: ['sha256:def'],
        locked: true,
      },
    ]);

    const latest = await repos.planningNodes.listLatest('run_smoke');
    const accommodation = latest.find((row) => row.nodeId === 'accommodation');
    check('listLatest → 노드별 최신 버전만', latest.length === 2, latest.length);
    check('최신 버전이 v2', accommodation?.version === 2, accommodation?.version);
    check('locked 왕복', accommodation?.locked === true);
    check('dependencyVersions 왕복', accommodation?.dependencyVersions['accommodation_area'] === 2);
    check('evidenceRefs 왕복', accommodation?.evidenceRefs[0] === 'sha256:def');

    const history = await repos.planningNodes.history('run_smoke', 'accommodation');
    check('이력이 보존된다 (v1 삭제 안 됨)', history.length === 2, history.length);
    check('이력은 버전 오름차순', history[0]?.version === 1 && history[1]?.version === 2);

    await repos.planningNodes.appendVersions('run_smoke', [
      {
        nodeId: 'accommodation',
        version: 2,
        status: 'BOOKED',
        confidence: 'live',
        inputHash: 'h3-retry',
        dependencyVersions: { accommodation_area: 2 },
        evidenceRefs: ['sha256:def'],
        locked: true,
      },
    ]);
    check(
      '같은 버전 재기록 → 행 추가 없음 (잡 재시도 멱등)',
      (await repos.planningNodes.history('run_smoke', 'accommodation')).length === 2,
    );

    console.log('rooms.get 파생 조회');
    // accommodation은 위에서 이미 v2 BOOKED + locked다. VERIFIED 노드 하나만 더 넣어
    // BOOKED/locked만 골라지는지 본다.
    await repos.planningNodes.appendVersions('run_smoke', [
      {
        nodeId: 'activity',
        version: 1,
        status: 'VERIFIED',
        confidence: 'live',
        inputHash: 'h4',
        dependencyVersions: {},
        evidenceRefs: [],
        locked: false,
      },
    ]);

    const withFacts = await repos.rooms.get(room.roomId);
    check('completedRounds = SETTLED 라운드만', withFacts?.completedRounds.join(',') === 'r_2', withFacts?.completedRounds);
    check('bookedNodes = BOOKED/locked만', withFacts?.bookedNodes.join(',') === 'accommodation', withFacts?.bookedNodes);

    await repos.rooms.markCompleted(room.roomId, ['r_2'], 850000);
    const completed = await repos.rooms.get(room.roomId);
    check('markCompleted → COMPLETED', completed?.status === 'COMPLETED', completed?.status);
    check('예산 기준선 갱신', completed?.budgetBaselinePerPersonKrw === 850000, completed?.budgetBaselinePerPersonKrw);

    console.log('members');
    const host = await repos.members.join(room.roomId, 'user_a', 'host');
    check('join → host', host.role === 'host', host.role);
    check('설문 제출이 반영된다', host.surveySubmitted === true, host.surveySubmitted);
    check('페르소나 확인 전에는 null', host.personaConfirmedAt === null);

    await repos.members.join(room.roomId, 'user_a', 'member');
    check('같은 사용자 재입장 → 행 추가 없음', (await repos.members.list(room.roomId)).length === 1);
    check(
      '재입장이 역할을 강등시키지 않는다',
      (await repos.members.get(room.roomId, 'user_a'))?.role === 'host',
    );

    await repos.members.join(room.roomId, 'user_c');
    check('설문 없는 멤버는 미제출', (await repos.members.get(room.roomId, 'user_c'))?.surveySubmitted === false);

    const confirmed = await repos.members.confirmPersona(room.roomId, 'user_a');
    check('페르소나 확인 기록', confirmed?.personaConfirmedAt !== null, confirmed?.personaConfirmedAt);
    check('없는 멤버 확인 → undefined', (await repos.members.confirmPersona(room.roomId, 'nobody')) === undefined);

    console.log('candidates · messages · verdicts · scores');
    const ref = { runId: 'run_smoke', roundId: 'r_2' } as const;

    const savedCandidates = await repos.candidates.saveMany(ref, [
      { externalId: 'H1', provider: 'rakuten_travel', payload: { name: '난바 호텔', price: 82000 } },
      { externalId: 'H2', provider: 'rakuten_travel', payload: { name: '우메다 호텔', price: 96000 } },
    ]);
    check('saveMany → 2건', savedCandidates.length === 2, savedCandidates.length);

    await repos.candidates.saveMany(ref, [
      { externalId: 'H1', provider: 'rakuten_travel', payload: { name: '난바 호텔', price: 84000 } },
    ]);
    const candidateList = await repos.candidates.listByRound(ref);
    check('같은 external_id 재조달 → 행 추가 없이 갱신', candidateList.length === 2, candidateList.length);
    check(
      'payload 갱신',
      (candidateList.find((row) => row.externalId === 'H1')?.payload as { price: number }).price === 84000,
    );

    await repos.candidates.disqualify(ref, 'H2', '알레르기 대응 미확인');
    const disqualified = (await repos.candidates.listByRound(ref)).find((row) => row.externalId === 'H2');
    check('실격은 삭제가 아니라 사유 기록', disqualified?.disqualified === true && disqualified.disqualifyReason !== null);

    const sourced = await repos.candidates.sourcedExternalIds('run_smoke');
    check('Validation Pass 입력 = 조달된 external_id', sourced.sort().join(',') === 'H1,H2', sourced);

    const first = await repos.messages.append(ref, {
      speakerType: 'referee',
      speakerId: 'referee:accommodation',
      content: '후보 2건을 조달했습니다.',
      refs: { candidateIds: ['H1', 'H2'] },
    });
    const second = await repos.messages.append(ref, {
      speakerType: 'persona',
      speakerId: 'user_a',
      content: '난바가 좋습니다.',
    });
    check('seq는 저장소가 채번한다', first.seq === 1 && second.seq === 2, [first.seq, second.seq]);
    check('refs 왕복', (first.refs as { candidateIds: string[] }).candidateIds[0] === 'H1');
    check('회의록 전문 조회', (await repos.messages.transcript('run_smoke')).length === 2);

    const verdict = {
      roundId: 'r_2' as const,
      category: 'accommodation' as const,
      winner: { type: 'single' as const, candidateIds: ['H1'], detail: '난바 호텔' },
      rationale: '역세권이고 최소 만족도가 가장 높습니다.',
      runnerUp: 'H2',
      disqualified: [{ candidateId: 'H2', reason: '알레르기 대응 미확인' }],
      intensityProfile: [],
      dissent: [],
      scores: { H1: 7.2 },
      minSatisfaction: 6.4,
      satisfactionGap: 2.1,
      budgetImpact: { allocated: 300000, actual: 246000, delta: -54000 },
      handoff: {},
      uncertainties: ['조식 포함 여부 미확인'],
      warnings: [],
      followups: [],
      toolCalls: ['hotel.search'],
      partialSourcing: false,
      detail: {},
    };

    const savedVerdict = await repos.verdicts.save(ref, verdict, { result: 'pass', reasons: [] });
    check('판결 저장 → minSatisfaction 컬럼 승격', savedVerdict.minSatisfaction === 6.4, savedVerdict.minSatisfaction);
    check('판결 왕복', (await repos.verdicts.get(ref))?.verdict.winner.candidateIds[0] === 'H1');

    await repos.verdicts.save(ref, { ...verdict, minSatisfaction: 7.0 }, { result: 'rerun', reasons: ['C1'] });
    check('재판결은 덮어쓴다 (라운드당 1건)', (await repos.verdicts.listByRun('run_smoke')).length === 1);
    check('재심 사유 왕복', (await repos.verdicts.get(ref))?.review.reasons[0] === 'C1');

    await repos.scores.replaceRound(ref, [
      { candidateId: 'H1', userId: 'user_a', satisfaction: 7.2, breakdown: { price: 0.4 } },
      { candidateId: 'H1', userId: 'user_b', satisfaction: 6.4, breakdown: { price: 0.6 } },
    ]);
    await repos.scores.replaceRound(ref, [
      { candidateId: 'H1', userId: 'user_a', satisfaction: 7.5, breakdown: { price: 0.4 } },
    ]);
    const scoreRows = await repos.scores.listByRound(ref);
    check('점수는 라운드 단위로 교체된다', scoreRows.length === 1, scoreRows.length);
    check('numeric 왕복', scoreRows[0]?.satisfaction === 7.5, scoreRows[0]?.satisfaction);

    console.log('양보 크레딧 · 디스패치 · 원가');
    await repos.concessions.append({
      roomId: room.roomId,
      userId: 'user_a',
      roundId: 'r_2',
      delta: -0.2,
      ccAfter: 0.8,
    });
    await repos.concessions.append({
      roomId: room.roomId,
      userId: 'user_a',
      roundId: 'r_2',
      delta: -0.2,
      ccAfter: 0.6,
    });
    check(
      '같은 방·사용자·라운드는 한 번만 (재시도가 크레딧을 두 번 깎지 않는다)',
      (await repos.concessions.history(room.roomId)).length === 1,
    );
    check('잔액 조회', (await repos.concessions.creditsByRoom(room.roomId))['user_a'] === 0.8);

    const dispatchEntry = {
      runId: 'run_smoke',
      seq: 1,
      legalMoves: [{ moveId: 'mv_r_2' }],
      proposal: null,
      validationResult: null,
      rejectedRules: [],
      fallbackUsed: true,
      decidedBy: 'default' as const,
    };
    await repos.dispatchDecisions.record(dispatchEntry);
    await repos.dispatchDecisions.record(dispatchEntry);
    check('같은 (run, seq)는 한 번만', (await repos.dispatchDecisions.listByRun('run_smoke')).length === 1);
    check('폴백률 집계', (await repos.dispatchDecisions.fallbackRate('run_smoke')).rate === 1);

    const usage = {
      // llm_usage는 rooms에 외래키가 없어 CASCADE로 지워지지 않는다.
      // requestId가 멱등 키이므로 고정값을 쓰면 두 번째 실행부터 삽입이 건너뛰어진다.
      requestId: `llm_${room.roomId}`,
      roomId: room.roomId,
      runId: 'run_smoke',
      roundId: 'r_2',
      purpose: 'referee.accommodation',
      model: 'claude-sonnet-5',
      promptVersion: 'referee.v1',
      inputTokens: 4200,
      outputTokens: 380,
      cacheTokens: 3100,
      costUsd: 0.0183,
    };
    await repos.llmUsage.record(usage);
    await repos.llmUsage.record(usage);
    const totals = await repos.llmUsage.totals('run_smoke');
    check('같은 requestId는 원가를 두 번 세지 않는다', totals.calls === 1, totals.calls);
    check('원가 합계', Math.abs(totals.costUsd - 0.0183) < 1e-6, totals.costUsd);
    check('캐시 토큰 합계', totals.cacheTokens === 3100, totals.cacheTokens);
    check('방 단위 집계', (await repos.llmUsage.byRoom(room.roomId)).calls === 1);

    console.log('계획서 · 승인 요청');
    const itinerary = await repos.itineraries.save({
      roomId: room.roomId,
      runId: 'run_smoke',
      plan: { days: [] },
      budgetSummary: { perPerson: 820000 },
      validationReport: { passed: false, blockers: [{ kind: 'unverified_fail_closed' }] },
    });
    check('버전 1로 시작', itinerary.version === 1, itinerary.version);

    const second2 = await repos.itineraries.save({ roomId: room.roomId, runId: 'run_smoke', plan: { days: [1] } });
    check('재발행은 버전이 오른다', second2.version === 2, second2.version);
    check('latest는 최신 버전', (await repos.itineraries.latest(room.roomId))?.version === 2);
    check('발행 전에는 publishedAt이 null', second2.publishedAt === null);

    await repos.itineraries.publish(second2.itineraryId);
    check('발행 기록', (await repos.itineraries.latest(room.roomId))?.publishedAt !== null);

    const approval = await repos.approvals.raise({
      roomId: room.roomId,
      type: 'booked_node_change',
      options: [{ id: 'keep', label: '예약 유지' }, { id: 'cancel', label: '취소하고 재검토' }],
    });
    check('승인 대기 목록에 뜬다', (await repos.approvals.pending(room.roomId)).length === 1);

    await repos.approvals.respond(approval.approvalId, { decision: 'approve' });
    check('응답하면 대기 목록에서 빠진다', (await repos.approvals.pending(room.roomId)).length === 0);
    check('없는 승인 응답 → undefined', (await repos.approvals.respond('apr_nope', {})) === undefined);

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
      // 외래키가 없는 테이블은 직접 지운다.
      await query('DELETE FROM llm_usage WHERE room_id = $1 OR run_id = $2', [roomId, 'run_smoke']);
      await query('DELETE FROM data_requests WHERE run_id = $1', ['run_smoke']);
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
