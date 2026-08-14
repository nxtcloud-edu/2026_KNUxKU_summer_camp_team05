import type { Confidence, DataRequest, QueryClass } from '@tm/contracts';

/**
 * 제공자 어댑터. API 하나 = 어댑터 하나다.
 *
 * 어댑터는 **호출과 정규화만** 한다. 캐시·정책·쿼터·로깅을 알지 못하고, 알 필요도 없다.
 * 그래서 Pack에 제공자를 추가해도 게이트웨이는 손대지 않고, 팀이 어댑터를 나눠 붙일 수 있다.
 *
 * 어댑터가 지켜야 할 것은 하나뿐이다:
 * **응답에 없는 값을 지어내거나 보간하지 않는다.** 없으면 null + confidence 'unknown'.
 */

export interface ProviderResult<T = unknown> {
  payload: T;
  /** live = 제공자가 지금 확인해준 값 · estimated = 추정·밴드 · unknown = 확인 불가 */
  confidence: Confidence;
  /** 이 값이 언제까지 유효한가. null이면 정책 TTL을 따른다 */
  validUntil?: string | null;
  /** 이용약관 참조. 캐시 레코드에 남긴다 */
  termsRef?: string;
  /** 감사·재현용 원본 참조. LLM 컨텍스트에 절대 들어가지 않는다 */
  rawRef?: string | null;
  costUsd?: number;
}

export interface ProviderAdapter {
  /** 'rakuten_travel' | 'hotpepper' | 'odsay' … Pack의 providers 배열과 같은 이름 */
  readonly id: string;
  supports(queryClass: QueryClass): boolean;
  fetch(request: DataRequest): Promise<ProviderResult>;
}

/** 제공자 호출이 실패했다. 폴백 체인의 다음 제공자로 넘어간다 */
export class ProviderError extends Error {
  constructor(
    readonly providerId: string,
    readonly reason: string,
    readonly retryable: boolean,
  ) {
    super(`${providerId}: ${reason}`);
    this.name = 'ProviderError';
  }
}

/**
 * 제공자 우선순위 해결. Pack의 `providers` 배열이 원본이다.
 * 지역별 분기 로직이 코드에서 사라지는 것이 목적지 확정형 방의 이점이다 (기획서 9장).
 */
export interface ProviderRegistry {
  /** packId + queryClass → 시도할 어댑터 순서. 앞이 1순위, 뒤가 폴백 */
  resolve(packId: string, queryClass: QueryClass): ProviderAdapter[];
}

export function createStaticRegistry(
  adapters: readonly ProviderAdapter[],
  /** packId → 카테고리별 제공자 우선순위. Pack JSON의 providers를 그대로 넣는다 */
  packProviders: Record<string, Record<string, readonly string[]>> = {},
): ProviderRegistry {
  const byId = new Map(adapters.map((adapter) => [adapter.id, adapter]));

  return {
    resolve(packId, queryClass) {
      const category = queryClass.split('.')[0] ?? '';
      const preferred = packProviders[packId]?.[category] ?? [];

      const ordered: ProviderAdapter[] = [];
      for (const id of preferred) {
        const adapter = byId.get(id);
        if (adapter !== undefined && adapter.supports(queryClass)) ordered.push(adapter);
      }
      // Pack이 지정하지 않은 제공자도 뒤에 폴백으로 붙인다. 순서는 등록 순서.
      for (const adapter of adapters) {
        if (!ordered.includes(adapter) && adapter.supports(queryClass)) ordered.push(adapter);
      }
      return ordered;
    },
  };
}
