import {
  QuotaExceededError,
  VerificationUnavailableError,
  dataRequestSchema,
  isAdvisoryOnly,
  type DataRequest,
  type DataResponse,
  type Evidence,
  type QueryClass,
} from '@tm/contracts';
import type { CacheRepository } from '@tm/db';
import { cacheKey, missingKeyParams } from './canonical.js';
import { quotaFor } from './agents.js';
import { CLASS_POLICY, isCacheable, meetsConfidence } from './policy.js';
import { ProviderError, type ProviderRegistry, type ProviderResult } from './provider.js';

/**
 * Data Agent 게이트웨이 — read-through의 유일한 구현.
 *
 * 인스턴스가 8종이고 제공자가 수십 개여도 이 코드는 한 벌이다.
 * 정규화 스키마·TTL·신뢰도·fail-closed 정책이 여기 한 곳에서만 강제되기 때문에
 * 심판은 "필요하면 도구 한 번"만 알면 된다 (agent-architecture.md 6.1).
 *
 * 알고리즘은 6.3과 같다:
 *   정책 조회 → (허용될 때만) 캐시 → 미스면 제공자 폴백 체인 → 정규화 → 저장 → 로그
 */

export interface GatewayDeps {
  cache: CacheRepository;
  providers: ProviderRegistry;
  /** 라운드당 호출 횟수 추적. 기본값은 인메모리 (run 단위로 새로 만든다) */
  quota?: QuotaCounter;
  now?: () => Date;
}

export interface QuotaCounter {
  used(roundId: string, queryClass: QueryClass): number;
  increment(roundId: string, queryClass: QueryClass): void;
}

export function createMemoryQuotaCounter(): QuotaCounter {
  const counts = new Map<string, number>();
  const key = (roundId: string, queryClass: QueryClass) => `${roundId}::${queryClass}`;
  return {
    used: (roundId, queryClass) => counts.get(key(roundId, queryClass)) ?? 0,
    increment: (roundId, queryClass) => {
      const k = key(roundId, queryClass);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    },
  };
}

export interface DataAgentGateway {
  resolve<T = unknown>(request: DataRequest): Promise<DataResponse<T>>;
}

const BACKOFF_ATTEMPTS = 3;

export function createDataAgent(deps: GatewayDeps): DataAgentGateway {
  const quota = deps.quota ?? createMemoryQuotaCounter();
  const now = deps.now ?? (() => new Date());

  async function callWithFallback(
    request: DataRequest,
  ): Promise<{ result: ProviderResult; providerId: string; degraded: boolean; reason?: string }> {
    const chain = deps.providers.resolve(
      request.packId,
      request.queryClass,
      request.providerOrder,
    );
    if (chain.length === 0) {
      throw new ProviderError('none', `${request.queryClass}를 지원하는 제공자가 없습니다`, false, []);
    }

    let lastReason = '';
    // 어디까지 시도했는지 남긴다. 체인 전체가 실패했을 때 실패 영수증의 provenance가 된다.
    const attempted: string[] = [];
    for (const [index, adapter] of chain.entries()) {
      attempted.push(adapter.id);
      for (let attempt = 1; attempt <= BACKOFF_ATTEMPTS; attempt += 1) {
        try {
          const result = await adapter.fetch(request);
          return {
            result,
            providerId: adapter.id,
            // 1순위가 아니면 품질 저하다. 회의록에 그대로 노출된다 (침묵 금지)
            degraded: index > 0,
            ...(index > 0 ? { reason: `1순위 제공자 실패: ${lastReason}` } : {}),
          };
        } catch (error) {
          const providerError =
            error instanceof ProviderError
              ? error
              : new ProviderError(adapter.id, (error as Error).message, false);
          lastReason = providerError.reason;
          if (!providerError.retryable || attempt === BACKOFF_ATTEMPTS) break;
        }
      }
    }
    throw new ProviderError('chain', lastReason || '모든 제공자 실패', false, attempted);
  }

  return {
    async resolve<T>(rawRequest: DataRequest): Promise<DataResponse<T>> {
      // 계약 위반은 여기서 막는다. persona:* 호출 거부도 이 스키마가 한다 (6.9).
      const request = dataRequestSchema.parse(rawRequest);
      const policy = CLASS_POLICY[request.queryClass];

      const missing = missingKeyParams(request);
      if (missing.length > 0) {
        // 인원수 누락이 대표 사례다. 캐시 키가 조용히 틀리는 것보다 실패가 낫다.
        throw new Error(
          `${request.queryClass}의 필수 캐시 키 파라미터 누락: ${missing.join(', ')}`,
        );
      }

      const cap = quotaFor(request.queryClass);
      const used = quota.used(request.roundId, request.queryClass);
      if (used >= cap) throw new QuotaExceededError(request.queryClass, cap);

      const key = cacheKey(request);
      const startedAt = Date.now();

      const finish = async (
        payload: unknown,
        evidence: Evidence,
        providerId: string,
      ): Promise<DataResponse<T>> => {
        await deps.cache.logRequest({
          runId: request.runId,
          roundId: request.roundId,
          callerId: request.callerId,
          queryClass: request.queryClass,
          purpose: request.purpose,
          canonicalHash: key,
          cacheHit: evidence.cacheHit,
          confidence: evidence.confidence,
          degraded: evidence.degraded,
          fallbackReason: evidence.fallbackReason ?? null,
          provider: providerId,
          latencyMs: Date.now() - startedAt,
        });
        return {
          payload: payload as T,
          evidence,
          quota: { classCallsUsed: quota.used(request.roundId, request.queryClass), classCallsCap: cap },
        };
      };

      // 1. 캐시 조회 — 정책이 허용할 때만
      if (isCacheable(policy, request.purpose)) {
        const record = await deps.cache.get(key);
        if (record !== undefined) {
          const fresh = record.validUntil === null || Date.parse(record.validUntil) > now().getTime();
          const trusted = meetsConfidence(policy, request.purpose, record.confidence);
          const age = (now().getTime() - Date.parse(record.retrievedAt)) / 1000;
          const strict = request.maxStalenessSec === undefined || age <= request.maxStalenessSec;

          const requestedSource =
            request.providerOrder === undefined || request.providerOrder.includes(record.source);

          if (fresh && trusted && strict && requestedSource) {
            quota.increment(request.roundId, request.queryClass);
            return finish(
              record.payload,
              {
                evidenceId: key,
                source: record.source,
                retrievedAt: record.retrievedAt,
                validUntil: record.validUntil,
                confidence: record.confidence,
                termsRef: record.termsRef ?? '',
                cacheHit: true,
                degraded: false,
                advisory: policy.advisory,
              },
              record.source,
            );
          }
        }
      }

      // 2. 제공자 호출
      quota.increment(request.roundId, request.queryClass);
      let live: Awaited<ReturnType<typeof callWithFallback>>;
      try {
        live = await callWithFallback(request);
      } catch (error) {
        // fail-closed 클래스는 조회 불가가 곧 승격 불가다. uncertainties로 넘기지 않는다.
        if (policy.failClosed) {
          throw new VerificationUnavailableError(request.queryClass, (error as Error).message);
        }
        throw error;
      }

      const retrievedAt = now().toISOString();
      const validUntil =
        live.result.validUntil ??
        (policy.ttlSec === null ? null : new Date(now().getTime() + policy.ttlSec * 1000).toISOString());

      // advisory 클래스는 신뢰도가 estimated를 넘지 못한다 (6.9).
      const confidence =
        policy.advisory && live.result.confidence === 'live' ? 'estimated' : live.result.confidence;

      const evidence: Evidence = {
        evidenceId: key,
        source: live.providerId,
        retrievedAt,
        validUntil,
        confidence,
        termsRef: live.result.termsRef ?? '',
        cacheHit: false,
        degraded: live.degraded,
        advisory: policy.advisory || isAdvisoryOnly(request.queryClass),
        ...(live.reason === undefined ? {} : { fallbackReason: live.reason }),
      };

      // 3. 저장 — never 클래스는 저장하지 않는다
      if (policy.cache !== 'never') {
        await deps.cache.put({
          key,
          packId: request.packId,
          queryClass: request.queryClass,
          payload: live.result.payload,
          source: live.providerId,
          confidence,
          termsRef: live.result.termsRef ?? null,
          rawRef: live.result.rawRef ?? null,
          retrievedAt,
          validUntil,
        });
      }

      return finish(live.result.payload, evidence, live.providerId);
    },
  };
}
