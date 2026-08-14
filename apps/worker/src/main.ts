import { Worker } from 'bullmq';
import { executionCaps } from '@tm/contracts';
import { createRepositories, isDatabaseConfigured } from '@tm/db';
import { jobPayloadSchema, QUEUE_NAME } from './queue.js';
import { executeRun, sharedLegacyGeminiRuntime } from './run-once.js';
import { executeCanonicalProductionRun } from './canonical-production-run.js';
import { alreadyApplied, recordFailure } from './run-recorder.js';

/**
 * Debate Worker — 큐 어댑터.
 *
 * run 1회의 실제 실행은 `run-once.ts`에 있다. 분리한 이유는 **큐 없이 검증할 수
 * 있어야** 하기 때문이다 (`npm run smoke --workspace @tm/worker`). 여기 남는 것은
 * 잡 수신·멱등 처리·실패 기록뿐이다.
 *
 * 근거: docs/development-and-deployment.md 7.3
 */
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const concurrency = Number(process.env['WORKER_CONCURRENCY'] ?? '1');

// 워커는 API가 만든 방·이의를 읽고 실행 결과를 되돌려 쓴다. 인메모리 저장소는
// 프로세스가 달라 아무것도 보이지 않으므로, 폴백하지 않고 즉시 멈춘다.
if (!isDatabaseConfigured()) {
  console.error('[worker] DATABASE_URL이 없습니다. 워커는 인메모리 저장소로 실행할 수 없습니다.');
  process.exit(1);
}

const repos = createRepositories();

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

    if (payload.kind === 'full_run') {
      const result = await executeCanonicalProductionRun(repos, payload);
      return {
        skipped: false,
        canonical: true,
        executionStatus: result.executionStatus,
        resultStatus: result.resultStatus,
      };
    }

    sharedLegacyGeminiRuntime();
    const result = await executeRun(repos, payload);
    return {
      skipped: false,
      completedRounds: result.completedRounds,
      fallbackCount: result.fallbackCount,
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
