import { createHash } from 'node:crypto';
import type { DataRequest } from '@tm/contracts';
import { CLASS_POLICY } from './policy.js';

/**
 * 캐시 키 생성. agent-architecture.md 6.3의 canonicalize 계약.
 *
 * 파라미터 정렬 · 날짜 정규화 · 좌표 반올림(5자리) · 인원수 포함을 수행한다.
 * **인원수를 키에서 빼면 안 된다** — 1인 기준 캐시를 6인 조회에 재사용하면
 * 재고 부족을 놓친다 (항공 4.1). 이 규칙은 회귀 테스트로 고정되어 있다.
 */

/** 좌표는 5자리(약 1m)로 반올림한다. 그 이상은 캐시만 쪼개고 의미가 없다 */
const COORD_KEYS = new Set(['lat', 'lng', 'latitude', 'longitude']);

function normalizeValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && COORD_KEYS.has(key)) return Number(value.toFixed(5));
  if (Array.isArray(value)) {
    // 배열은 정렬한다. ['땅콩','갑각류']와 ['갑각류','땅콩']은 같은 조회다.
    return [...value].map((item, index) => normalizeValue(`${key}[${index}]`, item)).sort();
  }
  if (typeof value === 'object') return canonicalize(value as Record<string, unknown>);
  if (typeof value === 'string') {
    // ISO 날짜시각은 초 단위까지만 남긴다 (밀리초가 키를 쪼개지 않도록)
    const isoMatch = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/.exec(value);
    return isoMatch?.[1] ?? value.trim();
  }
  return value;
}

/** 키 정렬 + 값 정규화. JSON.stringify의 키 순서 의존을 제거한다 */
export function canonicalize(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(params).sort()) {
    out[key] = normalizeValue(key, params[key]);
  }
  return out;
}

/** 정책이 요구하는 키 파라미터가 빠졌는지 검사한다 */
export function missingKeyParams(request: DataRequest): string[] {
  const required = CLASS_POLICY[request.queryClass].keyParams;
  return required.filter((name) => {
    const value = request.params[name];
    return value === undefined || value === null || value === '';
  });
}

export function cacheKey(request: DataRequest): string {
  const canonical = canonicalize(request.params);
  const material = JSON.stringify([request.packId, request.queryClass, canonical]);
  return `sha256:${createHash('sha256').update(material).digest('hex')}`;
}

/**
 * 멱등 키. 재시도가 같은 키로 dedupe되도록 run·round·시도 횟수를 포함한다.
 * 근거: agent-architecture.md 6.7
 */
export function idempotencyKey(request: DataRequest, attempt: number): string {
  const material = JSON.stringify([
    request.runId,
    request.roundId,
    request.queryClass,
    canonicalize(request.params),
    attempt,
  ]);
  return `sha256:${createHash('sha256').update(material).digest('hex')}`;
}
