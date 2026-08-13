import type { DataRequest, QueryClass } from '@tm/contracts';
import { ProviderError, type ProviderAdapter, type ProviderResult } from '../provider.js';
import { httpJson, rawRefOf, requireEnv } from './http.js';

/**
 * 한국관광공사 TourAPI — 국내 관광지·음식점.
 *
 * 담당 클래스: `poi.search` · `dining.search` · `geo.place_details`
 *
 * 액티비티·식당은 아직 정규화 Candidate 스키마가 없다(contracts에 flight/hotel/transport뿐).
 * 그래서 이 어댑터의 결과는 **캐시에만 남고 `candidates` 테이블에는 들어가지 않는다** —
 * 스키마를 통과하지 않은 것을 후보로 인정하면 계획서의 external_id 전수 검증이 무너진다.
 * 액티비티 스키마가 확정되면 여기 매핑만 바꾸면 된다.
 */

const CLASSES: readonly QueryClass[] = ['poi.search', 'dining.search', 'geo.place_details'];

/** TourAPI contentTypeId: 12=관광지, 39=음식점 */
const CONTENT_TYPE: Partial<Record<QueryClass, number>> = {
  'poi.search': 12,
  'dining.search': 39,
};

interface TourItem {
  contentid?: string;
  title?: string;
  addr1?: string;
  addr2?: string;
  mapx?: string;
  mapy?: string;
  tel?: string;
  firstimage?: string;
  cat3?: string;
}

interface TourResponse {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: { totalCount?: number; items?: { item?: TourItem[] } | '' };
  };
}

const coordinate = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export interface TourApiConfig {
  serviceKey: string;
  baseUrl?: string;
  now?: () => number;
}

export function createTourApiProvider(config: TourApiConfig): ProviderAdapter {
  const baseUrl = config.baseUrl ?? 'https://apis.data.go.kr/B551011/KorService1';
  const now = config.now ?? (() => Date.now());

  return {
    id: 'tourapi',

    supports(queryClass) {
      return CLASSES.includes(queryClass);
    },

    async fetch(request: DataRequest): Promise<ProviderResult> {
      const params = request.params;
      const path = request.queryClass === 'geo.place_details' ? 'detailCommon1' : 'areaBasedList1';

      const raw = await httpJson<TourResponse>('tourapi', `${baseUrl}/${path}`, {
        query: {
          serviceKey: config.serviceKey,
          MobileOS: 'ETC',
          MobileApp: 'moa',
          _type: 'json',
          numOfRows: Number(params['limit'] ?? 20),
          pageNo: 1,
          arrange: 'O',
          ...(request.queryClass === 'geo.place_details'
            ? { contentId: String(params['contentId'] ?? ''), defaultYN: 'Y', addrinfoYN: 'Y' }
            : {
                areaCode: params['areaCode'] === undefined ? undefined : String(params['areaCode']),
                sigunguCode:
                  params['sigunguCode'] === undefined ? undefined : String(params['sigunguCode']),
                contentTypeId: CONTENT_TYPE[request.queryClass] ?? 12,
              }),
        },
      });

      const header = raw.response?.header;
      // 공공데이터포털은 인증 실패도 200으로 돌려준다. resultCode를 봐야 한다.
      if (header?.resultCode !== undefined && header.resultCode !== '0000') {
        throw new ProviderError(
          'tourapi',
          `${header.resultCode}: ${header.resultMsg ?? ''}`,
          header.resultCode === '22' || header.resultCode === '01',
        );
      }

      const body = raw.response?.body;
      const items = body?.items === '' || body?.items === undefined ? [] : (body.items.item ?? []);

      const places = items.map((item) => ({
        externalId: item.contentid ?? '',
        name: item.title ?? '',
        address: [item.addr1, item.addr2].filter((part) => part !== undefined && part !== '').join(' '),
        lat: coordinate(item.mapy),
        lng: coordinate(item.mapx),
        tel: item.tel ?? null,
        category: item.cat3 ?? null,
        imageUrl: item.firstimage ?? null,
        fetchedAt: new Date(now()).toISOString(),
      }));

      return {
        // Candidate 스키마가 아니므로 `candidates` 키를 쓰지 않는다.
        // 프리페치는 이 응답을 캐시에만 남긴다.
        payload: { places, totalCount: body?.totalCount ?? places.length },
        confidence: 'live',
        termsRef: 'tourapi:공공데이터포털-이용약관',
        rawRef: rawRefOf(raw),
      };
    },
  };
}

export function tourApiFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderAdapter | null {
  try {
    return createTourApiProvider({ serviceKey: requireEnv('TOUR_API_KEY', env) });
  } catch {
    return null;
  }
}
