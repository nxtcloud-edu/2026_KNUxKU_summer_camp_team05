import type { DataRequest, QueryClass } from '@tm/contracts';
import { ProviderError, type ProviderAdapter, type ProviderResult } from '../provider.js';
import { httpJson, rawRefOf, requireEnv } from './http.js';

/**
 * Travelpayouts 항공 가격 데이터 API — Amadeus Self-Service의 대체.
 *
 * 담당 클래스: `flight.cheapest_date`
 *
 * **왜 이것뿐인가.** Amadeus Self-Service는 2026-07-17에 완전히 종료됐고
 * (신규 등록 불가·기존 키 비활성화), Kiwi Tequila는 초대제로 바뀌었으며,
 * Duffel의 무료 티어는 가상 항공사 샌드박스라 실가격이 아니다. 무료로 실제
 * 운임을 주는 경로는 현재 이것이 유일하다.
 *
 * 그런데 이 API가 주는 것은 **캐시된 최저가**다. "검색 결과에 올랐던 시점의 가격"이지
 * 지금 살 수 있는 좌석이 아니다. 그래서 계약을 이렇게 못박는다:
 *
 *   · `confidence`는 항상 `estimated`다. 절대 `live`가 아니다.
 *   · **정규화 Candidate로 만들지 않는다.** 도착 시각·소요 시간·좌석 수가 응답에 없어서
 *     flightCandidateSchema를 정직하게 채울 수 없다. 지어내면 그 순간 판결의 근거가 거짓이 된다.
 *   · `flight.offers_search` · `flight.offer_price` · `flight.group_inventory`를
 *     **지원한다고 선언하지 않는다.** 3인 동시 좌석 확보 검증은 무료 범위 밖이고,
 *     지원 선언만 해두면 게이트웨이가 이 어댑터를 부른 뒤 빈 결과를 "항공편 없음"으로
 *     읽는다. 슬롯은 비워두는 것이 정직하다.
 *
 * 그래서 이 어댑터의 결과는 **날짜 선택 신호**로만 쓰인다 — R0가 언제 떠나는 것이
 * 싼지 판단하는 재료이지 예약 대상이 아니다. `BOOKABLE`로 갈 수 없다.
 *
 * 상한: 파트너당 **시간당 200 요청/IP**.
 */

const CLASSES: readonly QueryClass[] = ['flight.cheapest_date'];

interface Quote {
  price?: number;
  airline?: string;
  flight_number?: number | string;
  departure_at?: string;
  return_at?: string;
  expires_at?: string;
}

interface TravelpayoutsResponse {
  success?: boolean;
  data?: Record<string, Record<string, Quote>>;
  currency?: string;
  error?: string;
}

export interface TravelpayoutsConfig {
  token: string;
  baseUrl?: string;
  /** 기본 통화. 응답 금액의 단위를 바꾸는 것이 아니라 요청 파라미터다 */
  currency?: string;
  now?: () => number;
}

export function createTravelpayoutsProvider(config: TravelpayoutsConfig): ProviderAdapter {
  const baseUrl = config.baseUrl ?? 'https://api.travelpayouts.com/v1/prices/cheap';
  const currency = config.currency ?? 'krw';
  const now = config.now ?? (() => Date.now());

  return {
    id: 'travelpayouts',

    supports(queryClass) {
      return CLASSES.includes(queryClass);
    },

    async fetch(request: DataRequest): Promise<ProviderResult> {
      const params = request.params;
      const origin = params['origin'];
      const destination = params['destination'];

      if (typeof origin !== 'string' || typeof destination !== 'string') {
        throw new ProviderError('travelpayouts', '필수 파라미터 누락: origin·destination (IATA)', false);
      }

      const raw = await httpJson<TravelpayoutsResponse>('travelpayouts', baseUrl, {
        query: {
          token: config.token,
          origin,
          destination,
          currency,
          // YYYY-MM이면 그 달 전체, YYYY-MM-DD면 그 날. 없으면 API 기본값.
          depart_date: params['departureDate'] === undefined ? undefined : String(params['departureDate']),
          return_date: params['returnDate'] === undefined ? undefined : String(params['returnDate']),
        },
      });

      if (raw.success === false) {
        throw new ProviderError('travelpayouts', raw.error ?? '알 수 없는 오류', false);
      }

      const fetchedAt = new Date(now()).toISOString();
      const quotes: Record<string, unknown>[] = [];
      let earliestExpiry: string | null = null;

      for (const [destinationCode, byIndex] of Object.entries(raw.data ?? {})) {
        for (const [index, quote] of Object.entries(byIndex)) {
          if (quote.price === undefined || quote.departure_at === undefined) continue;

          if (
            quote.expires_at !== undefined &&
            (earliestExpiry === null || quote.expires_at < earliestExpiry)
          ) {
            earliestExpiry = quote.expires_at;
          }

          quotes.push({
            externalId: `tp_${origin}_${destinationCode}_${index}`,
            origin,
            destination: destinationCode,
            // 왕복 1인 기준 금액. 그룹 총액은 좌석 확보가 확인된 뒤에나 의미가 있다.
            pricePerPerson: quote.price,
            currency: raw.currency?.toUpperCase() ?? currency.toUpperCase(),
            airline: quote.airline ?? null,
            flightNumber: quote.flight_number === undefined ? null : String(quote.flight_number),
            departureAt: quote.departure_at,
            returnAt: quote.return_at ?? null,
            // 이 가격이 언제까지 유효한지. 지나면 근거로 쓸 수 없다.
            expiresAt: quote.expires_at ?? null,
            // 좌석 수를 이 API는 주지 않는다. 그룹 재고는 확인되지 않았다.
            seatsAvailable: null,
            groupInventoryVerified: false,
            fetchedAt,
          });
        }
      }

      // 싼 순으로 준다. 날짜 선택 신호가 이 응답의 용도다.
      quotes.sort((left, right) => Number(left['pricePerPerson']) - Number(right['pricePerPerson']));

      return {
        // Candidate 스키마를 채울 수 없다(도착시각·소요시간·좌석 부재). 캐시에만 남는다.
        payload: { quotes, totalCount: quotes.length },
        // 캐시된 과거 검색가다. live라고 부르면 그 순간 거짓이 된다.
        confidence: 'estimated',
        validUntil: earliestExpiry,
        termsRef: 'travelpayouts:affiliate-terms (무료 토큰 · 200 req/hour/IP · 캐시 가격)',
        rawRef: rawRefOf(raw),
      };
    },
  };
}

export function travelpayoutsFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderAdapter | null {
  try {
    return createTravelpayoutsProvider({ token: requireEnv('TRAVELPAYOUTS_TOKEN', env) });
  } catch {
    return null;
  }
}
