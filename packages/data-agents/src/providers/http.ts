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

/**
 * 자격증명을 실어 나르는 파라미터·헤더 이름.
 *
 * 라쿠텐은 `applicationId`·`accessKey`를 **쿼리스트링으로** 받는다. 그래서 호출이
 * 실패하면 오류 메시지에 URL이 통째로 섞여 들어올 수 있고, 그 메시지는 여기서
 * 끝나지 않는다 — 게이트웨이가 `fallbackReason`으로 DB `request_log`에 적고
 * 프리페치 보고서에도 그대로 실린다. 즉 **한 번 새면 로그에 영구히 남는다.**
 *
 * 그래서 어댑터마다 조심하는 대신 나가는 길목 한 곳에서 지운다.
 */
const SECRET_PARAM_NAMES = new Set([
  'applicationid',
  'accesskey',
  'apikey',
  'api_key',
  'appkey',
  'servicekey',
  'key',
  'token',
  'secret',
  'client_secret',
  'authorization',
  'x-api-key',
  'x-ncp-apigw-api-key',
]);

/** 이 호출이 들고 있는 실제 비밀 값. 이름이 아니라 값을 지워야 URL·본문 어디에 섞여도 막힌다 */
function secretValuesOf(options: HttpOptions): string[] {
  const entries = [
    ...Object.entries(options.query ?? {}),
    ...Object.entries(options.headers ?? {}),
  ];
  return entries
    .filter(([name, value]) => value !== undefined && SECRET_PARAM_NAMES.has(name.toLowerCase()))
    // 너무 짧은 값은 지우면 오히려 메시지가 뭉개진다. 자격증명은 이보다 길다.
    .map(([, value]) => String(value))
    .filter((value) => value.length >= 8);
}

/**
 * 메시지에서 비밀 값을 지운다.
 *
 * 값 자체를 치환하므로 URL에 있든 제공자가 되돌려준 본문에 있든 똑같이 막힌다.
 * 이름만 보고 지우는 방식은 응답 본문의 형태를 알아야 해서 제공자마다 새로 틀린다.
 */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    out = out.split(secret).join('***');
  }
  return out;
}

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
  const secrets = secretValuesOf(options);

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
      // 제공자가 되돌려준 본문에 우리가 보낸 키가 그대로 섞여 오는 경우가 있다.
      const detail = redactSecrets((await response.text()).slice(0, 200), secrets);
      throw new ProviderError(providerId, `HTTP ${response.status}: ${detail}`, retryable);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    const aborted = (error as Error).name === 'AbortError';
    // 네트워크 오류 메시지에는 요청 URL이 통째로 들어오는 경우가 있다 — 쿼리에 키가 있다.
    throw new ProviderError(
      providerId,
      aborted ? `타임아웃 ${timeoutMs}ms` : redactSecrets((error as Error).message, secrets),
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
