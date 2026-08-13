import { Worker } from 'bullmq';
import { executionCaps } from '@tm/contracts';
import { jobPayloadSchema, QUEUE_NAME } from './queue.js';
import { runPipeline, type RunState, type SupervisorPort, type RefereePort } from './orchestrator/loop.js';

/**
 * Debate Worker. 방 1개 실행이 최대 30분이고 LLM·외부 API 실비가 발생하므로
 * 동시성을 올리기 전에 방당 원가를 먼저 확인한다.
 * 근거: docs/development-and-deployment.md 7.3
 */
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const concurrency = Number(process.env['WORKER_CONCURRENCY'] ?? '1');
const costCapUsd = Number(process.env['RUN_COST_CAP_USD'] ?? '0.6');

// TODO(agents): Supervisor와 심판을 @tm/agents 구현으로 교체한다.
// 지금은 파이프라인이 끝까지 도는지 확인하는 자리 표시자다.
const supervisor: SupervisorPort = {
  async propose() {
    return null; // 제안 없음 → Orchestrator가 기본 위상 순서로 진행
  },
};

const referee: RefereePort = {
  async run(roundId, instruction) {
    console.log(`[referee] ${roundId} 실행${instruction === null ? '' : ` — 지시: ${instruction}`}`);
  },
};

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const payload = jobPayloadSchema.parse(job.data);
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

    const finished = await runPipeline(payload, { supervisor, referee }, state);
    return {
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
});

worker.on('completed', (job) => {
  console.log(`[worker] job ${job.id} completed`);
});

console.log(`[worker] listening on queue "${QUEUE_NAME}" (concurrency ${concurrency})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void worker.close().then(() => process.exit(0));
  });
}
