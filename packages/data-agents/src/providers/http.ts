import { createHash } from 'node:crypto';
import { ProviderError } from '../provider.js';

/**
 * 제공자 어댑터 공용 HTTP 계층.
 *
 * 어댑터마다 재시도·타임아웃·에러 분류를 다시 쓰면 제공자를 추가할 때마다
 * 폴백 체인의 동작이 미묘하게 달라진다. 여기 한 곳에서만 결정한다:
 *
 *   - 429 · 5xx · 네트워크 오류 → `retryable` (게이트웨이가 백오프 재시도 후 다음 제공자)
 *   - 4xx (429 제외)            → `retryable=false` (요청이 잘못됐다. 재시도는 낭비)
 *   - 타임아웃                  → retryable
 *
 * 어댑터가 지켜야 할 것은 하나뿐이다: **응답에 없는 값을 지어내지 않는다.**
 */

const DEFAULT_TIMEOUT_MS = 8000;

export interface HttpOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** POST 본문. 문자열이면 그대로, 객체면 JSON으로 보낸다 */
  body?: string | Record<string, unknown>;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
}

export function buildUrl(base: string, query: HttpOptions['query'] = {}): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function httpJson<T>(
  providerId: string,
  url: string,
  options: HttpOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const isForm = typeof options.body === 'string';
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(options.body === undefined
      ? {}
      : { 'content-type': isForm ? 'application/x-www-form-urlencoded' : 'application/json' }),
    ...options.headers,
  };

  try {
    const response = await fetch(buildUrl(url, options.query), {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined
        ? {}
        : { body: isForm ? (options.body as string) : JSON.stringify(options.body) }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      const detail = (await response.text()).slice(0, 200);
      throw new ProviderError(providerId, `HTTP ${response.status}: ${detail}`, retryable);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    const aborted = (error as Error).name === 'AbortError';
    throw new ProviderError(
      providerId,
      aborted ? `타임아웃 ${timeoutMs}ms` : (error as Error).message,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 감사용 원본 참조. 원본 JSON 자체는 LLM 컨텍스트에 절대 넣지 않으므로
 * 해시만 남긴다 (agent-architecture.md 6.6).
 */
export function rawRefOf(payload: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex')}`;
}

/** ISO 8601 duration(`PT2H30M`) → 분. 파싱 실패는 null이며 추정하지 않는다 */
export function isoDurationToMinutes(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /^P(?:([0-9]+)D)?T?(?:([0-9]+)H)?(?:([0-9]+)M)?/.exec(value);
  if (match === null) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const total = days * 1440 + hours * 60 + minutes;
  return total > 0 ? total : null;
}

/** 필수 환경변수. 없으면 어댑터를 만들지 않는다 — 조용히 빈 결과를 주지 않기 위해서다 */
export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name}이(가) 설정되지 않았습니다`);
  }
  return value;
}
