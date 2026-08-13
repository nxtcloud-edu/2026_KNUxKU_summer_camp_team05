import {
  QuotaExceededError,
  VerificationUnavailableError,
  candidateSchema,
  isAdvisoryOnly,
  type DataRequest,
  type Evidence,
  type QueryClass,
  type RoundId,
} from '@tm/contracts';
import { CLASS_POLICY } from './policy.js';
import type { DataAgentGateway } from './gateway.js';

/**
 * 프리페치 — 라운드가 시작되기 전에 후보를 미리 조달해 캐시와 DB에 채운다.
 *
 * 게이트웨이는 "필요할 때 한 번" 부르는 read-through다. 그것만으로는 라운드가
 * 시작된 뒤에야 외부 API를 때리게 되고, 심판은 조달을 기다리는 동안 아무 말도 할 수
 * 없다. 조달을 앞으로 당기면 심판은 **감시와 판정**에 집중할 수 있다.
 *
 * 프리페치가 하지 않는 것:
 *   - 후보를 선택하거나 승격시키지 않는다. 캐시를 데우고 DB에 적재할 뿐이다.
 *   - 실패해도 라운드를 막지 않는다. 캐시가 비면 심판이 그때 조달한다 (성능 손해뿐).
 *
 * 근거: agent-architecture.md 6.8 프리페치와 프리컴퓨트 · 6.3 read-through
 */

/** 프리페치를 시도할 클래스. 라운드가 무엇을 필요로 하는지의 결정론적 목록이다 */
export const PREFETCH_CLASSES_BY_ROUND: Record<RoundId, readonly QueryClass[]> = {
  r_0: ['ref.pack_config', 'ref.fx', 'ref.airport_codes', 'weather.forecast'],
  r_1a: ['flight.cheapest_date', 'flight.offers_search', 'ref.airline_codes'],
  r_1b: ['transit.airport_transfer', 'transit.route', 'transit.pass_rules', 'intercity.timetable'],
  r_2: ['hotel.area_profile', 'hotel.search', 'hotel.price_band', 'geo.travel_time'],
  r_3: ['poi.search', 'poi.hours', 'poi.ticket'],
  r_4: ['dining.search', 'dining.hours'],
  r_5: ['geo.matrix', 'geo.travel_time'],
  r_6: ['ref.fx'],
};

export type PrefetchSkipReason =
  | 'cache_forbidden'
  | 'fail_closed'
  | 'advisory'
  | 'not_in_round';

/**
 * 이 클래스를 미리 받아도 되는가.
 *
 * - 웹·RAG(`web.*` · `kb.retrieve`)는 후보 조달원이 아니다 (6.9). 심판이 필요할 때만 부른다.
 * - fail-closed는 **판정 시점의 live 값**이어야 한다. 미리 받은 값으로 안전을 보증할 수 없다.
 * - `cache: 'never'`는 저장 자체가 금지다. 미리 받아봐야 버려지고 쿼터만 태운다.
 *
 * `policy.advisory`만으로는 거르지 않는다. `hotel.price_band`처럼 승격 근거가 될 수 없을 뿐
 * 정상적인 조달 클래스인 것들이 있다 — 미리 받아 두는 편이 낫다.
 */
export function prefetchSkipReason(queryClass: QueryClass): PrefetchSkipReason | null {
  const policy = CLASS_POLICY[queryClass];
  if (isAdvisoryOnly(queryClass)) return 'advisory';
  if (policy.failClosed) return 'fail_closed';
  if (policy.cache === 'never') return 'cache_forbidden';
  return null;
}

export function prefetchableClasses(roundId: RoundId): QueryClass[] {
  return [...PREFETCH_CLASSES_BY_ROUND[roundId]].filter(
    (queryClass) => prefetchSkipReason(queryClass) === null,
  );
}

export interface PrefetchPlanInput {
  runId: string;
  roundId: RoundId;
  packId: string;
  /**
   * 클래스별 조회 파라미터. 한 클래스에 여러 건을 넣을 수 있다
   * (예: 후보 지역 3곳의 `hotel.search`).
   */
  params: Partial<Record<QueryClass, readonly Record<string, unknown>[]>>;
  /** 기본 `orchestrator:prefetch`. 페르소나는 어떤 값으로도 호출할 수 없다 */
  callerId?: string;
}

export interface PrefetchSkip {
  queryClass: QueryClass;
  reason: PrefetchSkipReason;
}

export interface PrefetchPlan {
  requests: DataRequest[];
  /** 정책이 막아 제외된 클래스. 조용히 빼지 않고 보고한다 */
  skipped: PrefetchSkip[];
}

export function planPrefetch(input: PrefetchPlanInput): PrefetchPlan {
  const allowed = new Set(PREFETCH_CLASSES_BY_ROUND[input.roundId]);
  const requests: DataRequest[] = [];
  const skipped: PrefetchSkip[] = [];
  const callerId = input.callerId ?? 'orchestrator:prefetch';

  for (const [queryClass, paramSets] of Object.entries(input.params) as [
    QueryClass,
    readonly Record<string, unknown>[] | undefined,
  ][]) {
    if (!allowed.has(queryClass)) {
      skipped.push({ queryClass, reason: 'not_in_round' });
      continue;
    }
    const reason = prefetchSkipReason(queryClass);
    if (reason !== null) {
      skipped.push({ queryClass, reason });
      continue;
    }

    for (const [index, params] of (paramSets ?? []).entries()) {
      requests.push({
        requestId: `pf_${input.runId}_${input.roundId}_${queryClass}_${index}`,
        runId: input.runId,
        roundId: input.roundId,
        callerId,
        queryClass,
        // 프리페치는 언제나 탐색이다. 검증 목적으로 미리 받는 것은 계약 위반이다.
        purpose: 'exploration',
        packId: input.packId,
        params,
      });
    }
  }

  return { requests, skipped };
}

export interface PrefetchedCandidate {
  externalId: string;
  provider: string;
  /** 정규화 스키마를 통과한 후보 */
  payload: unknown;
}

/**
 * 적재 대상. 워커가 `candidates` 리포지토리에 연결한다.
 * 여기서 DB를 직접 알지 않는 이유는 data-agents가 저장소 구현에 묶이지 않기 위해서다.
 */
export interface CandidateSink {
  collect(input: {
    queryClass: QueryClass;
    roundId: RoundId;
    evidence: Evidence;
    candidates: readonly PrefetchedCandidate[];
  }): Promise<void>;
}

export interface PrefetchFailure {
  queryClass: QueryClass;
  reason: string;
  /** 쿼터 초과인가. 이 경우 남은 클래스도 시도하지 않는다 */
  quotaExceeded: boolean;
}

export interface PrefetchReport {
  requested: number;
  /** 실제로 응답을 받아 캐시에 채운 건수 */
  warmed: number;
  /** 캐시 적중으로 제공자를 부르지 않은 건수 */
  cacheHits: number;
  candidates: number;
  skipped: PrefetchSkip[];
  failures: PrefetchFailure[];
}

/**
 * 응답 payload에서 정규화 후보를 뽑는다.
 *
 * 스키마를 통과한 것만 후보로 인정한다. 통과하지 못한 응답은 캐시에는 남지만
 * `candidates` 테이블에는 들어가지 않는다 — 심판이 인용할 수 있는 것은 정규화된
 * 후보뿐이고, 계획서의 external_id 전수 검증이 이 테이블을 원본으로 삼기 때문이다.
 */
export function extractCandidates(payload: unknown, provider: string): PrefetchedCandidate[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { candidates?: unknown[] } | null)?.candidates)
      ? ((payload as { candidates: unknown[] }).candidates)
      : [];

  const candidates: PrefetchedCandidate[] = [];
  for (const item of list) {
    const parsed = candidateSchema.safeParse(item);
    if (!parsed.success) continue;
    candidates.push({ externalId: parsed.data.id, provider, payload: parsed.data });
  }
  return candidates;
}

export interface PrefetchOptions {
  sink?: CandidateSink;
  /** 진행 상황 로그. 침묵 금지 (11장) */
  onEvent?: (event: { queryClass: QueryClass; status: 'warmed' | 'failed'; detail?: string }) => void;
}

/**
 * 계획을 실행한다. **던지지 않는다** — 프리페치 실패는 라운드를 막지 않는다.
 *
 * 클래스 쿼터를 넘기면 그 시점에 멈춘다. 프리페치가 라운드 예산을 다 먹고
 * 정작 심판이 검증 호출을 못 하는 상황이 최악이기 때문이다 (6.7).
 */
export async function runPrefetch(
  gateway: DataAgentGateway,
  plan: PrefetchPlan,
  options: PrefetchOptions = {},
): Promise<PrefetchReport> {
  const report: PrefetchReport = {
    requested: plan.requests.length,
    warmed: 0,
    cacheHits: 0,
    candidates: 0,
    skipped: [...plan.skipped],
    failures: [],
  };

  for (const request of plan.requests) {
    try {
      const response = await gateway.resolve(request);
      report.warmed += 1;
      if (response.evidence.cacheHit) report.cacheHits += 1;

      const candidates = extractCandidates(response.payload, response.evidence.source);
      report.candidates += candidates.length;

      if (options.sink !== undefined && candidates.length > 0) {
        await options.sink.collect({
          queryClass: request.queryClass,
          roundId: request.roundId as RoundId,
          evidence: response.evidence,
          candidates,
        });
      }
      options.onEvent?.({ queryClass: request.queryClass, status: 'warmed' });
    } catch (error) {
      const quotaExceeded = error instanceof QuotaExceededError;
      const reason =
        error instanceof VerificationUnavailableError
          ? `검증 불가: ${error.reason}`
          : (error as Error).message;

      report.failures.push({ queryClass: request.queryClass, reason, quotaExceeded });
      options.onEvent?.({ queryClass: request.queryClass, status: 'failed', detail: reason });

      // 쿼터를 태우면 심판이 정작 필요할 때 호출할 수 없다. 즉시 중단한다.
      if (quotaExceeded) break;
    }
  }

  return report;
}
