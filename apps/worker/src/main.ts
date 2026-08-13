import { Worker } from 'bullmq';
import { executionCaps } from '@tm/contracts';
import { createRepositories, isDatabaseConfigured } from '@tm/db';
import { jobPayloadSchema, QUEUE_NAME } from './queue.js';
import { runPipeline, type RunState, type SupervisorPort, type RefereePort } from './orchestrator/loop.js';
import {
  alreadyApplied,
  applyRerunOutcome,
  recordFailure,
  recordRoundSettled,
  startRun,
} from './run-recorder.js';

/**
 * Debate Worker. 방 1개 실행이 최대 30분이고 LLM·외부 API 실비가 발생하므로
 * 동시성을 올리기 전에 방당 원가를 먼저 확인한다.
 * 근거: docs/development-and-deployment.md 7.3
 */
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const concurrency = Number(process.env['WORKER_CONCURRENCY'] ?? '1');
const costCapUsd = Number(process.env['RUN_COST_CAP_USD'] ?? '0.6');

// 워커는 API가 만든 방·이의를 읽고 실행 결과를 되돌려 쓴다. 인메모리 저장소는
// 프로세스가 달라 아무것도 보이지 않으므로, 폴백하지 않고 즉시 멈춘다.
if (!isDatabaseConfigured()) {
  console.error('[worker] DATABASE_URL이 없습니다. 워커는 인메모리 저장소로 실행할 수 없습니다.');
  process.exit(1);
}

const repos = createRepositories();

// TODO(agents): Supervisor와 심판을 @tm/agents 구현으로 교체한다.
// 지금은 파이프라인이 끝까지 도는지 확인하는 자리 표시자다.
const supervisor: SupervisorPort = {
  async propose() {
    return null; // 제안 없음 → Orchestrator가 기본 위상 순서로 진행
  },
};

/** 심판이 아직 없다는 사실. 결과에 그대로 노출한다 */
const PLACEHOLDER_REASON =
  '심판 에이전트가 아직 구현되지 않아 후보를 다시 조달하지 못했습니다. 결정은 그대로입니다.';

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const payload = jobPayloadSchema.parse(job.data);

    // 같은 objectionId로 잡이 두 번 들어와도 실행은 1회다 (objection-and-rerun.md O12).
    const applied = await alreadyApplied(repos, payload);
    if (applied !== null) {
      console.log(`[worker] ${payload.runId} 이미 처리된 이의 — 건너뜁니다`);
      return { skipped: true, completedRounds: [], fallbackCount: 0 };
    }

    await startRun(repos, payload);

    const state: RunState = {
      runId: payload.runId,
      roomId: payload.roomId,
      completedRounds: [],
      rerunCountByRound: {},
      globalRecalcUsed: 0,
      turnsRemaining: executionCaps.turnsPerRound,
      usdRemaining: costCapUsd,
      dispatchRejections: 0,
      fallbackCount: 0,
    };

    let seq = 0;
    const referee: RefereePort = {
      async run(roundId, instruction) {
        seq += 1;
        console.log(`[referee] ${roundId} 실행${instruction === null ? '' : ` — 지시: ${instruction}`}`);
        await recordRoundSettled(repos, payload.runId, roundId, seq);
      },
    };

    const finished = await runPipeline(payload, { supervisor, referee }, state);
    await repos.runs.finish(payload.runId, 'COMPLETED');

    if (payload.kind === 'rerun_from_objection') {
      await applyRerunOutcome(repos, payload, finished, PLACEHOLDER_REASON);
    } else {
      await repos.rooms.markCompleted(payload.roomId, finished.completedRounds);
    }

    return {
      skipped: false,
      completedRounds: finished.completedRounds,
      fallbackCount: finished.fallbackCount,
    };
  },
  {
    connection: { url: redisUrl },
    concurrency,
    // 방 전체 실행 상한. 초과 시 부분 결과 + 사유 안내로 처리한다.
    lockDuration: executionCaps.runWallclockSec * 1000,
  },
);

worker.on('failed', (job, error) => {
  // 조용한 실패가 비동기 모델의 최대 리스크다. 실패는 반드시 드러낸다 (기획서 R4).
  console.error(`[worker] job ${job?.id ?? 'unknown'} failed:`, error.message);

  if (job === undefined) return;
  const attempts = job.opts.attempts ?? 1;
  if (job.attemptsMade < attempts) return; // 재시도가 남아 있으면 아직 최종 실패가 아니다

  // 마지막 시도까지 실패 → DLQ 대상. 사용자에게 정직하게 남긴다.
  const parsed = jobPayloadSchema.safeParse(job.data);
  if (!parsed.success) return;
  void recordFailure(repos, parsed.data, error.message).catch((dbError: unknown) => {
    console.error('[worker] 실패 기록마저 실패했습니다:', (dbError as Error).message);
  });
});

worker.on('completed', (job) => {
  console.log(`[worker] job ${job.id} completed`);
});

console.log(`[worker] listening on queue "${QUEUE_NAME}" (concurrency ${concurrency})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void worker
      .close()
      .then(() => repos.close())
      .then(() => process.exit(0));
  });
}
