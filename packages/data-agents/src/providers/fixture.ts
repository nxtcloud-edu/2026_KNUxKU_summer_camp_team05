import type { DataRequest, QueryClass } from '@tm/contracts';
import { ProviderError, type ProviderAdapter, type ProviderResult } from '../provider.js';

/**
 * 픽스처 어댑터. 실제 제공자 어댑터의 참조 구현이자 계약 테스트용이다.
 *
 * 외부 API 호출은 mock/fixture 계약 테스트로 기본 검증하고, 실제 호출은 비용 상한이 있는
 * sandbox 또는 nightly 작업으로 분리한다 (README 개발·협업 기준).
 * 실제 어댑터(rakuten_travel, hotpepper, odsay …)도 이 인터페이스만 만족하면 된다.
 */
export interface FixtureConfig {
  id: string;
  queryClasses: readonly QueryClass[];
  /** queryClass → 응답. 함수면 요청을 받아 만든다 */
  responses: Partial<
    Record<QueryClass, ProviderResult | ((request: DataRequest) => ProviderResult)>
  >;
  /** 이 클래스는 항상 실패한다. 폴백 체인·fail-closed 테스트용 */
  failing?: readonly QueryClass[];
  /** 호출 기록. 캐시가 실제로 제공자 호출을 막았는지 확인한다 */
  calls?: DataRequest[];
}

export function createFixtureProvider(config: FixtureConfig): ProviderAdapter & {
  calls: DataRequest[];
} {
  const calls: DataRequest[] = config.calls ?? [];

  return {
    id: config.id,
    calls,
    supports(queryClass) {
      return config.queryClasses.includes(queryClass);
    },
    async fetch(request) {
      calls.push(request);
      if (config.failing?.includes(request.queryClass) === true) {
        throw new ProviderError(config.id, '제공자 장애 (픽스처)', false);
      }
      const entry = config.responses[request.queryClass];
      if (entry === undefined) {
        throw new ProviderError(config.id, `픽스처 응답 없음: ${request.queryClass}`, false);
      }
      return typeof entry === 'function' ? entry(request) : entry;
    },
  };
}
