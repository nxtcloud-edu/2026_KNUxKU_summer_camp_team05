import type { QueryClass, RoundId } from '@tm/contracts';
import {
  createDataAgent,
  planPrefetch,
  providersFromEnv,
  runPrefetch,
  type CandidateSink,
  type DataAgentGateway,
  type PrefetchReport,
  type ProviderSetup,
  type QuotaCounter,
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
  /** 클래스별 조회 파라미터. 라운드마다 무엇을 미리 받을지는 호출자가 정한다 */
  params: Partial<Record<QueryClass, readonly Record<string, unknown>[]>>;
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
    params: input.params,
  });

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
): DataAgentGateway {
  return createDataAgent({
    cache: repos.cache,
    providers: providerSetup().registry(packProviders),
    ...(quota === undefined ? {} : { quota }),
  });
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * 방 정보에서 프리페치 파라미터를 만든다.
 *
 * 필요한 입력이 없으면 그 클래스를 **넣지 않는다.** 값을 지어내면 캐시 키가 조용히
 * 틀리고, 나중에 6인 조회에 1인 캐시가 재사용되는 식의 사고가 난다 (canonical.ts).
 * 날짜가 필요한 클래스는 DateResolver가 붙기 전까지 비어 있는 것이 정상이다.
 */
export function paramsFromRoom(
  room: RoomRow,
  roundId: RoundId,
): Partial<Record<QueryClass, readonly Record<string, unknown>[]>> {
  const setting = room.setting;
  const packId = room.packId;
  const area = text(setting['area']);
  const guests = count(setting['pax']) ?? count(setting['guests']);
  const origin = text(setting['originAirport']);
  const destination = text(setting['destinationAirport']);
  const departureDate = text(setting['departureDate']);
  const returnDate = text(setting['returnDate']);

  switch (roundId) {
    case 'r_0':
      return { 'ref.pack_config': [{ packId }] };

    case 'r_1a':
      if (origin === undefined || destination === undefined || departureDate === undefined) return {};
      return {
        'flight.offers_search': [
          {
            packId,
            origin,
            destination,
            departureDate,
            ...(returnDate === undefined ? {} : { returnDate }),
            pax: guests ?? 1,
          },
        ],
      };

    case 'r_2':
      if (area === undefined || guests === undefined) return {};
      return {
        'hotel.area_profile': [{ packId, area }],
        'hotel.search': [{ packId, area, type: text(setting['lodgingType']) ?? 'hotel', guests }],
      };

    case 'r_3':
      if (area === undefined) return {};
      return { 'poi.search': [{ packId, area, category: text(setting['activityCategory']) ?? 'all' }] };

    case 'r_4':
      if (area === undefined || guests === undefined) return {};
      return { 'dining.search': [{ packId, area, genre: text(setting['diningGenre']) ?? 'all', pax: guests }] };

    default:
      return {};
  }
}
