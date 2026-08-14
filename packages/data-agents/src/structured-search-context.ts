import type { AgentCategory, QueryClass } from '@tm/contracts';
import type { CandidateEvidenceExecutionInput } from './candidate-evidence.js';
import { packAreaNames, resolvePackArea, type PackKnowledge } from './pack-knowledge.js';
import {
  deriveStructuredSearchIntent,
  type StructuredSearchIntent,
  type StructuredSearchIntentInput,
} from './search-intent.js';

/**
 * Structured Search Context — Intent + Destination Pack 지식을 합친 결정론 실행 맥락.
 *
 * 이 계층은 **새 QueryPlan 계약을 만들지 않는다.**
 * `CandidateEvidenceQueryPlan`은 CandidateEvidenceAgent가 계속 소유하고,
 * 여기서는 그 QueryPlan을 실행할 때 RunController가 채워야 하는 결정론 맥락만 유도한다.
 * (기존 `CandidateEvidenceExecutionInput`의 area·center·roomCount·limit·searchRadiusKm·
 *  queryBudget·expectedBriefIds가 지금까지 호출자 손에 맡겨져 있었다.)
 *
 * Provider별 API 파라미터 이름은 여기서 다루지 않는다 — 그 바인딩은 candidate-evidence.ts 소유다.
 * 네트워크 I/O가 없고, embedding·vector·chunking·semantic retrieval을 쓰지 않는다.
 *
 * 미래 RAG 삽입 지점: `StructuredSearchContext`(출력) → candidate retrieval 사이.
 * 이 파일은 그 경계 앞까지만 담당한다.
 */

/** 객실 정원 기본값. Pack이 정원을 선언하지 않으므로 코드 기본값임을 드러낸다. */
const DEFAULT_MAX_OCCUPANCY_PER_ROOM = 2;
const DEFAULT_LIMIT = 10;
const DEFAULT_SEARCH_RADIUS_KM = 1.5;
const FOCUSED_SEARCH_RADIUS_KM = 1;
/** 접근성 선호를 "강함"으로 볼 임계값. importance 3 이상에서 나오는 값이다. */
const FOCUSED_WEIGHT_BP = 6000;
/** candidate-evidence.ts가 집행하는 QueryPlan 호출 예산 상한. */
const MAX_QUERY_BUDGET = 4;

export interface CandidateSearchTarget {
  readonly area: string;
  /** Pack 선언 순서 */
  readonly packRank: number;
  readonly source: 'INTENT_PREFERRED_AREA' | 'PACK_DEFAULT';
  readonly weightBp: number;
}

export type SearchContextBlockerCode =
  | 'PACK_HAS_NO_AREA'
  | 'ALL_AREAS_AVOIDED'
  | 'QUERY_BUDGET_INSUFFICIENT'
  | 'CATEGORY_NOT_EXECUTABLE'
  | 'INVALID_TRIP_WINDOW';

export interface SearchContextBlocker {
  readonly code: SearchContextBlockerCode;
  readonly detail: string;
}

export interface StructuredSearchContext {
  readonly packId: string;
  readonly category: AgentCategory;
  readonly charterVersion: string;
  readonly intent: StructuredSearchIntent;
  readonly knowledge: PackKnowledge;
  /** 조회 대상 지역 우선순위. Pack에 존재하는 지역만 들어간다. */
  readonly targets: readonly CandidateSearchTarget[];
  readonly primaryArea: string | null;
  readonly avoidedAreas: readonly string[];
  readonly center: { readonly lat: number; readonly lng: number };
  readonly partySize: number;
  readonly roomCount: number;
  readonly maxOccupancyPerRoom: number;
  readonly nights: number;
  readonly startDate: string;
  readonly endDate: string;
  readonly queryBudget: number;
  readonly expectedBriefIds: readonly string[];
  /** Pack이 승인한 Provider 목록. QueryPlan의 providerOrder는 이 안에서 골라야 한다. */
  readonly allowedProviderIds: readonly string[];
  /** 카테고리에 대응하는 canonical queryClass. 새 enum을 만들지 않는다. */
  readonly queryClass: QueryClass | null;
  readonly searchRadiusKm: number;
  readonly limit: number;
  /** 현재 실행 포트가 지원하는 조합인지 (stay + hotel.search만 지원). */
  readonly executablePath: boolean;
  readonly notes: readonly string[];
  /** 비어 있지 않으면 Provider 조회로 진행하지 않는다 (fail-closed). */
  readonly blockers: readonly SearchContextBlocker[];
}

export type SearchContextErrorCode = 'BLOCKED' | 'INVALID_INPUT';

export class SearchContextError extends Error {
  constructor(
    readonly code: SearchContextErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SearchContextError';
  }
}

export interface StructuredSearchContextInput extends StructuredSearchIntentInput {
  readonly knowledge: PackKnowledge;
  readonly maxOccupancyPerRoom?: number;
  readonly limit?: number;
  readonly searchRadiusKm?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nightsBetween(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

/** 카테고리 → canonical queryClass. contracts의 기존 enum만 사용한다. */
export function queryClassForCategory(
  category: AgentCategory,
  requiresAirTravel: boolean,
): QueryClass | null {
  switch (category) {
    case 'stay':
      return 'hotel.search';
    case 'dining':
      return 'dining.search';
    case 'activity':
      return 'poi.search';
    case 'long_distance':
      return requiresAirTravel ? 'flight.offers_search' : 'intercity.timetable';
    case 'schedule':
      // 일정은 후보 조달 카테고리가 아니다. 억지로 매핑하지 않는다.
      return null;
    default: {
      const exhaustive: never = category;
      return exhaustive;
    }
  }
}

/**
 * 객실 수. **UNKNOWN을 분리 동의로 해석하지 않는다.**
 * 분리 권한이 확인되지 않으면 한 객실로 본다 (동의 없는 객실 분리 금지).
 */
export function deriveRoomCount(
  partySize: number,
  roomSplitAuthority: StructuredSearchIntent['hard']['roomSplitAuthority'],
  maxOccupancyPerRoom: number,
): number {
  if (roomSplitAuthority !== 'SPLIT_ALLOWED') return 1;
  return Math.max(1, Math.ceil(partySize / Math.max(1, maxOccupancyPerRoom)));
}

/**
 * Intent와 Pack 지식을 합쳐 실행 맥락을 만든다. 같은 입력이면 항상 같은 출력이 나온다.
 */
export function buildStructuredSearchContext(
  input: StructuredSearchContextInput,
): StructuredSearchContext {
  const knowledge = input.knowledge;
  const intent = deriveStructuredSearchIntent({
    ...input,
    // Pack에 실제로 있는 지역만 지역 선호로 인정한다.
    knownAreas: input.knownAreas ?? packAreaNames(knowledge),
  });

  const notes: string[] = [];
  const blockers: SearchContextBlocker[] = [];

  const avoidedAreas = intent.soft
    .filter((preference) => preference.direction === 'AVOID' && preference.target.kind === 'area')
    .map((preference) => (preference.target.kind === 'area' ? preference.target.area : ''))
    .filter((area) => area.length > 0)
    .sort((left, right) => left.localeCompare(right));
  const avoidedSet = new Set(avoidedAreas);

  const preferredTargets: CandidateSearchTarget[] = [];
  const preferredAreas = intent.soft
    .filter((preference) => preference.direction === 'PREFER' && preference.target.kind === 'area')
    .sort(
      (left, right) =>
        right.weightBp - left.weightBp ||
        (left.target.kind === 'area' && right.target.kind === 'area'
          ? left.target.area.localeCompare(right.target.area)
          : 0),
    );
  for (const preference of preferredAreas) {
    if (preference.target.kind !== 'area') continue;
    if (avoidedSet.has(preference.target.area)) continue;
    const packArea = resolvePackArea(knowledge, preference.target.area);
    if (packArea === null) continue;
    preferredTargets.push({
      area: packArea.name,
      packRank: packArea.rank,
      source: 'INTENT_PREFERRED_AREA',
      weightBp: preference.weightBp,
    });
  }

  const seen = new Set(preferredTargets.map((target) => target.area));
  const defaultTargets: CandidateSearchTarget[] = knowledge.areas
    .filter((area) => !seen.has(area.name) && !avoidedSet.has(area.name))
    .map((area) => ({
      area: area.name,
      packRank: area.rank,
      source: 'PACK_DEFAULT' as const,
      weightBp: 0,
    }));
  const targets = [...preferredTargets, ...defaultTargets];

  if (knowledge.areas.length === 0) {
    blockers.push({ code: 'PACK_HAS_NO_AREA', detail: 'Destination Pack에 지역이 없습니다.' });
  } else if (targets.length === 0) {
    blockers.push({
      code: 'ALL_AREAS_AVOIDED',
      detail: '모든 Pack 지역이 회피 대상이라 조회할 지역이 없습니다.',
    });
  }

  const maxOccupancyPerRoom = Math.max(
    1,
    Math.trunc(input.maxOccupancyPerRoom ?? DEFAULT_MAX_OCCUPANCY_PER_ROOM),
  );
  const roomCount = deriveRoomCount(
    intent.hard.partySize,
    intent.hard.roomSplitAuthority,
    maxOccupancyPerRoom,
  );
  if (intent.hard.roomSplitAuthority === 'UNKNOWN') {
    notes.push('객실 분리 권한이 확인되지 않아 단일 객실 기준으로 조회합니다.');
  }

  const nights = nightsBetween(input.charter.startDate, input.charter.endDate);
  if (nights <= 0) {
    blockers.push({
      code: 'INVALID_TRIP_WINDOW',
      detail: 'TripCharter 날짜에서 숙박 일수를 계산할 수 없습니다.',
    });
  } else if (!knowledge.typicalDurations.includes(nights)) {
    notes.push(
      `숙박 ${nights}박은 Pack의 일반 일정(${knowledge.typicalDurations.join(', ')}박)에 없습니다.`,
    );
  }

  const expectedBriefIds = [...intent.briefIds];
  const queryBudget = expectedBriefIds.length;
  if (queryBudget > MAX_QUERY_BUDGET) {
    blockers.push({
      code: 'QUERY_BUDGET_INSUFFICIENT',
      detail: `Brief ${queryBudget}개는 QueryPlan 호출 예산 ${MAX_QUERY_BUDGET}개를 초과합니다.`,
    });
  }

  const queryClass = queryClassForCategory(input.category, knowledge.requiresAirTravel);
  if (queryClass === null) {
    blockers.push({
      code: 'CATEGORY_NOT_EXECUTABLE',
      detail: `${input.category} 카테고리에는 후보 조달 queryClass가 없습니다.`,
    });
  }

  const wantsFocusedRadius = intent.soft.some(
    (preference) =>
      preference.direction === 'PREFER' &&
      preference.weightBp >= FOCUSED_WEIGHT_BP &&
      ((preference.target.kind === 'axis' && preference.target.axis === 'station_access') ||
        preference.target.kind === 'area'),
  );
  const searchRadiusKm = clamp(
    input.searchRadiusKm ??
      (wantsFocusedRadius ? FOCUSED_SEARCH_RADIUS_KM : DEFAULT_SEARCH_RADIUS_KM),
    0.1,
    3,
  );
  const limit = clamp(Math.trunc(input.limit ?? DEFAULT_LIMIT), 1, 20);

  const allowedProviderIds = knowledge.providerIdsByCategory[input.category] ?? [];
  if (allowedProviderIds.length === 0) {
    notes.push(`${input.category} 카테고리에 Pack이 승인한 Provider가 없습니다.`);
  }
  if (knowledge.unverifiedFields.length > 0) {
    notes.push(`Pack 미검증 필드 ${knowledge.unverifiedFields.length}건이 있습니다.`);
  }
  if (knowledge.lodgingPricingIsEstimated) {
    notes.push('Pack 숙소 가격은 priceBand 추정값입니다. 실측 가격으로 주장할 수 없습니다.');
  }
  if (intent.unresolvedRefs.length > 0) {
    notes.push(`해석하지 못한 프로필 참조 ${intent.unresolvedRefs.length}건이 있습니다.`);
  }
  if (intent.unmappedTerms.length > 0) {
    notes.push(`구조화하지 못한 자연어 표현 ${intent.unmappedTerms.length}건이 있습니다.`);
  }

  const primaryArea = targets[0]?.area ?? null;
  const executablePath = input.category === 'stay' && queryClass === 'hotel.search';
  if (!executablePath) {
    notes.push('현재 Provider 실행 포트는 stay + hotel.search만 지원합니다.');
  }

  return {
    packId: knowledge.packId,
    category: input.category,
    charterVersion: intent.charterVersion,
    intent,
    knowledge,
    targets,
    primaryArea,
    avoidedAreas,
    center: { lat: knowledge.center.lat, lng: knowledge.center.lng },
    partySize: intent.hard.partySize,
    roomCount,
    maxOccupancyPerRoom,
    nights,
    startDate: input.charter.startDate,
    endDate: input.charter.endDate,
    queryBudget,
    expectedBriefIds,
    allowedProviderIds: [...allowedProviderIds],
    queryClass,
    searchRadiusKm,
    limit,
    executablePath,
    notes: [...notes].sort((left, right) => left.localeCompare(right)),
    blockers: [...blockers].sort((left, right) => left.code.localeCompare(right.code)),
  };
}

/**
 * 기존 CandidateEvidence 실행 계약에 그대로 넣을 수 있는 부분 맥락.
 *
 * QueryPlan 자체(queryClass·providerOrder·searchTerms·params)는 여전히
 * CandidateEvidenceAgent가 만들고 candidate-evidence.ts가 검증·바인딩한다.
 * blocker가 있으면 Provider 조회를 시작하지 않는다.
 */
export function toCandidateEvidenceExecutionContext(
  context: StructuredSearchContext,
): Pick<
  CandidateEvidenceExecutionInput,
  | 'packId'
  | 'category'
  | 'area'
  | 'center'
  | 'roomCount'
  | 'limit'
  | 'searchRadiusKm'
  | 'queryBudget'
  | 'expectedBriefIds'
> {
  if (context.blockers.length > 0) {
    throw new SearchContextError(
      'BLOCKED',
      `조회를 시작할 수 없습니다: ${context.blockers.map((blocker) => blocker.code).join(', ')}`,
    );
  }
  if (context.primaryArea === null) {
    throw new SearchContextError('BLOCKED', '조회할 Pack 지역이 없습니다.');
  }
  return {
    packId: context.packId,
    category: context.category,
    area: context.primaryArea,
    center: { lat: context.center.lat, lng: context.center.lng },
    roomCount: context.roomCount,
    limit: context.limit,
    searchRadiusKm: context.searchRadiusKm,
    queryBudget: context.queryBudget,
    expectedBriefIds: [...context.expectedBriefIds],
  };
}
