import type { DataRequest, QueryClass } from '@tm/contracts';
import { ProviderError, type ProviderAdapter, type ProviderResult } from '../provider.js';
import { httpJson, rawRefOf, requireEnv } from './http.js';

/**
 * 카카오 로컬 API — 국내 장소 검색·좌표 변환.
 *
 * 담당 클래스: `poi.search` · `dining.search` · `geo.place_details` · `geo.geocode`
 *
 * ODsay(1,000건/일)와 달리 **각 오퍼레이션이 100,000건/일**이고 비상업 제한도 없다.
 * 그래서 국내 장소 조달의 1순위다. TourAPI는 관광공사가 큐레이션한 목록이라
 * 커버리지가 좁고, 카카오는 상호 검색이 되지만 관광 메타데이터가 없다 —
 * 둘은 대체재가 아니라 보완재다. Pack의 providers 순서가 그 판단을 갖는다.
 *
 * 이 어댑터가 답하지 않는 것:
 *   · **영업시간·휴무일이 없다.** 카카오 로컬은 place_url만 준다. `poi.hours`를
 *     지원 클래스에 넣지 않는 이유다.
 *   · **가격·정원이 없다.**
 *
 * 대중교통·도보 길찾기는 2026-07-21에 신설됐고 각 1,000건/일 무료다.
 * 엔드포인트 계약을 확인한 뒤 별도 어댑터로 붙인다 — 주소를 추측해서 넣지 않는다.
 */

const CLASSES: readonly QueryClass[] = [
  'poi.search',
  'dining.search',
  'geo.place_details',
  'geo.geocode',
];

/**
 * 카테고리 그룹 코드. 키워드 없이 좌표만 있을 때 쓴다.
 * FD6=음식점 · AD5=숙박 · AT4=관광명소 · CE7=카페
 */
const CATEGORY_BY_CLASS: Partial<Record<QueryClass, string>> = {
  'dining.search': 'FD6',
  'poi.search': 'AT4',
};

interface KakaoDocument {
  id?: string;
  place_name?: string;
  category_name?: string;
  category_group_code?: string;
  category_group_name?: string;
  phone?: string;
  address_name?: string;
  road_address_name?: string;
  /** 경도 */
  x?: string;
  /** 위도 */
  y?: string;
  place_url?: string;
  distance?: string;
}

interface KakaoResponse {
  documents?: KakaoDocument[];
  meta?: { total_count?: number; pageable_count?: number; is_end?: boolean };
  /** 오류 응답 */
  errorType?: string;
  message?: string;
}

const coordinate = (value: string | undefined): number | null => {
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export interface KakaoConfig {
  restApiKey: string;
  baseUrl?: string;
  now?: () => number;
}

export function createKakaoProvider(config: KakaoConfig): ProviderAdapter {
  const baseUrl = config.baseUrl ?? 'https://dapi.kakao.com/v2/local';
  const now = config.now ?? (() => Date.now());

  return {
    id: 'kakao',

    supports(queryClass) {
      return CLASSES.includes(queryClass);
    },

    async fetch(request: DataRequest): Promise<ProviderResult> {
      const params = request.params;
      const keyword = params['keyword'] ?? params['query'];
      const lat = params['lat'];
      const lng = params['lng'];

      // 주소 → 좌표. 다른 클래스와 응답 형태가 달라 먼저 갈라낸다.
      const isGeocode = request.queryClass === 'geo.geocode';
      const categoryCode = CATEGORY_BY_CLASS[request.queryClass];

      // 키워드도 좌표도 없으면 무엇을 찾을지 정해지지 않았다. 전국을 긁지 않는다.
      if (keyword === undefined && (lat === undefined || lng === undefined)) {
        throw new ProviderError('kakao', '필수 파라미터 누락: keyword 또는 lat/lng', false);
      }

      const path = isGeocode
        ? 'search/address.json'
        : keyword !== undefined
          ? 'search/keyword.json'
          : 'search/category.json';

      const raw = await httpJson<KakaoResponse>('kakao', `${baseUrl}/${path}`, {
        headers: { Authorization: `KakaoAK ${config.restApiKey}` },
        query: {
          query: keyword === undefined ? undefined : String(keyword),
          category_group_code: keyword !== undefined || isGeocode ? undefined : categoryCode,
          x: lng === undefined ? undefined : String(lng),
          y: lat === undefined ? undefined : String(lat),
          radius: params['radius'] === undefined ? undefined : Number(params['radius']),
          size: Math.min(Number(params['limit'] ?? 15), 15),
          page: 1,
          // 좌표가 있으면 거리순. 없으면 카카오 기본 정확도순.
          sort: lat === undefined || lng === undefined ? undefined : 'distance',
        },
      });

      if (raw.errorType !== undefined) {
        throw new ProviderError('kakao', `${raw.errorType}: ${raw.message ?? ''}`, false);
      }

      const fetchedAt = new Date(now()).toISOString();
      const places = (raw.documents ?? []).map((doc) => ({
        externalId: doc.id ?? '',
        name: doc.place_name ?? doc.address_name ?? '',
        address: doc.road_address_name === undefined || doc.road_address_name === ''
          ? (doc.address_name ?? '')
          : doc.road_address_name,
        // 카카오는 x가 경도, y가 위도다. 뒤집으면 후보가 전부 바다로 간다.
        lat: coordinate(doc.y),
        lng: coordinate(doc.x),
        tel: doc.phone === '' ? null : (doc.phone ?? null),
        category: doc.category_name ?? null,
        categoryGroup: doc.category_group_name ?? null,
        distanceMeters: coordinate(doc.distance),
        // 영업시간·휴무일은 카카오 로컬이 주지 않는다. 링크만 남긴다.
        openHours: null,
        url: doc.place_url ?? null,
        fetchedAt,
      }));

      return {
        // 정규화 Candidate 스키마가 아직 없다. 캐시에만 남는다.
        payload: { places, totalCount: raw.meta?.total_count ?? places.length },
        confidence: 'live',
        termsRef: 'kakao:developers-terms (로컬 API 100,000건/일 · 상업 이용 가능)',
        rawRef: rawRefOf(raw),
      };
    },
  };
}

export function kakaoFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderAdapter | null {
  try {
    return createKakaoProvider({ restApiKey: requireEnv('KAKAO_REST_API_KEY', env) });
  } catch {
    return null;
  }
}
