import { destinationPackSchema, type AgentCategory } from '@tm/contracts';

/**
 * Destination Pack → 결정론적 구조화 지식 투영.
 *
 * 이 모듈은 **Pack에 이미 있는 사실만** 다른 모양으로 정리한다.
 * 새 DB, 새 인덱스, 새 사실을 만들지 않는다. 네트워크 I/O도 없다.
 * Pack에 없는 값은 추정하지 않고 `unverifiedFields`와 `null`로 드러낸다.
 *
 * 지역 분기를 코드에 넣지 않는다는 Pack의 원칙(기획서 4.1)을 유지한다.
 * `if (country === 'JP')` 같은 분기는 여기에도 없다.
 */

export type PackCoverageGrade = 'A' | 'B' | 'C';

/**
 * 읽기 전용 Pack 소스. `@tm/db`의 `PackRepository.get()`과 구조적으로 호환된다.
 * `@tm/db`를 직접 import하지 않는 이유는 이 계층이 저장소 구현에 묶이지 않아야 하기 때문이다.
 */
export interface PackKnowledgeSource {
  get(packId: string): Promise<{ pack: unknown } | undefined>;
}

export interface PackArea {
  readonly name: string;
  /** Pack 선언 순서. Pack 작성자가 정한 우선순위이므로 재정렬하지 않는다. */
  readonly rank: number;
}

export interface PackAvgCosts {
  readonly mealMid: number;
  readonly subwayRide: number;
  readonly taxiBase: number;
}

export interface PackKnowledge {
  readonly packId: string;
  readonly displayName: string;
  readonly country: string;
  readonly coverage: PackCoverageGrade;
  readonly active: boolean;
  readonly center: { readonly lat: number; readonly lng: number };
  readonly areas: readonly PackArea[];
  readonly airports: readonly string[];
  readonly requiresAirTravel: boolean;
  readonly timezone: string;
  readonly currency: string;
  readonly displayCurrency: string;
  readonly defaultTransit: string;
  readonly recommendedNights: number;
  readonly typicalDurations: readonly number[];
  readonly peakSeasons: readonly string[];
  readonly avoidDates: readonly string[];
  readonly commonClosedDay: string | null;
  readonly reservationCulture: string | null;
  readonly avgCosts: PackAvgCosts;
  /** Pack이 승인한 Provider 우선순위. Provider별 API 파라미터는 여기서 다루지 않는다. */
  readonly providerIdsByCategory: Readonly<Record<AgentCategory, readonly string[]>>;
  readonly priceBandAreas: readonly string[];
  readonly transitPassIds: readonly string[];
  /** `verification[]`에서 status가 verified가 아닌 필드. 비어 있지 않으면 coverage A를 주장할 수 없다. */
  readonly unverifiedFields: readonly string[];
  /** priceBands로 가격을 추정하는 Pack인지. true면 숙소 가격을 실측으로 주장할 수 없다. */
  readonly lodgingPricingIsEstimated: boolean;
}

export type PackKnowledgeErrorCode = 'INVALID_PACK' | 'PACK_NOT_FOUND';

export class PackKnowledgeError extends Error {
  constructor(
    readonly code: PackKnowledgeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PackKnowledgeError';
  }
}

/** 공백만 정규화한다. 유사어 추론은 하지 않는다 — 없는 지역을 만들어내지 않기 위해서다. */
export function normalizeAreaName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function providerIdsFor(
  category: AgentCategory,
  providers: {
    hotel: readonly string[];
    dining: readonly string[];
    poi: readonly string[];
    transit: readonly string[];
    flight: readonly string[];
  },
  requiresAirTravel: boolean,
): readonly string[] {
  switch (category) {
    case 'stay':
      return providers.hotel;
    case 'dining':
      return providers.dining;
    case 'activity':
      return providers.poi;
    case 'long_distance':
      // 항공이 필요한 Pack인지의 판단은 Pack이 이미 선언했다. 코드가 지역을 추측하지 않는다.
      return requiresAirTravel ? providers.flight : providers.transit;
    case 'schedule':
      return providers.transit;
    default: {
      const exhaustive: never = category;
      return exhaustive;
    }
  }
}

/**
 * Pack 원본을 검증한 뒤 결정론적 지식으로 투영한다.
 * 같은 Pack을 넣으면 항상 같은 결과가 나온다.
 */
export function projectPackKnowledge(rawPack: unknown): PackKnowledge {
  const parsed = destinationPackSchema.safeParse(rawPack);
  if (!parsed.success) {
    throw new PackKnowledgeError('INVALID_PACK', 'Destination Pack이 계약을 만족하지 않습니다.');
  }
  const pack = parsed.data;

  const areas: PackArea[] = pack.areas.map((name, index) => ({
    name: normalizeAreaName(name),
    rank: index + 1,
  }));

  const unverifiedFields = pack.verification
    .filter((ref) => ref.status !== 'verified')
    .map((ref) => ref.field)
    .sort((left, right) => left.localeCompare(right));

  const providerIdsByCategory: Record<AgentCategory, readonly string[]> = {
    long_distance: providerIdsFor('long_distance', pack.providers, pack.requiresAirTravel),
    stay: providerIdsFor('stay', pack.providers, pack.requiresAirTravel),
    activity: providerIdsFor('activity', pack.providers, pack.requiresAirTravel),
    dining: providerIdsFor('dining', pack.providers, pack.requiresAirTravel),
    schedule: providerIdsFor('schedule', pack.providers, pack.requiresAirTravel),
  };

  return {
    packId: pack.packId,
    displayName: pack.displayName,
    country: pack.country,
    coverage: pack.coverage,
    active: pack.active,
    center: { lat: pack.center.lat, lng: pack.center.lng },
    areas,
    airports: [...pack.airports],
    requiresAirTravel: pack.requiresAirTravel,
    timezone: pack.config.timezone,
    currency: pack.config.currency,
    displayCurrency: pack.config.displayCurrency,
    defaultTransit: pack.config.defaultTransit,
    recommendedNights: pack.recommendedNights,
    typicalDurations: [...pack.typicalDurations],
    peakSeasons: [...pack.peakSeasons],
    avoidDates: [...pack.avoidDates],
    commonClosedDay: pack.config.commonClosedDay,
    reservationCulture: pack.config.reservationCulture,
    avgCosts: {
      mealMid: pack.config.avgCosts.mealMid,
      subwayRide: pack.config.avgCosts.subwayRide,
      taxiBase: pack.config.avgCosts.taxiBase,
    },
    providerIdsByCategory,
    priceBandAreas: [...new Set(pack.priceBands.map((band) => normalizeAreaName(band.area)))].sort(
      (left, right) => left.localeCompare(right),
    ),
    transitPassIds: pack.transitPasses.map((pass) => pass.id),
    unverifiedFields,
    lodgingPricingIsEstimated: pack.priceBands.length > 0,
  };
}

/** 정확히 일치하는 Pack 지역만 돌려준다. 없으면 null이다 (추측 금지). */
export function resolvePackArea(knowledge: PackKnowledge, name: string): PackArea | null {
  const normalized = normalizeAreaName(name);
  return knowledge.areas.find((area) => area.name === normalized) ?? null;
}

export function packAreaNames(knowledge: PackKnowledge): readonly string[] {
  return knowledge.areas.map((area) => area.name);
}

/** 기존 Pack 저장소에서 읽어 투영한다. 저장소 조회 외의 I/O는 없다. */
export async function loadPackKnowledge(
  source: PackKnowledgeSource,
  packId: string,
): Promise<PackKnowledge> {
  const row = await source.get(packId);
  if (row === undefined) {
    throw new PackKnowledgeError('PACK_NOT_FOUND', `Destination Pack을 찾지 못했습니다: ${packId}`);
  }
  return projectPackKnowledge(row.pack);
}
