import type { DataRequest, QueryClass } from '@tm/contracts';
import { ProviderError, type ProviderAdapter, type ProviderResult } from '../provider.js';
import { httpJson, rawRefOf, requireEnv } from './http.js';

/**
 * 楽天トラベル 空室検索 (Rakuten Travel VacantHotelSearch) — 일본 숙소.
 *
 * 담당 클래스: `hotel.search` · `hotel.vacancy_price` · `hotel.room_combination`
 *              · `hotel.all_in_price`
 *
 * **이 어댑터가 첫 수직 경로(오사카·3인·3박·숙소)를 성립시킨다.**
 *
 * 이유는 응답이 아니라 요청에 있다. 이 API는 `checkinDate`·`checkoutDate`·`adultNum`·
 * `roomNum`을 **필수 검색 조건으로** 받는다. 그래서 돌아온 플랜은 "그 숙소에 방이
 * 몇 개 있다"가 아니라 **"그 날짜에 그 인원이 실제로 묵을 수 있는 플랜"**이다.
 * 총 객실 수로 그룹 수용을 추정하지 않는다는 규칙을 API 구조가 대신 지켜준다.
 *
 * 그래서 `roomCombinationVerified`는 **정확한 인원·날짜로 물었을 때만** 올린다.
 * 인원을 안 주고 부른 결과에까지 올리면 그 플래그의 의미가 사라진다.
 *
 * 반대로 올리지 않는 것도 분명하다:
 *   · **취소 조건이 응답에 없다** → `cancelPolicy`는 null이고 `BOOKABLE`로 못 간다
 *   · **잔여 객실 수가 없다** → "마지막 1실" 같은 압박을 만들 수 없다
 *   · **침대 타입이 없다** → 같은 객실 분리 동의 판정에 쓸 수 없다
 *
 * ── 2026 개편 대응 ────────────────────────────────────────────────────────
 * 라쿠텐은 2026-05-14에 구 API를 폐지했다. 세 가지가 함께 바뀌었다.
 *
 *   1. 엔드포인트  `app.rakuten.co.jp/services/api/…`
 *                  → `openapi.rakuten.co.jp/engine/api/Travel/…`
 *   2. 인증        `applicationId` 단독 → `applicationId` + `accessKey`
 *   3. 호출 제한   앱 종류에 따라 검사 방식이 다르다
 *
 * 3번이 중요하다. **반드시 「サーバーアプリ(백엔드)」로 등록해야 한다.**
 * 「Webアプリケーション」으로 등록하면 브라우저 `Referer` 헤더를 검사하는데,
 * 이 어댑터는 Node에서 호출하므로 그 헤더가 없어 전부 403이 된다. 서버 앱은
 * 대신 등록된 IP에서 오는지를 본다.
 *
 * 무료이고 **1 req/sec**가 상한이다. 초과하면 429가 온다.
 */

const CLASSES: readonly QueryClass[] = [
  'hotel.search',
  'hotel.vacancy_price',
  'hotel.room_combination',
  'hotel.all_in_price',
];

/** 공실이 없을 때 라쿠텐은 404 + not_found로 답한다. 오류가 아니라 빈 결과다 */
const NOT_FOUND = 'HTTP 404';

const TERMS = 'rakuten:webservice-terms (무료 · 1 req/sec · 서버앱 IP 제한)';

/**
 * 2026 개편으로 생긴 403 두 종류를 사람이 고칠 수 있는 문장으로 바꾼다.
 * 원문만 보면 키가 틀린 줄 알고 엉뚱한 곳을 고치게 된다.
 */
function explain403(reason: string, referer: string | null): string {
  if (reason.includes('HTTP_REFERRER_MISSING')) {
    return `${reason} — 앱이 「Webアプリケーション」으로 등록됐는데 Referer를 보내지 않았습니다. RAKUTEN_REFERER에 등록한 許可されたWebサイト와 같은 도메인을 넣으세요 (예: http://localhost/). 또는 앱 종류를 「サーバーアプリ」로 바꾸고 허용 IP를 등록하세요.`;
  }
  if (reason.includes('HTTP_REFERRER_NOT_ALLOWED')) {
    return `${reason} — 보낸 Referer(${referer ?? '(없음)'})가 앱에 등록된 許可されたWebサイト와 다릅니다. 라쿠텐 콘솔의 등록 도메인과 RAKUTEN_REFERER를 맞추세요.`;
  }
  if (reason.includes('CLIENT_IP_NOT_ALLOWED')) {
    return `${reason} — 호출한 IP가 앱에 등록되어 있지 않습니다. 'curl -s https://api.ipify.org'로 현재 공인 IP를 확인해 라쿠텐 콘솔의 허용 IP에 추가하세요 (공인 IP는 바뀔 수 있습니다).`;
  }
  return reason;
}

interface HotelBasicInfo {
  hotelNo?: number;
  hotelName?: string;
  hotelInformationUrl?: string;
  latitude?: number;
  longitude?: number;
  address1?: string;
  address2?: string;
  telephoneNo?: string;
  nearestStation?: string;
  hotelMinCharge?: number;
  reviewCount?: number;
  reviewAverage?: number;
  access?: string;
}

interface RoomBasicInfo {
  roomClass?: string;
  roomName?: string;
  planId?: string;
  planName?: string;
  withDinnerFlag?: number;
  withBreakfastFlag?: number;
  reserveUrl?: string;
}

interface DailyCharge {
  stayDate?: string;
  rakutenCharge?: number;
  total?: number;
  /** 0 = 1실당 요금, 1 = 1인당 요금. 이 값을 무시하면 3인 그룹의 총액이 3배 틀린다 */
  chargeFlag?: number;
}

interface RoomEntry {
  roomBasicInfo?: RoomBasicInfo;
  dailyCharge?: DailyCharge;
}

interface HotelEntry {
  hotelBasicInfo?: HotelBasicInfo;
  roomInfo?: RoomEntry[];
}

interface VacantHotelResponse {
  hotels?: { hotel?: HotelEntry[] }[];
  pagingInfo?: { recordCount?: number };
  error?: string;
  error_description?: string;
}

/**
 * 라쿠텐의 위경도는 **초(秒) 단위**다 (1도 = 3600초). 그대로 쓰면 좌표가 지구 밖으로 나간다.
 * datumType=1(세계측지계)로 요청하고 3600으로 나눈다.
 */
const degrees = (seconds: number | undefined): number | null => {
  if (seconds === undefined || !Number.isFinite(seconds)) return null;
  return seconds / 3600;
};

/** 숙박일수. checkout - checkin. 계산할 수 없으면 null이며 1박으로 추정하지 않는다 */
function nightsBetween(checkin: string, checkout: string): number | null {
  const start = Date.parse(`${checkin}T00:00:00Z`);
  const end = Date.parse(`${checkout}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const diff = Math.round((end - start) / 86_400_000);
  return diff > 0 ? diff : null;
}

function toCandidate(
  entry: HotelEntry,
  options: {
    pax: number;
    roomNum: number;
    nights: number;
    exactParty: boolean;
    fetchedAt: string;
  },
): Record<string, unknown> | null {
  const basic = entry.hotelBasicInfo;
  const rooms = entry.roomInfo ?? [];
  if (basic === undefined || rooms.length === 0) return null;

  const lat = degrees(basic.latitude);
  const lng = degrees(basic.longitude);
  if (lat === null || lng === null) return null;

  const { pax, roomNum, nights, exactParty, fetchedAt } = options;

  const priced = rooms
    .map((room) => {
      const charge = room.dailyCharge;
      const info = room.roomBasicInfo;
      const total = charge?.total ?? charge?.rakutenCharge;
      if (total === undefined || info === undefined) return null;

      // chargeFlag: 1 = 1인당, 0 = 1실당. 그룹 총액이 여기서 갈린다.
      const groupTotal = charge?.chargeFlag === 1 ? total * pax : total * roomNum;
      return {
        info,
        groupTotal,
        breakfast: info.withBreakfastFlag === 1,
        dinner: info.withDinnerFlag === 1,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (priced.length === 0) return null;

  const cheapest = priced.reduce((best, row) => (row.groupTotal < best.groupTotal ? row : best));
  const totalPerPerson = Math.round(cheapest.groupTotal / pax);

  // 검색 자체가 인원·객실 수를 걸고 들어갔으므로, 돌아온 플랜은 그 인원을 수용한다.
  const roomOptions = priced.map((row) => ({
    config: row.info.roomName ?? row.info.roomClass ?? '객실',
    totalGuests: pax,
    pricePerNight: Math.round(row.groupTotal / nights),
  }));

  const reserveUrl = cheapest.info.reserveUrl ?? basic.hotelInformationUrl ?? null;

  return {
    kind: 'hotel',
    id: `rakuten_${basic.hotelNo ?? cheapest.info.planId ?? ''}`,
    source: 'rakuten_travel',
    fetchedAt,
    disqualified: false,
    disqualifyReason: null,
    name: basic.hotelName ?? '',
    type: 'hotel',
    location: {
      lat,
      lng,
      area: basic.address2 ?? basic.address1 ?? '',
      address: [basic.address1, basic.address2].filter((part) => part !== undefined && part !== '').join('') || null,
    },
    price: {
      amount: cheapest.groupTotal,
      // 라쿠텐 트래블의 요금은 엔화다. 원화 환산은 ref.fx를 거치는 별도 단계다.
      currency: 'JPY',
      // 그 날짜·그 인원의 실제 판매 요금이다.
      confidence: 'live',
      perNightPerPerson: Math.round(totalPerPerson / nights),
      totalPerPerson,
      groupTotal: cheapest.groupTotal,
      // 세금·봉사료 포함 여부는 플랜마다 달라 응답만으로 단정할 수 없다.
      taxesIncluded: false,
    },
    meals: {
      breakfastIncluded: cheapest.breakfast,
      dinnerIncluded: cheapest.dinner,
      // 식사가 붙어 있다는 것과 그 가치가 얼마인지는 다르다. 금액은 응답에 없다.
      mealValuePerPersonPerNight: null,
      effectiveLodgingCost: null,
      // 알레르기 대응은 플랜 설명 자유서술이라 기계 판정 대상이 아니다.
      dietSupportVerified: false,
    },
    capacity: { maxGuests: pax, roomOptions },
    /**
     * 정확한 날짜·인원·객실 수로 물었을 때만 true.
     * 이것이 이 어댑터를 쓰는 유일한 이유이므로 조건을 느슨하게 하지 않는다.
     */
    roomCombinationVerified: exactParty,
    // 총액 확정은 취소 조건·세금까지 확인해야 한다. 응답에 없다.
    allInPriceVerified: false,
    amenities: [],
    accessibility: { wheelchair: null, elevator: null, stepFree: null },
    locationMetrics:
      basic.nearestStation === undefined
        ? {}
        : { station: { label: basic.nearestStation, minutes: 0 } },
    rating:
      basic.reviewAverage === undefined
        ? null
        : { score: basic.reviewAverage, count: basic.reviewCount ?? 0 },
    // 취소 조건은 이 API가 주지 않는다. 모르는 것은 null이고, 그래서 BOOKABLE이 안 된다.
    cancelPolicy: { freeUntil: null, penaltyAfter: null },
    bookingUrl: reserveUrl,
  };
}

export interface RakutenConfig {
  applicationId: string;
  /** 2026 개편으로 추가된 필수 자격증명. 구 "Application Secret"이 이 이름으로 바뀌었다 */
  accessKey: string;
  /**
   * 「Webアプリケーション」으로 등록했을 때 보낼 `Referer`.
   * 등록한 `許可されたWebサイト`와 같은 도메인이어야 한다 (예: `http://localhost/`).
   *
   * `Referer`는 브라우저 전용 헤더가 아니라 HTTP 클라이언트가 직접 설정할 수 있다.
   * 그래서 서버에서 호출해도 Web 앱 타입을 쓸 수 있고, 오히려 그편이 안정적이다 —
   * 서버 앱 타입은 공인 IP를 등록하는데 가정용 회선은 IP가 바뀌어 데모 중에 죽는다.
   *
   * 「サーバーアプリ」로 등록했으면 비워둔다. 그때는 IP로 검사한다.
   */
  referer?: string | null;
  baseUrl?: string;
  now?: () => number;
}

export function createRakutenProvider(config: RakutenConfig): ProviderAdapter {
  // 구 도메인(app.rakuten.co.jp)은 2026-05-14에 폐지됐다. 폴백하지 않는다.
  const baseUrl =
    config.baseUrl ?? 'https://openapi.rakuten.co.jp/engine/api/Travel/VacantHotelSearch/20170426';
  const now = config.now ?? (() => Date.now());

  return {
    id: 'rakuten_travel',

    supports(queryClass) {
      return CLASSES.includes(queryClass);
    },

    async fetch(request: DataRequest): Promise<ProviderResult> {
      const params = request.params;
      const checkinDate = params['checkinDate'];
      const checkoutDate = params['checkoutDate'];

      // 날짜 없이는 공실을 물을 수 없다. 오늘로 대체하지 않는다 — 값을 지어내는 것이다.
      if (typeof checkinDate !== 'string' || typeof checkoutDate !== 'string') {
        throw new ProviderError('rakuten_travel', '필수 파라미터 누락: checkinDate·checkoutDate', false);
      }

      const nights = nightsBetween(checkinDate, checkoutDate);
      if (nights === null) {
        throw new ProviderError('rakuten_travel', `숙박일수를 계산할 수 없습니다: ${checkinDate}~${checkoutDate}`, false);
      }

      const adultNum = params['adultNum'] ?? params['pax'];
      const roomNumParam = params['roomNum'];
      const exactParty = adultNum !== undefined && roomNumParam !== undefined;
      const pax = Number(adultNum ?? 2);
      const roomNum = Number(roomNumParam ?? 1);

      let raw: VacantHotelResponse;
      try {
        raw = await httpJson<VacantHotelResponse>('rakuten_travel', baseUrl, {
          // Web 앱 타입으로 등록했으면 등록 도메인과 같은 Referer가 있어야 통과한다.
          // 서버 앱 타입이면 referer가 null이고 라쿠텐은 IP로 검사한다.
          ...(config.referer === undefined || config.referer === null
            ? {}
            : { headers: { referer: config.referer } }),
          query: {
            applicationId: config.applicationId,
            // 2026 개편으로 필수가 됐다. 헤더로도 보낼 수 있다고 하나 헤더 이름이
            // 문서에서 확인되지 않아 쿼리로 보낸다 — 이름을 추측하지 않는다.
            accessKey: config.accessKey,
            format: 'json',
            // 세계측지계. 좌표 단위는 여전히 초(秒)다.
            datumType: 1,
            checkinDate,
            checkoutDate,
            adultNum: pax,
            roomNum,
            hits: Number(params['limit'] ?? 15),
            page: 1,
            largeClassCode: params['largeClassCode'] === undefined ? undefined : String(params['largeClassCode']),
            middleClassCode: params['middleClassCode'] === undefined ? undefined : String(params['middleClassCode']),
            smallClassCode: params['smallClassCode'] === undefined ? undefined : String(params['smallClassCode']),
            latitude: params['latitude'] === undefined ? undefined : Number(params['latitude']) * 3600,
            longitude: params['longitude'] === undefined ? undefined : Number(params['longitude']) * 3600,
            searchRadius: params['searchRadius'] === undefined ? undefined : Number(params['searchRadius']),
            maxCharge: params['maxCharge'] === undefined ? undefined : Number(params['maxCharge']),
          },
        });
      } catch (error) {
        if (error instanceof ProviderError) {
          // 공실 없음은 실패가 아니다. 빈 후보로 돌려 다음 제공자를 부르지 않게 한다.
          if (error.reason.startsWith(NOT_FOUND)) {
            return {
              payload: { candidates: [] },
              confidence: 'live',
              termsRef: TERMS,
              rawRef: null,
            };
          }
          // 2026 개편의 403 두 종류는 원인이 분명하다. 그대로 알려준다 —
          // "HTTP 403"만 보면 키가 틀린 줄 알고 엉뚱한 곳을 고치게 된다.
          throw new ProviderError(
            'rakuten_travel',
            explain403(error.reason, config.referer ?? null),
            error.retryable,
          );
        }
        throw error;
      }

      const fetchedAt = new Date(now()).toISOString();
      const candidates = (raw.hotels ?? [])
        .map((wrapper) => {
          // 라쿠텐은 한 숙소를 [{hotelBasicInfo}, {roomInfo}] 배열로 쪼개 보낸다.
          const merged: HotelEntry = {};
          for (const part of wrapper.hotel ?? []) {
            if (part.hotelBasicInfo !== undefined) merged.hotelBasicInfo = part.hotelBasicInfo;
            if (part.roomInfo !== undefined) merged.roomInfo = [...(merged.roomInfo ?? []), ...part.roomInfo];
          }
          return toCandidate(merged, { pax, roomNum, nights, exactParty, fetchedAt });
        })
        .filter((row): row is Record<string, unknown> => row !== null);

      return {
        payload: { candidates },
        confidence: 'live',
        termsRef: TERMS,
        rawRef: rawRefOf(raw),
      };
    },
  };
}

export function rakutenFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderAdapter | null {
  try {
    return createRakutenProvider({
      applicationId: requireEnv('RAKUTEN_APPLICATION_ID', env),
      // 2026 개편 이후 앱 ID만으로는 호출되지 않는다. 둘 다 없으면 어댑터를 만들지 않는다.
      accessKey: requireEnv('RAKUTEN_ACCESS_KEY', env),
      // Web 앱 타입일 때만 필요하다. 서버 앱 타입이면 비워둔다 (IP로 검사).
      referer: env['RAKUTEN_REFERER'] ?? null,
    });
  } catch {
    return null;
  }
}
