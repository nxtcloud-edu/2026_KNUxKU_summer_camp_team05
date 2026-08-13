import type { DestinationPack, RoundId } from '@tm/contracts';
import {
  createDataAgent,
  planPrefetch,
  providersFromEnv,
  runPrefetch,
  type CandidateSink,
  type DataAgentGateway,
  type PrefetchReport,
  type ProviderAdapter,
  type ProviderSetup,
  type QuotaCounter,
  type SearchRequest,
} from '@tm/data-agents';
import type { Repositories, RoomRow, RoundRef } from '@tm/db';

/**
 * 프리페치 실행 — 라운드가 시작되기 전에 후보를 조달해 캐시와 `candidates`에 채운다.
 *
 * 여기가 그림의 "후보탐색 → DB" 화살표다. 심판은 이 테이블에서 후보를 읽고,
 * 발화 팩트체크도 이 테이블을 근거 원본으로 삼는다.
 *
 * 근거: agent-architecture.md 6.8 · 12.1 candidates
 */

export interface PrefetchDeps {
  repos: Repositories;
  gateway: DataAgentGateway;
}

/**
 * 조달 결과를 `candidates`에 적재하는 sink.
 *
 * 라운드 행이 먼저 있어야 외래키가 통과한다 — 호출자가 `runs.recordRound`를 먼저 부른다.
 */
export function createCandidateSink(repos: Repositories, ref: RoundRef): CandidateSink {
  return {
    async collect({ candidates, evidence }) {
      await repos.candidates.saveMany(
        ref,
        candidates.map((candidate) => ({
          externalId: candidate.externalId,
          provider: candidate.provider,
          payload: candidate.payload,
          // 실격 판정은 심판이 하드 제약과 대조해서 한다. 조달 시점에는 모두 살아 있다.
          disqualified: false,
          disqualifyReason: null,
        })),
      );
      void evidence;
    },
  };
}

export interface RoundPrefetchInput {
  runId: string;
  roundId: RoundId;
  packId: string;
  /** 무엇을 조달할지. 후보탐색 에이전트가 정한다 */
  requests: readonly SearchRequest[];
}

/**
 * 후보탐색 에이전트가 붙는 자리.
 *
 * **무엇을 찾을지는 에이전트가 정하고, 어떻게 가져올지는 코드가 정한다.**
 * 코드가 강제하는 것은 정책(fail-closed·캐시 금지·advisory)·쿼터·정규화 검증뿐이다.
 * 제안이 없으면 조달을 건너뛴다 — 코드가 대신 추측하지 않는다.
 */
export interface CandidateSearchPort {
  propose(input: {
    runId: string;
    roundId: RoundId;
    room: RoomRow;
    pack: DestinationPack | null;
  }): Promise<readonly SearchRequest[] | null>;
}

/**
 * 한 라운드 몫을 미리 받는다. 실패해도 던지지 않는다 —
 * 프리페치는 성능 최적화이지 조달의 유일한 경로가 아니다.
 */
export async function prefetchRound(
  deps: PrefetchDeps,
  input: RoundPrefetchInput,
): Promise<PrefetchReport> {
  const plan = planPrefetch({
    runId: input.runId,
    roundId: input.roundId,
    packId: input.packId,
    requests: input.requests,
  });

  for (const skip of plan.skipped) {
    // 정책이 막은 요청은 조용히 빼지 않는다. 에이전트가 왜 막혔는지 알아야 한다.
    console.warn(`[prefetch] ${input.roundId} ${skip.queryClass} 제외: ${skip.reason}`);
  }

  const report = await runPrefetch(deps.gateway, plan, {
    sink: createCandidateSink(deps.repos, { runId: input.runId, roundId: input.roundId }),
    onEvent(event) {
      if (event.status === 'failed') {
        // 침묵 금지. 후보가 비는 이유를 로그에 남긴다 (11장).
        console.warn(`[prefetch] ${input.roundId} ${event.queryClass} 실패: ${event.detail ?? ''}`);
      }
    },
  });

  console.log(
    `[prefetch] ${input.roundId} 요청 ${report.requested} · 조달 ${report.warmed} · 캐시적중 ${report.cacheHits} · 후보 ${report.candidates} · 실패 ${report.failures.length}`,
  );
  return report;
}

/** 제공자 구성은 프로세스당 한 번만 만들고 경고도 한 번만 낸다 */
let cachedSetup: ProviderSetup | null = null;

function providerSetup(): ProviderSetup {
  if (cachedSetup !== null) return cachedSetup;

  const setup = providersFromEnv();
  if (setup.missing.length > 0) {
    console.warn(
      `[prefetch] 키가 없어 제외된 제공자: ${setup.missing
        .map((row) => `${row.id}(${row.envVars.join(',')})`)
        .join(' · ')}`,
    );
  }
  if (setup.adapters.length === 0) {
    console.warn('[prefetch] 사용 가능한 제공자가 없습니다. 프리페치는 매번 실패로 기록됩니다.');
  }

  cachedSetup = setup;
  return setup;
}

/**
 * 워커용 게이트웨이를 만든다.
 *
 * 키가 없는 제공자는 싣지 않고 **무엇이 빠졌는지 로그로 남긴다.** 조용히 빠지면
 * 후보가 0건인 이유를 아무도 모른 채 라운드가 돈다.
 * 쿼터 카운터는 run마다 새로 만든다 — run 사이에 상한이 이월되면 안 된다.
 */
export function createWorkerGateway(
  repos: Repositories,
  quota?: QuotaCounter,
  packProviders: Record<string, Record<string, readonly string[]>> = {},
  /** 추가 어댑터. 키가 없을 때 데모 제공자를 넣는 통로다 */
  extraAdapters: readonly ProviderAdapter[] = [],
): DataAgentGateway {
  const setup = extraAdapters.length === 0 ? providerSetup() : providersFromEnv(process.env, extraAdapters);
  return createDataAgent({
    cache: repos.cache,
    providers: setup.registry(packProviders),
    ...(quota === undefined ? {} : { quota }),
  });
}
