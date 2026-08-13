import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { createRateLimiter, RateLimitExhaustedError, type RateLimiter } from './rate-limit.js';

/**
 * LLM 클라이언트 — Gemini REST를 fetch로 직접 호출한다.
 *
 * SDK를 쓰지 않는 이유: 의존성 하나가 늘면 잠금파일·오프라인 설치·버전 충돌이
 * 따라온다. 필요한 것은 엔드포인트 하나이고, `packages/data-agents`의 제공자
 * 어댑터도 같은 방식(fetch)으로 되어 있어 코드 모양이 일관된다.
 *
 * 이 계층이 책임지는 것은 네 가지뿐이다:
 *   1. 레이트리밋 준수 (무료 티어의 진짜 상한)
 *   2. 429·5xx 재시도와 백오프
 *   3. 잘린 응답·차단된 응답을 **숨기지 않고 드러내기**
 *   4. 토큰 사용량을 호출자에게 그대로 넘겨 원장에 남게 하기
 *
 * 판단·수치 산출은 하지 않는다. 그건 위 계층(심판·Supervisor)과 코드의 몫이다.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  /** 캐시에서 읽은 토큰. 0이면 캐싱이 걸리지 않은 것이다 */
  cacheTokens: number;
}

export interface LlmRequest {
  /** 원장의 purpose. 'persona.statement' · 'referee.flight.verdict' 등 */
  purpose: string;
  model: string;
  /** 시스템 지시. 라운드 안에서 고정되어야 캐싱 여지가 생긴다 */
  system: string;
  prompt: string;
  /** JSON 응답을 강제한다. Gemini의 responseSchema 형식 */
  responseSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface LlmResponse {
  text: string;
  usage: LlmUsage;
  /** 'STOP' 이면 정상. 'MAX_TOKENS' · 'SAFETY' 등은 불완전한 응답이다 */
  finishReason: string;
  /** 미터 청구의 멱등 키 */
  requestId: string;
  model: string;
}

export interface LlmClient {
  generate(request: LlmRequest): Promise<LlmResponse>;
  /**
   * JSON 응답을 받아 스키마로 검증한다. 형식이 어긋나면 한 번 다시 묻는다.
   * 두 번째도 실패하면 던진다 — 깨진 값을 위 계층에 넘기지 않는다.
   */
  generateJson<T>(schema: z.ZodType<T>, request: LlmRequest): Promise<{ value: T } & Omit<LlmResponse, 'text'>>;
  limiter: RateLimiter;
}

/** 응답이 잘리거나 차단됐다. 부분 응답을 정상처럼 쓰지 않기 위해 던진다 */
export class LlmIncompleteError extends Error {
  constructor(
    readonly finishReason: string,
    readonly purpose: string,
  ) {
    super(`응답이 완성되지 않았습니다 (${finishReason}) — ${purpose}`);
    this.name = 'LlmIncompleteError';
  }
}

/** 재시도를 다 쓰고도 실패했다 */
export class LlmRequestError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly purpose: string,
  ) {
    super(`LLM 호출 실패 ${status} — ${purpose}: ${detail}`);
    this.name = 'LlmRequestError';
  }
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string; details?: unknown[] };
}

/** 429 응답이 알려주는 재대기 시간. 없으면 null */
function retryDelayMs(body: GeminiResponse, headers: Headers): number | null {
  const header = headers.get('retry-after');
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return seconds * 1000;
  }

  for (const detail of body.error?.details ?? []) {
    if (typeof detail !== 'object' || detail === null) continue;
    const row = detail as Record<string, unknown>;
    if (typeof row['retryDelay'] !== 'string') continue;
    const seconds = Number(row['retryDelay'].replace(/s$/, ''));
    if (Number.isFinite(seconds)) return seconds * 1000;
  }
  return null;
}

export interface GeminiClientOptions {
  apiKey: string;
  requestsPerMinute: number;
  requestsPerDay: number;
  /** 테스트 주입점 */
  fetchImpl?: typeof fetch;
  limiter?: RateLimiter;
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
  /** 429·5xx 재시도 횟수. 기본 3 */
  maxRetries?: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function createGeminiClient(options: GeminiClientOptions): LlmClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const baseUrl = options.baseUrl ?? ENDPOINT;
  const maxRetries = options.maxRetries ?? 3;
  const limiter =
    options.limiter ??
    createRateLimiter({
      requestsPerMinute: options.requestsPerMinute,
      requestsPerDay: options.requestsPerDay,
      ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    });

  const generate = async (request: LlmRequest): Promise<LlmResponse> => {
    const body = {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
      generationConfig: {
        ...(request.maxOutputTokens === undefined
          ? {}
          : { maxOutputTokens: request.maxOutputTokens }),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.responseSchema === undefined
          ? {}
          : { responseMimeType: 'application/json', responseSchema: request.responseSchema }),
      },
    };

    let lastDetail = '';
    let lastStatus = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      // 상한 집행은 호출 **전에** 한다. 보내고 나서 세면 이미 늦었다.
      await limiter.acquire();

      const response = await fetchImpl(`${baseUrl}/${request.model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => ({}))) as GeminiResponse;

      if (response.ok) {
        const candidate = payload.candidates?.[0];
        const finishReason = candidate?.finishReason ?? 'UNKNOWN';
        const text = (candidate?.content?.parts ?? [])
          .map((part) => part.text ?? '')
          .join('')
          .trim();

        // 안전 필터에 걸리면 candidates 자체가 비어 온다. 빈 문자열로 위장하지 않는다.
        if (candidate === undefined) {
          throw new LlmIncompleteError(
            payload.promptFeedback?.blockReason ?? 'NO_CANDIDATE',
            request.purpose,
          );
        }
        // 잘린 응답은 정상 응답이 아니다. JSON이면 파싱조차 안 된다.
        if (finishReason !== 'STOP' && text.length === 0) {
          throw new LlmIncompleteError(finishReason, request.purpose);
        }

        return {
          text,
          usage: {
            inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
            outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
            cacheTokens: payload.usageMetadata?.cachedContentTokenCount ?? 0,
          },
          finishReason,
          requestId: randomUUID(),
          model: request.model,
        };
      }

      lastStatus = response.status;
      lastDetail = payload.error?.message ?? `HTTP ${response.status}`;

      // 4xx 중 429만 재시도 대상이다. 400·403은 다시 보내도 같은 답이 온다.
      const retriable = response.status === 429 || response.status >= 500;
      if (!retriable || attempt === maxRetries) break;

      const advised = retryDelayMs(payload, response.headers);
      if (response.status === 429) {
        // 서버가 알려준 시간을 리미터에도 반영한다. 다음 호출까지 함께 늦춰야
        // 재시도만 기다렸다가 곧바로 또 429를 맞는 일이 없다.
        limiter.penalize(advised ?? 2 ** attempt * 1000);
      }
      await sleep(advised ?? 2 ** attempt * 1000);
    }

    throw new LlmRequestError(lastStatus, lastDetail, request.purpose);
  };

  return {
    generate,
    limiter,

    async generateJson(schema, request) {
      let lastIssue = '';

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await generate(
          attempt === 0
            ? request
            : {
                ...request,
                // 두 번째 시도에는 무엇이 틀렸는지 알려준다. 같은 요청을 반복하면 같은 답이 온다.
                prompt: `${request.prompt}\n\n이전 응답이 형식에 맞지 않았습니다: ${lastIssue}\n요구된 JSON 형식만 출력하세요.`,
              },
        );

        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(response.text);
        } catch {
          lastIssue = 'JSON으로 파싱되지 않음';
          continue;
        }

        const result = schema.safeParse(parsedJson);
        if (result.success) {
          const { text: _text, ...rest } = response;
          return { value: result.data, ...rest };
        }
        lastIssue = result.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', ');
      }

      throw new LlmRequestError(200, `응답 형식 불일치 — ${lastIssue}`, request.purpose);
    },
  };
}

export { RateLimitExhaustedError };
