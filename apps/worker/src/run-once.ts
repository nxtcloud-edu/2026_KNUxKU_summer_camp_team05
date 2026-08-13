import {
  executionCaps,
  roundIdToCategory,
  type PlanningNodeId,
  type RefereeCategory,
  type RoundId,
} from '@tm/contracts';
import { createRunMeter } from '@tm/core';
import {
  createDemoProvider,
  createMemoryQuotaCounter,
  prefetchableClasses,
  providersFromEnv,
  shouldUseDemoProvider,
} from '@tm/data-agents';
import type { Repositories } from '@tm/db';
import {
  draftPlan,
  proposeDispatch,
  proposeSearches,
  runRound,
  type LlmClient,
  type RoundParticipant,
} from '@tm/agents';
import type { JobPayload } from './queue.js';
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
import { defaultSearchPlan } from './orchestrator/search-plan.js';
import { finalizeRun, type DocumentPort } from './orchestrator/finalize.js';
import {
  createAgentRuntime,
  createDocumentStore,
  createRefereeStore,
  createUsageRecorder,
  hardConstraintsOf,
  prepareParticipants,
  resolveRoomDates,
  type AgentRuntime,
} from './agents.js';
import { applyRerunOutcome, recordRoundSettled, startRun } from './run-recorder.js';

/**
 * run 1회의 전부. 큐와 분리해 둔 이유는 **큐 없이 검증할 수 있어야** 하기 때문이다
 * (`npm run smoke --workspace @tm/worker`).
 *
 * 키가 없어도 끝까지 돈다 — 결정은 전부 코드가 하고, 빠지는 것은 서술뿐이다.
 */

const costCapUsd = Number(process.env['RUN_COST_CAP_USD'] ?? '0.6');

/**
 * 키가 없을 때 쓰는 클라이언트.
 *
 * 호출하면 즉시 던진다 — 에이전트들이 그 예외를 잡아 결정론 폴백으로 넘어가고,
 * 그 사실이 로그와 회의록에 남는다. 빈 문자열을 돌려주면 실패가 성공처럼 보인다.
 */
export function nullClient(): LlmClient {
  const fail = (): never => {
    throw new Error('LLM 키가 없습니다 (GEMINI_API_KEY)');
  };
  return {
    generate: async () => fail(),
    generateJson: async () => fail(),
    limiter: {
      acquire: async () => ({ waitedMs: 0 }),
      penalize: () => {},
      snapshot: () => ({ minuteUsed: 0, minuteLimit: 0, dayUsed: 0, dayLimit: 0, exhausted: true }),
    },
  };
}

/** 프로세스당 한 번만 만든다. 레이트리밋 창이 run마다 초기화되면 안 된다 */
let cachedRuntime: AgentRuntime | null | undefined;

export function sharedRuntime(): AgentRuntime | null {
  if (cachedRuntime !== undefined) return cachedRuntime;
  const setup = createAgentRuntime();
  if ('runtime' in setup) {
    const limits = setup.runtime.client.limiter.snapshot();
    console.log(
      `[worker] LLM 준비됨 — 심판 ${setup.runtime.config.models.referee} · 페르소나 ${setup.runtime.config.models.persona} · ` +
        `상한 ${limits.minuteLimit}/분 ${limits.dayLimit}/일`,
    );
    cachedRuntime = setup.runtime;
  } else {
    console.warn(
      `[worker] LLM 키가 없습니다 (${setup.missing.join(', ')}). ` +
        '결정은 코드가 그대로 하고, 서술(발화·판결문·계획서 문장)만 빠집니다.',
    );
    cachedRuntime = null;
  }
  return cachedRuntime;
}

export interface RunOnceResult {
  completedRounds: RoundId[];
  fallbackCount: number;
  stopReason: string | null;
  dateRange: { start: string; end: string } | null;
  dateResolution: ReturnType<typeof resolveRoomDates>['resolution'] | null;
}

/** 큐 없이 run 하나를 끝까지 돌린다. 스모크와 워커가 같은 경로를 쓴다 */
export async function runPipelineForRoom(
  repos: Repositories,
  input: { runId: string; roomId: string },
): Promise<RunOnceResult> {
  return executeRun(repos, {
    kind: 'full_run',
    runId: input.runId,
    roomId: input.roomId,
    trigger: 'host',
  } as JobPayload);
}

export async function executeRun(
  repos: Repositories,
  payload: JobPayload,
): Promise<RunOnceResult> {
  const runtime = sharedRuntime();

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

    // 원가·턴 상한은 run마다 새로 센다. 무료 티어에서는 원가가 0이라 실질 상한은
    // 레이트리밋이지만, 턴 상한은 여기서 그대로 집행된다.
    const meter = createRunMeter({
      usdCap: costCapUsd,
      turnsCap: executionCaps.turnsPerRound,
    });
    const meterPort: MeterPort = { snapshot: () => meter.snapshot() };
    const recordUsage = createUsageRecorder(repos, meter, {
      runId: payload.runId,
      roomId: payload.roomId,
    });

    const room = await repos.rooms.get(payload.roomId);

    // 제공자 우선순위는 Pack이 정한다. 지역별 분기를 코드에 넣지 않기 위한 경로다.
    const pack = room === undefined ? undefined : await repos.packs.get(room.packId);
    if (room !== undefined && pack === undefined) {
      console.warn(
        `[worker] Pack ${room.packId}이 DB에 없습니다. npm run packs:sync --workspace @tm/db 를 먼저 실행하세요.`,
      );
    }

    // ── 참여자 준비: 설문 → 가중치 → 페르소나 카드 ────────────────────────
    const surveys = room === undefined ? [] : await repos.surveys.listByRoom(room.roomId);
    let participants: RoundParticipant[] = [];
    if (room !== undefined && surveys.length > 0 && runtime !== null) {
      participants = await prepareParticipants(repos, runtime, room, surveys, recordUsage);
    }
    if (participants.length === 0 && surveys.length > 0) {
      console.warn(
        '[worker] 페르소나 카드를 만들지 못했습니다 (LLM 키 없음). 발화 없이 코드 판정만 진행합니다.',
      );
    }

    const hard = hardConstraintsOf(surveys);
    const groupSize = Math.max(1, surveys.length);

    // ── 날짜 확정: 방장이 아니라 설문이 정한다 (기획서 7장) ────────────────
    const recommendedNights = pack?.pack.recommendedNights ?? 2;
    const dates =
      surveys.length === 0
        ? { resolution: null, range: null }
        : resolveRoomDates(surveys, recommendedNights);
    if (dates.resolution !== null) {
      console.log(
        `[dates] ${dates.resolution.status} — ${dates.resolution.reason}` +
          (dates.range === null ? '' : ` (${dates.range.start} ~ ${dates.range.end})`),
      );
    }
    const nights = dates.range === null ? recommendedNights : dates.resolution?.nights ?? recommendedNights;

    // 쿼터 카운터는 run 단위다. 게이트웨이는 캐시·정책·상한을 여기서만 강제한다.
    // 키가 없으면 데모 제공자가 들어간다 — 실제 키가 있으면 자동으로 빠진다.
    const realProviders = providersFromEnv();
    const useDemo = shouldUseDemoProvider(process.env, realProviders.adapters.length);
    if (useDemo) {
      console.warn(
        '[worker] 실제 제공자 키가 없어 데모 제공자를 씁니다. 후보는 confidence=estimated로 표시되고 예약 링크가 없습니다.',
      );
    }
    const gateway = createWorkerGateway(
      repos,
      createMemoryQuotaCounter(),
      pack === undefined ? {} : { [pack.packId]: pack.pack.providers },
      useDemo ? [createDemoProvider()] : [],
    );

    const refereeStore = createRefereeStore(repos, payload.runId);
    const searchFacts = {
      packId: room?.packId ?? 'unknown',
      dateRange: dates.range,
      groupSize,
      // 출발 공항은 Pack이 정하지 않는다 (참여자 출발지에 달렸다). 환경변수로 둔다.
      originAirport: process.env['DEFAULT_ORIGIN_AIRPORT'] ?? (pack?.pack.requiresAirTravel === true ? 'ICN' : null),
      // 도착 공항 후보 중 첫 번째. Pack이 원본이다.
      destinationAirport: pack?.pack.airports[0] ?? null,
      nights,
      areas: pack?.pack.areas ?? [],
    };

    /**
     * 후보탐색 에이전트. 무엇을 찾을지는 에이전트가 정하고,
     * 실패하거나 키가 없으면 코드가 깐 바닥값으로 간다 (그 사실을 로그에 남긴다).
     */
    const candidateSearch: CandidateSearchPort = {
      async propose({ roundId }) {
        const allowedClasses = prefetchableClasses();

        if (runtime !== null) {
          const proposed = await proposeSearches(
            { client: runtime.client, model: runtime.config.models.referee, onUsage: recordUsage },
            {
              roundId,
              allowedClasses,
              facts: {
                packId: searchFacts.packId,
                dateRange: searchFacts.dateRange,
                groupSize: searchFacts.groupSize,
                originAirport: searchFacts.originAirport,
                destinationAirport: searchFacts.destinationAirport,
                budgetCapPerPersonKrw: hard.budgetCapPerPersonKrw,
              },
              instruction: payload.kind === 'rerun_from_objection' ? payload.instruction : null,
            },
          );
          if (proposed.length > 0) return proposed;
        }

        const fallback = defaultSearchPlan(roundId, searchFacts);
        if (fallback.length > 0) {
          console.log(
            `[search] ${roundId} 에이전트 제안이 없어 기본 조달 ${fallback.length}건으로 진행합니다`,
          );
        }
        return fallback;
      },
    };

    // ── Supervisor: 합법 수 안에서 순서만 제안한다 ─────────────────────────
    const supervisor: SupervisorPort = {
      async propose(moves, current) {
        if (runtime === null) return null; // 폴백 = 기본 위상 순서
        return proposeDispatch(
          { client: runtime.client, model: runtime.config.models.supervisor, onUsage: recordUsage },
          moves,
          {
            runId: current.runId,
            completedRounds: current.completedRounds,
            turnsRemaining: current.turnsRemaining,
            usdRemaining: current.usdRemaining,
            reducedMode: current.reducedMode ?? false,
          },
        );
      },
    };

    /** 라운드별 판정 결과. settleRound가 노드 상태를 정할 때 읽는다 */
    const roundOutcomes = new Map<
      RoundId,
      { decided: boolean; unverified: string[]; blocked: boolean }
    >();

    let seq = 0;
    const referee: RefereePort = {
      async run(roundId, instruction) {
        seq += 1;
        const category = roundIdToCategory[roundId];

        // R0는 프레이밍 라운드라 카테고리 심판이 없다. 진행 기록만 남긴다.
        if (category === 'supervisor') {
          await repos.messages.append(
            { runId: payload.runId, roundId },
            {
              speakerType: 'system',
              speakerId: null,
              content:
                dates.range === null
                  ? `여행 날짜를 확정하지 못했습니다: ${dates.resolution?.reason ?? '설문 부족'}`
                  : `여행 구간을 ${dates.range.start} ~ ${dates.range.end}로 확정했습니다. ${dates.resolution?.reason ?? ''}`,
              refs: { dateStatus: dates.resolution?.status ?? 'unknown' },
            },
          );
          roundOutcomes.set(roundId, {
            decided: dates.range !== null,
            unverified: [],
            blocked: false,
          });
          await recordRoundSettled(repos, payload.runId, roundId, seq);
          return;
        }

        if (runtime === null && participants.length === 0) {
          // 발화도 판결문도 없지만 코드 판정은 그대로 돈다. 후보만 있으면 승자가 나온다.
          console.log(`[referee] ${roundId} LLM 없이 코드 판정만 진행합니다`);
        }

        const outcome = await runRound(
          {
            client: runtime?.client ?? nullClient(),
            models: {
              referee: runtime?.config.models.referee ?? 'none',
              persona: runtime?.config.models.persona ?? 'none',
            },
            store: refereeStore,
            onUsage: recordUsage,
          },
          {
            runId: payload.runId,
            roundId,
            category: category as RefereeCategory,
            participants,
            ledger: await repos.concessions.creditsByRoom(payload.roomId),
            hard,
            groupSize,
            instruction,
            budgetAllocatedPerPersonKrw: hard.budgetCapPerPersonKrw,
          },
        );

        if (outcome.skipped !== null) {
          console.warn(`[referee] ${roundId} 판정하지 못했습니다: ${outcome.skipped}`);
        } else {
          console.log(
            `[referee] ${roundId} 승자 ${outcome.verdict?.winner.candidateIds[0] ?? '?'} · ` +
              `최소 만족도 ${outcome.verdict?.minSatisfaction ?? '?'} · 발화 ${outcome.messages}건`,
          );
        }

        roundOutcomes.set(roundId, {
          decided: outcome.verdict !== null,
          unverified: outcome.unverified,
          // 후보가 없었을 뿐이면 막힌 것이 아니다. 하드 제약이 전부 지웠을 때만 BLOCKED.
          blocked: outcome.skipReason === 'all_disqualified',
        });
        await recordRoundSettled(repos, payload.runId, roundId, seq);
      },
    };

    /**
     * 라운드 시작 전 조달. 라운드 행을 먼저 만들어야 `candidates`의 외래키가 통과한다.
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
        const outcome = roundOutcomes.get(roundId);

        /**
         * 노드 상태. **fail-closed는 여기서 막는 게이트가 아니다.**
         *
         * VERIFIED는 "이 라운드가 실제 조달된 후보로 판정을 마쳤다"는 뜻이지
         * "이 항목의 모든 것이 확인됐다"는 뜻이 아니다. 확인하지 못한 항목은
         * VERIFIED→BOOKABLE 승격과 finalize를 막는다 (V9) — 그 판정은 Validation
         * Pass가 계획서 발행 직전에 한다.
         *
         * 여기서 BLOCKED로 내리면 확인 못 한 필드 하나가 뒤 라운드 전체를 멈춘다.
         * 그러면 사용자는 부분 계획서조차 못 받는다.
         */
        const status =
          outcome?.decided === true ? 'VERIFIED' : outcome?.blocked === true ? 'BLOCKED' : 'PROVISIONAL';

        // 확인하지 못한 것이 있으면 confidence로 드러낸다. live라고 주장하지 않는다.
        const confidence =
          outcome?.decided === true && outcome.unverified.length === 0 ? 'live' : 'unknown';

        for (const nodeId of nodesForRound(roundId)) {
          const result = await recordNodeUpdate(repos, payload.runId, graph, {
            nodeId,
            status,
            confidence: status === 'VERIFIED' ? (confidence === 'live' ? 'live' : 'estimated') : 'unknown',
          });
          graph = result.graph;
          staled.push(...result.staled);
          lockedDescendants.push(...result.lockedDescendants);
        }
        return { staled, lockedDescendants };
      },
    };

    /** 마무리 에이전트. 항목은 코드가 확정하고 문장만 LLM이 쓴다 */
    const documentAgent: DocumentPort = {
      async draft({ runId, roomId }) {
        if (runtime === null) {
          console.warn('[document] LLM 키가 없어 문장 없이 항목만으로 계획서를 만듭니다');
        }
        const drafted = await draftPlan(
          {
            client: runtime?.client ?? nullClient(),
            model: runtime?.config.models.document ?? 'none',
            store: createDocumentStore(repos, runId),
            onUsage: recordUsage,
          },
          {
            runId,
            roomId,
            dateRange: dates.range,
            groupCapPerPersonKrw: hard.budgetCapPerPersonKrw ?? 0,
          },
        );
        if (drafted === null) return null;

        return {
          items: drafted.items,
          budget: {
            declaredTotalPerPersonKrw: drafted.document.budget.declaredTotalPerPersonKrw,
            groupCapPerPersonKrw: drafted.document.budget.groupCapPerPersonKrw,
          },
          plan: drafted.document,
          budgetSummary: drafted.document.budget,
        };
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
        async finalize() {
          const draft = await documentAgent.draft({
            runId: payload.runId,
            roomId: payload.roomId,
          });
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

    // 중간에 멈췄으면 그 사실을 run 행에 남긴다. 부분 결과를 완주로 보이게 하지 않는다.
    const stopReason = finished.stopReason ?? null;
    await repos.runs.finish(payload.runId, 'COMPLETED', stopReason);
    if (stopReason !== null) {
      console.warn(`[worker] ${payload.runId} 조기 종료: ${stopReason}`);
    }

    const usage = await repos.llmUsage.totals(payload.runId);
    const limits = runtime?.client.limiter.snapshot();
    console.log(
      `[worker] ${payload.runId} 호출 ${usage.calls} · 토큰 ${usage.inputTokens}/${usage.outputTokens} · ` +
        `원가 $${usage.costUsd.toFixed(4)}` +
        (limits === undefined ? '' : ` · 일일 한도 ${limits.dayUsed}/${limits.dayLimit}`),
    );

    if (payload.kind === 'rerun_from_objection') {
      await applyRerunOutcome(
        repos,
        payload,
        finished,
        stopReason ?? '재실행을 마쳤습니다.',
      );
    } else {
      await repos.rooms.markCompleted(payload.roomId, finished.completedRounds);
    }


    return {
      completedRounds: finished.completedRounds,
      fallbackCount: finished.fallbackCount,
      stopReason,
      dateRange: dates.range,
      dateResolution: dates.resolution,
    };
}
