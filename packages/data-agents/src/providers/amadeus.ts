import type { DataRequest, QueryClass } from '@tm/contracts';
import { ProviderError, type ProviderAdapter, type ProviderResult } from '../provider.js';
import { httpJson, isoDurationToMinutes, rawRefOf, requireEnv } from './http.js';

/**
 * Amadeus Self-Service — 항공 조달.
 *
 * 담당 클래스: `flight.offers_search` · `flight.cheapest_date` · `flight.offer_price`
 *
 * 정규화 원칙 (flight-referee-implementation.md):
 *   - 판결 기준은 항공료가 아니라 `effectiveTotal`이다. 수하물비가 빠진 최저가는 최저가가 아니다.
 *   - **그룹 재고는 여기서 확인했다고 말하지 않는다.** `numberOfBookableSeats`는 표기값이고
 *     인원수만큼 실제로 잡히는지는 별개다. `groupInventoryVerified`는 항상 false로 둔다 —
 *     fail-closed 확인은 심판이 `flight.group_inventory`로 따로 한다.
 *   - 응답에 없는 값은 null이다. 수하물 정책을 모르면 0이 아니라 null이다.
 */

const CLASSES: readonly QueryClass[] = [
  'flight.offers_search',
  'flight.cheapest_date',
  'flight.offer_price',
];

export interface AmadeusConfig {
  clientId: string;
  clientSecret: string;
  /** 기본은 테스트 환경. 운영 전환 시 https://api.amadeus.com */
  baseUrl?: string;
  /** 테스트 주입용 */
  now?: () => number;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

interface AmadeusSegment {
  carrierCode?: string;
  number?: string;
  departure?: { iataCode?: string; terminal?: string; at?: string };
  arrival?: { iataCode?: string; terminal?: string; at?: string };
  duration?: string;
}

interface AmadeusItinerary {
  duration?: string;
  segments?: AmadeusSegment[];
}

interface AmadeusOffer {
  id?: string;
  itineraries?: AmadeusItinerary[];
  price?: { grandTotal?: string; total?: string; currency?: string };
  numberOfBookableSeats?: number;
  travelerPricings?: {
    price?: { total?: string };
    fareDetailsBySegment?: { includedCheckedBags?: { quantity?: number; weight?: number } }[];
  }[];
}

interface OffersResponse {
  data?: AmadeusOffer[];
  dictionaries?: { carriers?: Record<string, string> };
}

const number = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function legOf(
  itinerary: AmadeusItinerary | undefined,
  carriers: Record<string, string>,
): {
  carrier: { code: string; name: string };
  flightNumber: string;
  departure: { airport: string; terminal: string | null; at: string };
  arrival: { airport: string; terminal: string | null; at: string };
  durationMin: number;
  connections: number;
} | null {
  const segments = itinerary?.segments ?? [];
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (first === undefined || last === undefined) return null;

  const durationMin = isoDurationToMinutes(itinerary?.duration);
  const code = first.carrierCode ?? '';
  const departureAt = first.departure?.at;
  const arrivalAt = last.arrival?.at;
  if (durationMin === null || departureAt === undefined || arrivalAt === undefined) return null;

  return {
    carrier: { code, name: carriers[code] ?? code },
    flightNumber: `${code}${first.number ?? ''}`,
    departure: {
      airport: first.departure?.iataCode ?? '',
      terminal: first.departure?.terminal ?? null,
      at: departureAt,
    },
    arrival: {
      airport: last.arrival?.iataCode ?? '',
      terminal: last.arrival?.terminal ?? null,
      at: arrivalAt,
    },
    durationMin,
    connections: Math.max(0, segments.length - 1),
  };
}

function toCandidate(
  offer: AmadeusOffer,
  carriers: Record<string, string>,
  fetchedAt: string,
  pax: number,
): Record<string, unknown> | null {
  const outbound = legOf(offer.itineraries?.[0], carriers);
  const inbound = legOf(offer.itineraries?.[1], carriers);
  if (outbound === null || inbound === null) return null;

  const groupTotal = number(offer.price?.grandTotal ?? offer.price?.total);
  const perPerson =
    number(offer.travelerPricings?.[0]?.price?.total) ??
    (groupTotal === null ? null : groupTotal / Math.max(1, pax));
  if (groupTotal === null || perPerson === null) return null;

  const bags = offer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.includedCheckedBags;
  const checkedQuantity = bags?.quantity;
  const checkedWeight = bags?.weight;

  return {
    kind: 'flight',
    id: `amadeus_${offer.id ?? `${outbound.flightNumber}_${outbound.departure.at}`}`,
    source: 'amadeus',
    fetchedAt,
    disqualified: false,
    disqualifyReason: null,
    outbound: {
      carrier: outbound.carrier,
      flightNumber: outbound.flightNumber,
      departure: outbound.departure,
      arrival: outbound.arrival,
      durationMin: outbound.durationMin,
      connections: outbound.connections,
    },
    inbound: {
      carrier: inbound.carrier,
      flightNumber: inbound.flightNumber,
      departure: { airport: inbound.departure.airport, at: inbound.departure.at },
      arrival: { airport: inbound.arrival.airport, at: inbound.arrival.at },
      durationMin: inbound.durationMin,
      connections: inbound.connections,
    },
    price: {
      amount: perPerson,
      currency: offer.price?.currency ?? 'KRW',
      confidence: 'live',
      perPersonRoundTrip: perPerson,
      groupTotal,
    },
    baggage: {
      // 응답에 없으면 null이다. "포함 안 됨"으로 단정하지 않는다.
      checkedIncluded: checkedQuantity === undefined && checkedWeight === undefined
        ? null
        : (checkedQuantity ?? 0) > 0 || (checkedWeight ?? 0) > 0,
      checkedKg: checkedWeight ?? null,
      extraCheckedFeePerPerson: null,
    },
    seatsAvailable: offer.numberOfBookableSeats ?? null,
    // 표기 좌석 수는 그룹 재고 확인이 아니다. 승격은 심판의 fail-closed 검증 이후다.
    groupInventoryVerified: false,
    effectiveTotal: {
      perPerson,
      note: '수하물비 미확인. 실효 총액은 심판이 수하물 정책 확인 후 산출한다',
    },
    bookingUrl: null,
  };
}

export function createAmadeusProvider(config: AmadeusConfig): ProviderAdapter {
  const baseUrl = config.baseUrl ?? 'https://test.api.amadeus.com';
  const now = config.now ?? (() => Date.now());
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token !== null && token.expiresAt > now() + 30_000) return token.value;

    const response = await httpJson<TokenResponse>('amadeus', `${baseUrl}/v1/security/oauth2/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }).toString(),
    });

    token = {
      value: response.access_token,
      expiresAt: now() + response.expires_in * 1000,
    };
    return token.value;
  }

  return {
    id: 'amadeus',

    supports(queryClass) {
      return CLASSES.includes(queryClass);
    },

    async fetch(request: DataRequest): Promise<ProviderResult> {
      const bearer = await accessToken();
      const headers = { authorization: `Bearer ${bearer}` };
      const params = request.params;
      const pax = Number(params['pax'] ?? params['adults'] ?? 1);
      const fetchedAt = new Date(now()).toISOString();

      if (request.queryClass === 'flight.cheapest_date') {
        const raw = await httpJson<{ data?: { departureDate?: string; price?: { total?: string } }[] }>(
          'amadeus',
          `${baseUrl}/v1/shopping/flight-dates`,
          {
            headers,
            query: {
              origin: String(params['origin'] ?? ''),
              destination: String(params['destination'] ?? ''),
              departureDate: String(params['departureDate'] ?? ''),
              currencyCode: String(params['currency'] ?? 'KRW'),
            },
          },
        );

        return {
          payload: {
            dates: (raw.data ?? []).map((row) => ({
              date: row.departureDate ?? null,
              totalPrice: number(row.price?.total),
            })),
          },
          // 날짜별 최저가는 지수이지 확정가가 아니다.
          confidence: 'estimated',
          termsRef: 'amadeus:self-service-terms',
          rawRef: rawRefOf(raw),
        };
      }

      if (request.queryClass === 'flight.offer_price') {
        const offer = params['offer'];
        if (offer === undefined) {
          throw new ProviderError('amadeus', 'flight.offer_price에는 offer 원본이 필요합니다', false);
        }
        const raw = await httpJson<OffersResponse>(
          'amadeus',
          `${baseUrl}/v1/shopping/flight-offers/pricing`,
          { method: 'POST', headers, body: { data: { type: 'flight-offers-pricing', flightOffers: [offer] } } },
        );
        const carriers = raw.dictionaries?.carriers ?? {};
        const candidates = (raw.data ?? [])
          .map((row) => toCandidate(row, carriers, fetchedAt, pax))
          .filter((row): row is Record<string, unknown> => row !== null);

        return {
          payload: { candidates },
          confidence: 'live',
          termsRef: 'amadeus:self-service-terms',
          rawRef: rawRefOf(raw),
        };
      }

      const raw = await httpJson<OffersResponse>('amadeus', `${baseUrl}/v2/shopping/flight-offers`, {
        headers,
        query: {
          originLocationCode: String(params['origin'] ?? ''),
          destinationLocationCode: String(params['destination'] ?? ''),
          departureDate: String(params['departureDate'] ?? ''),
          returnDate: params['returnDate'] === undefined ? undefined : String(params['returnDate']),
          adults: pax,
          currencyCode: String(params['currency'] ?? 'KRW'),
          max: Number(params['max'] ?? 10),
        },
      });

      const carriers = raw.dictionaries?.carriers ?? {};
      const candidates = (raw.data ?? [])
        .map((row) => toCandidate(row, carriers, fetchedAt, pax))
        .filter((row): row is Record<string, unknown> => row !== null);

      return {
        payload: { candidates },
        confidence: 'live',
        termsRef: 'amadeus:self-service-terms',
        rawRef: rawRefOf(raw),
      };
    },
  };
}

/** 환경변수에서 만든다. 키가 없으면 만들지 않는다 (조용한 빈 결과 금지) */
export function amadeusFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderAdapter | null {
  try {
    return createAmadeusProvider({
      clientId: requireEnv('AMADEUS_CLIENT_ID', env),
      clientSecret: requireEnv('AMADEUS_CLIENT_SECRET', env),
      ...(env['AMADEUS_BASE_URL'] === undefined ? {} : { baseUrl: env['AMADEUS_BASE_URL'] }),
    });
  } catch {
    return null;
  }
}
