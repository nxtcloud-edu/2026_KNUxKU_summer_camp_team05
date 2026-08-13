import { Worker } from 'bullmq';
import { executionCaps, roundIdToCategory, type PlanningNodeId, type RoundId } from '@tm/contracts';
import { createRunMeter } from '@tm/core';
import { createMemoryQuotaCounter } from '@tm/data-agents';
import { createRepositories, isDatabaseConfigured } from '@tm/db';
import { jobPayloadSchema, QUEUE_NAME } from './queue.js';
import {
  runPipeline,
  type GraphPort,
  type MeterPort,
  type RunState,
  type SupervisorPort,
  type RefereePort,
} from './orchestrator/loop.js';
import {
  guardsFromGraph,
  loadGraph,
  nodesForRound,
  recordNodeUpdate,
} from './orchestrator/graph-store.js';
import {
  createWorkerGateway,
  prefetchRound,
  type CandidateSearchPort,
} from './orchestrator/prefetch-runner.js';
import { finalizeRun, type DocumentPort } from './orchestrator/finalize.js';
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

/**
 * 후보탐색 에이전트가 붙는 자리 (김동욱).
 * 무엇을 조달할지 제안하면 코드가 정책·쿼터·정규화를 강제해 실행한다.
 * 구현이 없으면 조달을 건너뛴다 — 코드가 대신 추측하지 않는다.
 */
function loadCandidateSearch(): CandidateSearchPort | null {
  return null;
}

/**
 * 마무리 에이전트가 붙는 자리 (김동욱).
 * 계획서 초안을 주면 코드가 Validation Pass로 검증하고 발행 여부를 정한다.
 */
function loadDocumentAgent(): DocumentPort | null {
  return null;
}

const candidateSearch = loadCandidateSearch();
const documentAgent = loadDocumentAgent();

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
      stopReason: null,
    };

    // 원가·턴 상한은 run마다 새로 센다. 에이전트가 붙으면 호출마다 charge하고
    // 그 결과를 llm_usage에 남긴다 — 지금은 LLM 호출이 없어 잔량이 그대로다.
    const meter = createRunMeter({
      usdCap: costCapUsd,
      turnsCap: executionCaps.turnsPerRound,
    });
    const meterPort: MeterPort = { snapshot: () => meter.snapshot() };

    const room = await repos.rooms.get(payload.roomId);

    // 제공자 우선순위는 Pack이 정한다. 지역별 분기를 코드에 넣지 않기 위한 경로다.
    const pack = room === undefined ? undefined : await repos.packs.get(room.packId);
    if (room !== undefined && pack === undefined) {
      console.warn(
        `[worker] Pack ${room.packId}이 DB에 없습니다. npm run packs:sync --workspace @tm/db 를 먼저 실행하세요.`,
      );
    }

    // 쿼터 카운터는 run 단위다. 게이트웨이는 캐시·정책·상한을 여기서만 강제한다.
    const gateway = createWorkerGateway(
      repos,
      createMemoryQuotaCounter(),
      pack === undefined ? {} : { [pack.packId]: pack.pack.providers },
    );

    let seq = 0;
    const referee: RefereePort = {
      async run(roundId, instruction) {
        seq += 1;
        console.log(`[referee] ${roundId} 실행${instruction === null ? '' : ` — 지시: ${instruction}`}`);
        await recordRoundSettled(repos, payload.runId, roundId, seq);
      },
    };

    /**
     * 라운드 시작 전 조달. 라운드 행을 먼저 만들어야 `candidates`의 외래키가 통과한다.
     * 방 정보가 없거나 필요한 입력이 없으면 아무것도 요청하지 않는다 (값을 지어내지 않는다).
     */
    const prefetch = async (roundId: RoundId): Promise<void> => {
      await repos.runs.recordRound({
        runId: payload.runId,
        roundId,
        category: roundIdToCategory[roundId],
        seq: seq + 1,
        phase: 'SOURCING',
      });

      if (room === undefined) {
        console.warn(`[prefetch] ${roundId} 방 정보를 찾지 못해 건너뜁니다`);
        return;
      }
      if (candidateSearch === null) {
        console.log(`[prefetch] ${roundId} 후보탐색 에이전트가 없어 조달을 건너뜁니다`);
        return;
      }

      // 무엇을 찾을지는 에이전트가 정한다. 코드가 대신 추측하지 않는다.
      const requests = await candidateSearch.propose({
        runId: payload.runId,
        roundId,
        room,
        pack: pack?.pack ?? null,
      });
      if (requests === null || requests.length === 0) {
        console.log(`[prefetch] ${roundId} 조달 요청이 없습니다 — 건너뜁니다`);
        return;
      }

      await prefetchRound({ repos, gateway }, {
        runId: payload.runId,
        roundId,
        packId: room.packId,
        requests,
      });
    };

    // Planning Graph는 DB가 원본이다. V4·V9가 run 경계를 넘어 작동하려면 필요하다.
    let graph = await loadGraph(repos, payload.runId);
    const graphPort: GraphPort = {
      async guards() {
        return guardsFromGraph(graph);
      },
      async load() {
        return graph;
      },
      async settleRound(roundId) {
        const staled: PlanningNodeId[] = [];
        const lockedDescendants: PlanningNodeId[] = [];
        // 한 라운드가 여러 노드를 산출할 수 있다 (R2 = 지역 + 숙소).
        for (const nodeId of nodesForRound(roundId)) {
          const result = await recordNodeUpdate(repos, payload.runId, graph, {
            nodeId,
            // TODO(agents): 심판이 붙으면 판결 결과에 따라 VERIFIED / BLOCKED를 구분한다.
            // 지금은 후보를 조달하지 않으므로 검증됐다고 주장할 수 없다.
            status: 'PROVISIONAL',
            confidence: 'unknown',
          });
          graph = result.graph;
          staled.push(...result.staled);
          lockedDescendants.push(...result.lockedDescendants);
        }
        return { staled, lockedDescendants };
      },
    };

    const finished = await runPipeline(
      payload,
      {
        supervisor,
        referee,
        graph: graphPort,
        meter: meterPort,
        prefetch,
        // 계획서 발행. 검증과 발행 판정은 코드가 하고, 에이전트는 서술만 한다.
        async finalize() {
          const draft =
            documentAgent === null
              ? null
              : await documentAgent.draft({ runId: payload.runId, roomId: payload.roomId });
          const result = await finalizeRun(repos, {
            runId: payload.runId,
            roomId: payload.roomId,
            draft,
          });
          console.log(
            result.itineraryId === null
              ? `[finalize] 계획서를 만들지 못했습니다: ${result.reason ?? ''}`
              : `[finalize] ${result.itineraryId} 배지 ${result.badge}${result.published ? ' (발행)' : ` (미발행: ${result.reason ?? ''})`}`,
          );
        },
        // 폴백률은 프롬프트 회귀 지표다. 결정마다 남긴다 (12.2).
        async recordDispatch(record) {
          await repos.dispatchDecisions.record({
            runId: payload.runId,
            seq: record.seq,
            legalMoves: record.legalMoves,
            proposal: record.proposal,
            validationResult: record.validationResult,
            rejectedRules: record.rejectedRules,
            fallbackUsed: record.fallbackUsed,
            decidedBy: record.decidedBy,
          });
        },
      },
      state,
    );
    await repos.runs.finish(payload.runId, 'COMPLETED');

    if (finished.stopReason !== null && finished.stopReason !== undefined) {
      // 중간에 멈췄으면 그 사실을 남긴다. 부분 결과를 완주로 보이게 하지 않는다.
      console.warn(`[worker] ${payload.runId} 조기 종료: ${finished.stopReason}`);
    }

    const usage = await repos.llmUsage.totals(payload.runId);
    console.log(
      `[worker] ${payload.runId} 원가 $${usage.costUsd.toFixed(4)} (호출 ${usage.calls}) · 캐시 토큰 ${usage.cacheTokens}`,
    );

    if (payload.kind === 'rerun_from_objection') {
      await applyRerunOutcome(
        repos,
        payload,
        finished,
        finished.stopReason ?? PLACEHOLDER_REASON,
      );
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
