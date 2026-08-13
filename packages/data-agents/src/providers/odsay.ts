import type { DataRequest, QueryClass } from '@tm/contracts';
import { ProviderError, type ProviderAdapter, type ProviderResult } from '../provider.js';
import { httpJson, rawRefOf, requireEnv } from './http.js';

/**
 * ODsay — 국내 대중교통 경로.
 *
 * 담당 클래스: `transit.route` · `transit.airport_transfer`
 *
 * 정규화 원칙 (transport-referee-implementation.md):
 *   - 접근성·막차는 fail-closed다. ODsay 응답에는 계단·엘리베이터 정보가 없으므로
 *     `accessibility.verified`는 항상 false다. 모른다고 말하는 것이 계약이다.
 *   - 요금은 응답의 `payment`(원)를 그대로 쓴다. 환승 할인 재계산을 하지 않는다.
 */

const CLASSES: readonly QueryClass[] = ['transit.route', 'transit.airport_transfer'];

/** ODsay trafficType: 1=지하철, 2=버스, 3=도보 */
const MODE_BY_TRAFFIC: Record<number, 'transit' | 'walking'> = {
  1: 'transit',
  2: 'transit',
  3: 'walking',
};

interface SubPath {
  trafficType?: number;
  distance?: number;
  sectionTime?: number;
  startName?: string;
  endName?: string;
  lane?: { name?: string; busNo?: string }[];
}

interface Path {
  pathType?: number;
  info?: {
    totalTime?: number;
    payment?: number;
    busTransitCount?: number;
    subwayTransitCount?: number;
    totalWalk?: number;
    firstStartStation?: string;
    lastEndStation?: string;
  };
  subPath?: SubPath[];
}

interface OdsayResponse {
  result?: { path?: Path[] };
  error?: { msg?: string; code?: string };
}

function toCandidate(
  path: Path,
  index: number,
  variant: 'intercity' | 'airport_transfer',
  fetchedAt: string,
): Record<string, unknown> | null {
  const info = path.info;
  if (info === undefined) return null;

  const totalTime = info.totalTime ?? null;
  const fare = info.payment ?? null;
  if (totalTime === null || fare === null) return null;

  const segments = (path.subPath ?? [])
    .filter((sub) => (sub.sectionTime ?? 0) > 0)
    .map((sub) => ({
      mode: MODE_BY_TRAFFIC[sub.trafficType ?? 3] ?? 'transit',
      operator: sub.lane?.[0]?.name ?? sub.lane?.[0]?.busNo ?? null,
      from: sub.startName ?? '',
      to: sub.endName ?? '',
      departAt: null,
      arriveAt: null,
      durationMin: sub.sectionTime ?? 0,
      farePerPersonKrw: 0,
    }));

  return {
    kind: 'transport',
    id: `odsay_${variant}_${index}`,
    source: 'odsay',
    fetchedAt,
    disqualified: false,
    disqualifyReason: null,
    variant,
    label: `${info.firstStartStation ?? ''} → ${info.lastEndStation ?? ''}`.trim(),
    segments,
    totals: {
      durationMin: totalTime,
      farePerPersonKrw: fare,
      transfers: (info.busTransitCount ?? 0) + (info.subwayTransitCount ?? 0),
      walkMeters: info.totalWalk ?? 0,
    },
    policy: null,
    accessibility: {
      // ODsay는 계단·엘리베이터를 주지 않는다. 모르는 것은 null이다.
      stairsRequired: null,
      elevatorAvailable: null,
      luggageFriendly: null,
      wheelchairOk: null,
      verified: false,
    },
    bookingUrl: null,
  };
}

export interface OdsayConfig {
  apiKey: string;
  baseUrl?: string;
  now?: () => number;
}

export function createOdsayProvider(config: OdsayConfig): ProviderAdapter {
  const baseUrl = config.baseUrl ?? 'https://api.odsay.com/v1/api';
  const now = config.now ?? (() => Date.now());

  return {
    id: 'odsay',

    supports(queryClass) {
      return CLASSES.includes(queryClass);
    },

    async fetch(request: DataRequest): Promise<ProviderResult> {
      const params = request.params;
      const required = ['startX', 'startY', 'endX', 'endY'] as const;
      for (const key of required) {
        if (params[key] === undefined) {
          throw new ProviderError('odsay', `필수 파라미터 누락: ${key}`, false);
        }
      }

      const raw = await httpJson<OdsayResponse>('odsay', `${baseUrl}/searchPubTransPathT`, {
        query: {
          apiKey: config.apiKey,
          SX: String(params['startX']),
          SY: String(params['startY']),
          EX: String(params['endX']),
          EY: String(params['endY']),
          lang: 0,
          output: 'json',
        },
      });

      // ODsay는 실패도 HTTP 200으로 준다. 본문의 error를 봐야 한다.
      if (raw.error !== undefined) {
        const retryable = raw.error.code === '-99' || raw.error.code === '500';
        throw new ProviderError('odsay', raw.error.msg ?? '알 수 없는 오류', retryable);
      }

      const variant =
        request.queryClass === 'transit.airport_transfer' ? 'airport_transfer' : 'intercity';
      const fetchedAt = new Date(now()).toISOString();
      const candidates = (raw.result?.path ?? [])
        .map((path, index) => toCandidate(path, index, variant, fetchedAt))
        .filter((row): row is Record<string, unknown> => row !== null);

      return {
        payload: { candidates },
        confidence: 'live',
        termsRef: 'odsay:api-terms',
        rawRef: rawRefOf(raw),
      };
    },
  };
}

export function odsayFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderAdapter | null {
  try {
    return createOdsayProvider({ apiKey: requireEnv('ODSAY_API_KEY', env) });
  } catch {
    return null;
  }
}
