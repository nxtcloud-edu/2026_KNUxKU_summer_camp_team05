import type { SurveySubmission } from '@tm/contracts';
import { createRepositories, isDatabaseConfigured } from '@tm/db';

/**
 * 저장소 루트의 `.env`를 읽는다. 이걸 하지 않으면 실제 공급자 키가 있어도
 * 워커가 못 보고 조용히 데모로만 돈다 — "실데이터로 돌렸다"고 착각하기 쉽다.
 * 파일이 없어도 그냥 진행한다 (환경변수로 넣었을 수 있다).
 */
try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  // .env가 없으면 환경변수를 그대로 쓴다.
}

/**
 * 워커 E2E 실행 검증 — 한 방이 끝까지 도는지 확인한다.
 *
 * 키가 없으면 데모 제공자만으로 돌고, `.env`에 실키가 있으면 실제 제공자가 섞인다.
 * **어느 모드로 통과했는지 출력에 남긴다** — "통과"만 보고 실데이터로 돌았다고
 * 착각하면, 파라미터 이름이 어긋나 전부 데모로 폴백하는 상황을 놓친다.
 *
 * 이 스크립트가 통과한다는 것은 다음이 전부 실제로 동작한다는 뜻이다:
 *   설문 → 가중치 → 날짜 확정 → 조달(데모 제공자) → 속성 산출 → 만족도·승자
 *   → 판결 저장 → Planning Graph 승격 → Validation Pass → 계획서 발행
 *
 * LLM이 없으므로 서술(발화·판결문·계획서 문장)은 빠진다. 결정은 전부 코드가 하므로
 * 결과 자체는 나온다 — 그 사실을 확인하는 것이 이 검증의 요점이다.
 *
 *   docker compose up -d
 *   npm run migrate    --workspace @tm/db
 *   npm run packs:sync --workspace @tm/db
 *   npm run smoke      --workspace @tm/worker
 */

let failures = 0;
const check = (label: string, condition: boolean, detail?: unknown): void => {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
};

/** 오늘 기준 미래 날짜. 과거 날짜는 DateResolver가 후보에서 제외한다 */
function futureDates(offsetDays: number, count: number): string[] {
  const dates: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = new Date();
    at.setDate(at.getDate() + offsetDays + index);
    dates.push(at.toISOString().slice(0, 10));
  }
  return dates;
}

const survey = (
  availableDates: string[],
  overrides: Partial<SurveySubmission['hardConstraints']> = {},
): SurveySubmission => ({
  schemaVersion: 2,
  destinationId: 'jp-osaka',
  availability: {
    availableDates,
    unavailableDates: [],
    preferredNights: '2',
    nightFlexibility: 'plus-minus-one',
    weekdayFlexibility: 'weekends',
    flightTimeFlexibility: 'morning-onward',
  },
  hardConstraints: {
    budgetLimit: '1,200,000',
    includesFlight: true,
    dietary: [],
    allergies: [],
    beliefs: [],
    walkingDistanceKm: 8,
    mobilityNeeds: [],
    noGoItems: [],
    ...overrides,
  },
  travelStyles: { pace: 3, 'accommodation-spend': 5 },
  activityScores: { 'osaka-spa-world': 8 },
  mustDo: '온천',
  avoid: '새벽 비행',
});

async function main(): Promise<void> {
  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL이 필요합니다.');
  }

  const repos = createRepositories();
  let roomId: string | undefined;

  try {
    const pack = await repos.packs.get('jp-osaka');
    if (pack === undefined) {
      throw new Error('Pack jp-osaka가 없습니다. npm run packs:sync --workspace @tm/db 를 먼저 실행하세요.');
    }

    console.log('준비');
    const room = await repos.rooms.create('jp-osaka');
    roomId = room.roomId;

    // 전원이 겹치는 구간이 있어야 날짜가 확정된다.
    const window = futureDates(30, 6);
    for (const [index, userId] of ['u_a', 'u_b', 'u_c'].entries()) {
      await repos.members.join(room.roomId, userId, index === 0 ? 'host' : 'member');
      await repos.surveys.save(room.roomId, userId, survey(window));
    }
    check('참여자 3명 설문 저장', (await repos.surveys.listByRoom(room.roomId)).length === 3);

    console.log('\n워커 실행 (별도 프로세스가 아니라 인라인)');
    // 잡 큐를 거치지 않고 파이프라인만 직접 돌린다. 큐 왕복은 이미 검증되어 있고,
    // 여기서 보려는 것은 에이전트 배선이 실제로 결과를 만드는가다.
    const runId = `run_smoke_${Date.now().toString(36)}`;
    const { runPipelineForRoom } = await import('./run-once.js');
    const result = await runPipelineForRoom(repos, { runId, roomId: room.roomId });

    console.log('\n결과');
    check('라운드가 진행됐다', result.completedRounds.length > 0, result.completedRounds);
    check(
      '날짜가 확정됐다',
      result.dateRange !== null,
      result.dateResolution?.reason ?? 'resolution 없음',
    );

    const candidates = await repos.candidates.sourcedExternalIds(runId);
    check('후보가 실제로 조달됐다', candidates.length > 0, candidates.length);

    /**
     * 실키 유무에 따라 기대가 달라진다. 한쪽만 검사하면 다른 쪽에서 거짓 신호가 난다 —
     * 키를 넣었는데 전부 데모로 도는 상황(파라미터 이름이 어긋난 경우)을 놓치거나,
     * 반대로 키 없는 CI에서 실패한다.
     */
    const demoIds = candidates.filter((id) => id.startsWith('demo_'));
    const realIds = candidates.filter((id) => !id.startsWith('demo_'));

    if (process.env['RAKUTEN_APPLICATION_ID'] === undefined) {
      check(
        '키가 없으므로 조달된 후보가 전부 데모 제공자 것이다',
        demoIds.length === candidates.length,
        candidates.slice(0, 3),
      );
    } else {
      // 라쿠텐 키가 있으면 R2(숙소)는 실데이터여야 한다. 전부 데모면 배선이 끊긴 것이다.
      check(
        '라쿠텐 키가 있으므로 실제 제공자 후보가 섞여 있다',
        realIds.length > 0,
        candidates.slice(0, 3),
      );
      console.log(`  ·    실데이터 ${realIds.length}건 · 데모 ${demoIds.length}건`);
      console.log(`  ·    실데이터 예: ${realIds.slice(0, 2).join(', ')}`);
    }

    const verdicts = await repos.verdicts.listByRun(runId);
    check('판결이 저장됐다', verdicts.length > 0, verdicts.length);
    check(
      '판결에 승자가 있다',
      verdicts.length > 0 && verdicts.every((row) => row.verdict.winner.candidateIds.length > 0),
    );
    check(
      '최소 만족도가 계산됐다 (코드가 만든 값)',
      verdicts.length > 0 && verdicts.every((row) => row.minSatisfaction !== null),
      verdicts.map((row) => row.minSatisfaction),
    );
    check(
      'fail-closed 미확인이 판결에 남는다',
      verdicts.some((row) => row.verdict.uncertainties.length > 0),
      verdicts[0]?.verdict.uncertainties,
    );

    const transcript = await repos.messages.transcript(runId);
    check('회의록이 남는다', transcript.length > 0, transcript.length);

    const nodes = await repos.planningNodes.listLatest(runId);
    check('Planning Graph 노드가 기록됐다', nodes.length > 0, nodes.length);
    check(
      '판정된 라운드의 노드는 VERIFIED로 올라간다',
      nodes.some((node) => node.status === 'VERIFIED'),
      nodes.map((node) => `${node.nodeId}=${node.status}`),
    );
    check(
      '조달이 빈 라운드의 노드는 PROVISIONAL로 남는다 (막힌 것이 아니라 미결정)',
      nodes.some((node) => node.status === 'PROVISIONAL'),
      nodes.map((node) => `${node.nodeId}=${node.status}`),
    );

    const itinerary = await repos.itineraries.latest(room.roomId);
    check('계획서가 저장됐다', itinerary !== undefined);
    check(
      '계획서에 항목이 있다',
      ((itinerary?.plan as { days?: { items?: unknown[] }[] } | undefined)?.days ?? []).some(
        (day) => (day.items ?? []).length > 0,
      ),
    );
    check(
      '검증을 통과하지 못했으므로 발행되지 않았다 (PARTIAL)',
      itinerary?.publishedAt === null,
      itinerary?.publishedAt,
    );

    const usage = await repos.llmUsage.totals(runId);
    check('LLM 호출이 0건이다 (키가 없으므로)', usage.calls === 0, usage.calls);

    console.log('\n요약');
    console.log(`  라운드      ${result.completedRounds.join(', ')}`);
    console.log(`  후보        ${candidates.length}건`);
    console.log(`  판결        ${verdicts.length}건`);
    console.log(`  회의록      ${transcript.length}건`);
    console.log(`  계획서 항목 ${((itinerary?.plan as { days?: { items?: unknown[] }[] })?.days ?? []).reduce((sum, day) => sum + (day.items?.length ?? 0), 0)}건`);
  } finally {
    if (roomId !== undefined) {
      await repos.rooms.updateStatus(roomId, 'COMPLETED');
    }
    await repos.close();
  }
}

try {
  await main();
  // 어느 모드로 통과했는지 남긴다. "통과"만 보고 실데이터로 돌았다고 오해하지 않도록.
  const mode = process.env['RAKUTEN_APPLICATION_ID'] === undefined ? '키 없이 · 데모만' : '실제 제공자 + 데모 혼합';
  console.log(failures === 0 ? `\n워커 E2E 검증 통과 (${mode})` : `\n실패 ${failures}건`);
  if (failures > 0) process.exitCode = 1;
} catch (error) {
  console.error(`\n중단: ${(error as Error).message}`);
  process.exitCode = 1;
}
