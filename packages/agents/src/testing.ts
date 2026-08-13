import type { z } from 'zod';
import { createRateLimiter, type RateLimiter } from './rate-limit.js';
import type { LlmClient, LlmRequest, LlmResponse } from './client.js';

/**
 * 테스트용 클라이언트. 실제 호출 없이 에이전트 로직만 검증한다.
 *
 * 프로덕션 코드에 두는 이유: 워커의 스모크 스크립트도 키 없이 파이프라인을 한 바퀴
 * 돌려야 하기 때문이다. 테스트 파일에 두면 스모크에서 쓸 수 없다.
 */

export interface StubCall {
  purpose: string;
  model: string;
  system: string;
  prompt: string;
}

export interface StubClientOptions {
  /** purpose → 돌려줄 본문. 함수를 주면 요청을 보고 정할 수 있다 */
  responses?: Record<string, string | ((request: LlmRequest) => string)>;
  /** 등록되지 않은 purpose의 기본 응답 */
  fallback?: string | ((request: LlmRequest) => string);
  /** 이 purpose는 실패시킨다. 폴백 경로를 검증할 때 쓴다 */
  failOn?: readonly string[];
  usage?: { inputTokens: number; outputTokens: number; cacheTokens: number };
}

export interface StubClient extends LlmClient {
  calls: StubCall[];
  callsFor(purpose: string): StubCall[];
}

const resolve = (
  value: string | ((request: LlmRequest) => string) | undefined,
  request: LlmRequest,
): string | undefined => (typeof value === 'function' ? value(request) : value);

export function createStubClient(options: StubClientOptions = {}): StubClient {
  const calls: StubCall[] = [];
  const usage = options.usage ?? { inputTokens: 100, outputTokens: 40, cacheTokens: 0 };
  const limiter: RateLimiter = createRateLimiter({
    requestsPerMinute: 10_000,
    requestsPerDay: 10_000,
    sleep: async () => {},
  });

  let counter = 0;

  const generate = async (request: LlmRequest): Promise<LlmResponse> => {
    calls.push({
      purpose: request.purpose,
      model: request.model,
      system: request.system,
      prompt: request.prompt,
    });

    if (options.failOn?.includes(request.purpose) === true) {
      throw new Error(`스텁 실패: ${request.purpose}`);
    }

    const text =
      resolve(options.responses?.[request.purpose], request) ??
      resolve(options.fallback, request) ??
      '';

    counter += 1;
    return {
      text,
      usage,
      finishReason: 'STOP',
      requestId: `stub_${counter}`,
      model: request.model,
    };
  };

  return {
    generate,
    limiter,
    calls,
    callsFor(purpose) {
      return calls.filter((call) => call.purpose === purpose);
    },
    async generateJson<T>(schema: z.ZodType<T>, request: LlmRequest) {
      const response = await generate(request);
      const parsed = schema.safeParse(JSON.parse(response.text) as unknown);
      if (!parsed.success) {
        throw new Error(
          `스텁 응답이 스키마와 다릅니다 (${request.purpose}): ${parsed.error.issues[0]?.message ?? ''}`,
        );
      }
      const { text: _text, ...rest } = response;
      return { value: parsed.data, ...rest };
    },
  };
}
