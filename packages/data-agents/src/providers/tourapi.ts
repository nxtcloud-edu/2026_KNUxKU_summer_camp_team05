import type { DataRequest, QueryClass } from '@tm/contracts';
import { ProviderError, type ProviderAdapter, type ProviderResult } from '../provider.js';
import { readParam } from '../provider-request.js';
import { httpJson, rawRefOf, requireEnv } from './http.js';

/**
 * 한국관광공사 TourAPI — 국내 관광지·음식점·숙박.
 *
 * 담당 클래스: `poi.search` · `dining.search` · `geo.place_details` · `hotel.search`
 *              · `hotel.room_combination`
 *
 * **KorService1은 세대 교체됐다.** 현행은 `KorService2`이고 오퍼레이션 접미사도 `2`다
 * (`areaBasedList2` · `detailCommon2` · `detailIntro2` · `detailInfo2`).
 * 구 경로는 남겨두지 않는다 — 죽은 엔드포인트로 폴백하면 "후보 0건"의 원인이 가려진다.
 *
 * 액티비티·식당은 아직 정규화 Candidate 스키마가 없다(contracts에 flight/hotel/transport뿐).
 * 그래서 그쪽 결과는 **캐시에만 남고 `candidates` 테이블에는 들어가지 않는다** —
 * 스키마를 통과하지 않은 것을 후보로 인정하면 계획서의 external_id 전수 검증이 무너진다.
 *
 * 숙박만 예외다. `detailInfo2`가 **객실 단위로 기준·최대 인원을 준다**
 * (`roombasecount` · `roommaxcount`). 이것이 국내에서 그룹 정원 하드 제약을
 * 실데이터로 검사할 수 있는 유일한 경로이므로 hotel Candidate로 정규화한다.
 *
 * 다만 TourAPI는 **날짜별 재고·가격을 주지 않는다.** 요금은 비수기/성수기 밴드일 뿐이라
 * confidence는 언제나 `estimated`이고 `roomCombinationVerified`는 올리지 않는다.
 */

const CLASSES: readonly QueryClass[] = [
  'poi.search',
  'dining.search',
  'geo.place_details',
  'hotel.search',
  'hotel.room_combination',
];

/** TourAPI contentTypeId: 12=관광지, 32=숙박, 39=음식점 */
const CONTENT_TYPE: Partial<Record<QueryClass, number>> = {
  'poi.search': 12,
  'dining.search': 39,
  'hotel.search': 32,
  'hotel.room_combination': 32,
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

/** detailInfo2(contentTypeId=32)의 객실 반복 항목 */
interface TourRoomItem {
  roomcode?: string;
  roomtitle?: string;
  roombasecount?: string;
  roommaxcount?: string;
  roomoffseasonminfee1?: string;
  roomoffseasonminfee2?: string;
  roompeakseasonminfee1?: string;
  roompeakseasonminfee2?: string;
  roomaircondition?: string;
  roombath?: string;
  roomcount?: string;
}

interface TourResponse<T = TourItem> {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: { totalCount?: number; items?: { item?: T[] } | '' };
  };
}

const coordinate = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** 문자열 숫자 필드. TourAPI는 미입력을 '', '0', null로 섞어 보낸다 */
const count = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/** 응답 items는 결과가 없으면 빈 문자열로 온다 */
function itemsOf<T>(raw: TourResponse<T>): T[] {
  const body = raw.response?.body;
  if (body?.items === '' || body?.items === undefined) return [];
  return body.items.item ?? [];
}

function assertOk(raw: TourResponse<unknown>): void {
  const header = raw.response?.header;
  // 공공데이터포털은 인증 실패도 200으로 돌려준다. resultCode를 봐야 한다.
  if (header?.resultCode !== undefined && header.resultCode !== '0000') {
    throw new ProviderError(
      'tourapi',
      `${header.resultCode}: ${header.resultMsg ?? ''}`,
      header.resultCode === '22' || header.resultCode === '01',
    );
  }
}

/**
 * 객실 목록 → hotel Candidate.
 *
 * 정원이 이 후보의 존재 이유다. `roommaxcount`가 없는 객실은 **버리지 않고 제외만 한다** —
 * 정원을 모르는 객실을 인원 계산에 넣으면 "들어갈 수 있다"는 거짓 결론이 나온다.
 */
function toHotelCandidate(
  place: TourItem,
  rooms: TourRoomItem[],
  pax: number,
  nights: number,
  fetchedAt: string,
): Record<string, unknown> | null {
  const lat = coordinate(place.mapy);
  const lng = coordinate(place.mapx);
  if (lat === null || lng === null) return null;

  const roomOptions = rooms
    .map((room) => {
      const maxCount = count(room.roommaxcount);
      if (maxCount === null) return null;
      // 비수기 주중 최저가를 기준으로 쓴다. 성수기·주말은 밴드의 상단이라
      // 그것으로 비교하면 모든 국내 숙소가 실제보다 비싸 보인다.
      //
      // 요금이 없으면 **null이다. 0이 아니다.** 실제로 TourAPI 숙박은 정원은
      // 채워 보내면서 요금은 전부 0으로 주는 경우가 많다(2026-08-14 부산 표본
      // 18객실 중 요금 있는 객실 0건). 0을 가격으로 쓰면 그 숙소가 집합의
      // 최저가가 되어 예산 비교를 전부 이긴다.
      const fee =
        count(room.roomoffseasonminfee1) ??
        count(room.roomoffseasonminfee2) ??
        count(room.roompeakseasonminfee1);
      return {
        config: room.roomtitle ?? room.roomcode ?? '객실',
        totalGuests: maxCount,
        pricePerNight: fee,
      };
    })
    .filter(
      (room): room is { config: string; totalGuests: number; pricePerNight: number | null } =>
        room !== null,
    );

  // 정원을 아는 객실이 하나도 없으면 후보로 만들지 않는다.
  if (roomOptions.length === 0) return null;

  const maxGuests = roomOptions.reduce((best, room) => Math.max(best, room.totalGuests), 0);

  // 요금을 아는 객실만 최저가 계산에 넣는다. 하나도 없으면 가격은 '모름'이다.
  const pricedRooms = roomOptions.filter(
    (room): room is { config: string; totalGuests: number; pricePerNight: number } =>
      room.pricePerNight !== null,
  );
  const cheapest = pricedRooms.reduce<number | null>(
    (best, room) => (best === null || room.pricePerNight < best ? room.pricePerNight : best),
    null,
  );
  const priceKnown = cheapest !== null;
  const perNight = cheapest ?? 0;
  const total = perNight * nights;

  return {
    kind: 'hotel',
    id: `tourapi_${place.contentid ?? ''}`,
    source: 'tourapi',
    fetchedAt,
    disqualified: false,
    disqualifyReason: null,
    name: place.title ?? '',
    type: 'hotel',
    location: {
      lat,
      lng,
      area: place.addr1 ?? '',
      address: [place.addr1, place.addr2].filter((part) => part !== undefined && part !== '').join(' ') || null,
    },
    price: {
      amount: total,
      currency: 'KRW',
      // 날짜별 실가격이 아니라 시즌 밴드라 live일 수 없고, 요금 자체가 안 오면
      // 'unknown'이다. 스코어링은 unknown인 가격을 축에서 빼고 계산한다 —
      // 0을 최저가로 읽어 공짜 숙소가 예산 비교를 이기는 것을 막는다.
      confidence: priceKnown ? 'estimated' : 'unknown',
      perNightPerPerson: perNight,
      totalPerPerson: total,
      groupTotal: total * pax,
      taxesIncluded: false,
    },
    meals: {
      breakfastIncluded: null,
      dinnerIncluded: null,
      mealValuePerPersonPerNight: null,
      effectiveLodgingCost: null,
      dietSupportVerified: false,
    },
    capacity: { maxGuests, roomOptions },
    // 정원은 표기값이다. 그 날짜에 그 조합이 비어 있는지는 TourAPI가 답하지 않는다.
    roomCombinationVerified: false,
    allInPriceVerified: false,
    amenities: [],
    accessibility: { wheelchair: null, elevator: null, stepFree: null },
    locationMetrics: {},
    rating: null,
    // 환불 규정은 detailIntro2의 자유서술이라 기계 판정에 쓸 수 없다.
    cancelPolicy: { freeUntil: null, penaltyAfter: null },
    bookingUrl: null,
  };
}

export interface TourApiConfig {
  serviceKey: string;
  baseUrl?: string;
  now?: () => number;
}

export function createTourApiProvider(config: TourApiConfig): ProviderAdapter {
  const baseUrl = config.baseUrl ?? 'https://apis.data.go.kr/B551011/KorService2';
  const now = config.now ?? (() => Date.now());

  const common = {
    serviceKey: config.serviceKey,
    MobileOS: 'ETC',
    MobileApp: 'moa',
    _type: 'json',
  };

  /** 숙박: 지역 목록 → 각 숙소의 객실 정보. 목록 상위 N개만 상세를 본다 (쿼터 보호) */
  async function fetchLodging(request: DataRequest, limit: number): Promise<ProviderResult> {
    const params = request.params;
    const pax = Number(readParam(params, 'guests', ['pax']) ?? 4);
    const nights = Number(params['nights'] ?? 2);
    const detailLimit = Math.min(limit, 5);

    const listRaw = await httpJson<TourResponse>('tourapi', `${baseUrl}/areaBasedList2`, {
      query: {
        ...common,
        numOfRows: limit,
        pageNo: 1,
        arrange: 'O',
        contentTypeId: 32,
        areaCode: params['areaCode'] === undefined ? undefined : String(params['areaCode']),
        sigunguCode: params['sigunguCode'] === undefined ? undefined : String(params['sigunguCode']),
      },
    });
    assertOk(listRaw);

    const places = itemsOf(listRaw).slice(0, detailLimit);
    const fetchedAt = new Date(now()).toISOString();
    const candidates: Record<string, unknown>[] = [];

    for (const place of places) {
      if (place.contentid === undefined) continue;
      const roomRaw = await httpJson<TourResponse<TourRoomItem>>('tourapi', `${baseUrl}/detailInfo2`, {
        query: { ...common, contentId: place.contentid, contentTypeId: 32, numOfRows: 30, pageNo: 1 },
      });
      assertOk(roomRaw);

      const candidate = toHotelCandidate(place, itemsOf(roomRaw), pax, nights, fetchedAt);
      if (candidate !== null) candidates.push(candidate);
    }

    return {
      payload: { candidates },
      // 객실 정원은 확인된 사실이지만 가격·재고는 아니다. 낮은 쪽을 따른다.
      confidence: 'estimated',
      termsRef: 'tourapi:공공데이터포털-이용약관 (이용 제한 없음 · 이미지 CC-BY)',
      rawRef: rawRefOf(listRaw),
    };
  }

  return {
    id: 'tourapi',

    supports(queryClass) {
      return CLASSES.includes(queryClass);
    },

    async fetch(request: DataRequest): Promise<ProviderResult> {
      const params = request.params;
      const limit = Number(params['limit'] ?? 20);

      if (request.queryClass === 'hotel.search' || request.queryClass === 'hotel.room_combination') {
        return fetchLodging(request, limit);
      }

      const path = request.queryClass === 'geo.place_details' ? 'detailCommon2' : 'areaBasedList2';

      const raw = await httpJson<TourResponse>('tourapi', `${baseUrl}/${path}`, {
        query: {
          ...common,
          numOfRows: limit,
          pageNo: 1,
          arrange: 'O',
          ...(request.queryClass === 'geo.place_details'
            ? { contentId: String(params['contentId'] ?? '') }
            : {
                areaCode: params['areaCode'] === undefined ? undefined : String(params['areaCode']),
                sigunguCode:
                  params['sigunguCode'] === undefined ? undefined : String(params['sigunguCode']),
                contentTypeId: CONTENT_TYPE[request.queryClass] ?? 12,
              }),
        },
      });
      assertOk(raw);

      const places = itemsOf(raw).map((item) => ({
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
        payload: { places, totalCount: raw.response?.body?.totalCount ?? places.length },
        confidence: 'live',
        termsRef: 'tourapi:공공데이터포털-이용약관 (이용 제한 없음 · 이미지 CC-BY)',
        rawRef: rawRefOf(raw),
      };
    },
  };
}

export function tourApiFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderAdapter | null {
  try {
    // .env.example은 TOURAPI_SERVICE_KEY를 쓴다. 둘 다 받아들이되 공식 이름을 먼저 본다.
    const key = env['TOURAPI_SERVICE_KEY'] ?? requireEnv('TOUR_API_KEY', env);
    if (key.trim() === '') throw new Error('TOURAPI_SERVICE_KEY가 비어 있습니다');
    return createTourApiProvider({ serviceKey: key });
  } catch {
    return null;
  }
}
