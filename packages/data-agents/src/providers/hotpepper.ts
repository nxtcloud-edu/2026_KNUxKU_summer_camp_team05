import type { DataRequest, QueryClass } from '@tm/contracts';
import { ProviderError, type ProviderAdapter, type ProviderResult } from '../provider.js';
import { numberOrUndefined, readParam } from '../provider-request.js';
import { httpJson, rawRefOf, requireEnv } from './http.js';

/**
 * ホットペッパーグルメ サーチAPI (리쿠르트 웹서비스) — 일본 식당.
 *
 * 담당 클래스: `dining.search` · `dining.hours` · `dining.diet_support`
 *
 * 구 엔드포인트(`api.hotpepper.jp`)는 2023-10-31에 끊겼다. 현행은
 * `webservice.recruit.co.jp/hotpepper/gourmet/v1/`이다.
 *
 * **정원에 대해 이 API가 말해주는 것과 말해주지 않는 것을 섞지 않는다.**
 *   · `capacity`      = 총 좌석 수. 가게 전체 규모지 우리 그룹의 자리가 아니다.
 *   · `party_capacity` = 최대 연회 수용 인원. 단체석 상한이지 예약 확정이 아니다.
 *   · **예약 슬롯·실시간 공석 필드는 없다.** 그래서 `dining.reservation_slot`을
 *     지원 클래스에 넣지 않는다 — 지원한다고 선언하면 게이트웨이가 이 어댑터를 부르고
 *     빈 결과가 "자리 없음"으로 읽힌다.
 *
 * 식당은 아직 정규화 Candidate 스키마가 없다. TourAPI와 같은 이유로 결과는
 * 캐시에만 남고 `candidates`에 들어가지 않는다.
 *
 * 약관: 무료지만 **크레딧 표시가 의무**다(로고 또는 텍스트). 점포 정보 자체의
 * 재판매는 금지고, API로 만든 서비스·소프트웨어의 유료 제공은 허용된다.
 * 화면 표기는 T1이 붙인다 — `termsRef`에 남겨 잊히지 않게 한다.
 */

const CLASSES: readonly QueryClass[] = ['dining.search', 'dining.hours', 'dining.diet_support'];

const CREDIT = 'hotpepper:recruit-webservice-terms (크레딧 표시 의무 · 점포정보 재판매 금지)';

interface HotPepperShop {
  id?: string;
  name?: string;
  name_kana?: string;
  address?: string;
  station_name?: string;
  lat?: number | string;
  lng?: number | string;
  genre?: { code?: string; name?: string; catch?: string };
  budget?: { code?: string; name?: string; average?: string };
  budget_memo?: string;
  capacity?: number | string;
  party_capacity?: number | string;
  open?: string;
  close?: string;
  private_room?: string;
  non_smoking?: string;
  course?: string;
  free_drink?: string;
  free_food?: string;
  card?: string;
  lunch?: string;
  midnight?: string;
  wifi?: string;
  parking?: string;
  urls?: { pc?: string };
}

interface HotPepperResponse {
  results?: {
    results_available?: number;
    results_returned?: string;
    shop?: HotPepperShop[];
    error?: { code?: string; message?: string }[];
  };
}

/** 숫자 필드가 빈 문자열로 오는 경우가 있다. 모르는 것은 0이 아니라 null이다 */
const numeric = (value: number | string | undefined): number | null => {
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** 'あり'/'なし' 형태의 문자열 플래그. 그 외 표현은 판정하지 않고 null로 둔다 */
const flag = (value: string | undefined): boolean | null => {
  if (value === undefined || value === '') return null;
  if (value.startsWith('あり') || value === '利用可') return true;
  if (value.startsWith('なし') || value === '利用不可') return false;
  return null;
};

export interface HotPepperConfig {
  apiKey: string;
  baseUrl?: string;
  now?: () => number;
}

export function createHotPepperProvider(config: HotPepperConfig): ProviderAdapter {
  const baseUrl = config.baseUrl ?? 'https://webservice.recruit.co.jp/hotpepper/gourmet/v1/';
  const now = config.now ?? (() => Date.now());

  return {
    id: 'hotpepper',

    supports(queryClass) {
      return CLASSES.includes(queryClass);
    },

    async fetch(request: DataRequest): Promise<ProviderResult> {
      const params = request.params;

      const raw = await httpJson<HotPepperResponse>('hotpepper', baseUrl, {
        query: {
          key: config.apiKey,
          format: 'json',
          count: Number(params['limit'] ?? 20),
          keyword: params['keyword'] === undefined ? undefined : String(params['keyword']),
          lat: numberOrUndefined(readParam(params, 'latitude', ['lat'])),
          lng: numberOrUndefined(readParam(params, 'longitude', ['lng'])),
          // range: 1=300m 2=500m 3=1000m 4=2000m 5=3000m
          range: params['range'] === undefined ? undefined : Number(params['range']),
          large_area: params['largeArea'] === undefined ? undefined : String(params['largeArea']),
          middle_area: params['middleArea'] === undefined ? undefined : String(params['middleArea']),
          small_area: params['smallArea'] === undefined ? undefined : String(params['smallArea']),
          genre: params['genre'] === undefined ? undefined : String(params['genre']),
          budget: params['budget'] === undefined ? undefined : String(params['budget']),
          // 그룹 인원으로 좁힐 수 있다. 단체석 상한 필터일 뿐 예약 확정은 아니다.
          party_capacity: numberOrUndefined(readParam(params, 'guests', ['pax'])),
        },
      });

      // 리쿠르트는 인증 실패도 200 + results.error로 돌려준다.
      const errors = raw.results?.error;
      if (errors !== undefined && errors.length > 0) {
        const first = errors[0];
        throw new ProviderError(
          'hotpepper',
          `${first?.code ?? ''}: ${first?.message ?? '알 수 없는 오류'}`,
          first?.code === '4000',
        );
      }

      const fetchedAt = new Date(now()).toISOString();
      const places = (raw.results?.shop ?? []).map((shop) => ({
        externalId: shop.id ?? '',
        name: shop.name ?? '',
        nameKana: shop.name_kana ?? null,
        address: shop.address ?? '',
        lat: numeric(shop.lat),
        lng: numeric(shop.lng),
        station: shop.station_name ?? null,
        genre: shop.genre?.name ?? null,
        genreCatch: shop.genre?.catch ?? null,
        budgetBand: shop.budget?.name ?? null,
        budgetAverage: shop.budget?.average ?? null,
        budgetMemo: shop.budget_memo ?? null,
        // 총 좌석 수. 그룹 전체가 함께 앉을 수 있다는 뜻이 아니다.
        totalSeats: numeric(shop.capacity),
        // 최대 연회 수용 인원. 상한이지 그 날짜의 확보된 자리가 아니다.
        partyCapacity: numeric(shop.party_capacity),
        // 예약 가능 여부는 이 API가 답하지 않는다. 화면에서 예약 확정으로 보이면 안 된다.
        reservationVerified: false,
        openHours: shop.open ?? null,
        closedDays: shop.close ?? null,
        privateRoom: flag(shop.private_room),
        nonSmoking: flag(shop.non_smoking),
        course: flag(shop.course),
        freeDrink: flag(shop.free_drink),
        freeFood: flag(shop.free_food),
        card: flag(shop.card),
        lunch: flag(shop.lunch),
        midnight: flag(shop.midnight),
        wifi: flag(shop.wifi),
        parking: flag(shop.parking),
        url: shop.urls?.pc ?? null,
        fetchedAt,
      }));

      return {
        // 정규화 Candidate 스키마가 아직 없다. 캐시에만 남는다.
        payload: { places, totalCount: raw.results?.results_available ?? places.length },
        confidence: 'live',
        termsRef: CREDIT,
        rawRef: rawRefOf(raw),
      };
    },
  };
}

export function hotPepperFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderAdapter | null {
  try {
    return createHotPepperProvider({ apiKey: requireEnv('HOTPEPPER_API_KEY', env) });
  } catch {
    return null;
  }
}
