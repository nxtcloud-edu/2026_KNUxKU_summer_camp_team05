import {
  neutralSearchBriefSchema,
  proxySearchBriefSchema,
  tripCharterSchema,
  userProxyProfileViewSchema,
  type AgentCategory,
  type NeutralSearchBrief,
  type ProxySearchBrief,
  type TripCharter,
  type UserProxyProfileView,
} from '@tm/contracts';
import { assertAgentContextSafe } from '@tm/core';

/**
 * SearchBrief → 구조화 Search Intent (결정론).
 *
 * 목적: Proxy Brief의 **자연어 searchTerms를 그대로 Provider에 넘기지 않는다.**
 * 의미를 hard constraint와 soft preference로 분리해, 같은 boolean filter로 취급하지 않는다.
 *
 *   hard  = 위반하면 후보가 탈락하는 조건 (정원·예산 상한·객실 분리 권한·필수 편의·금지 특성)
 *   soft  = 순위에만 영향을 주는 가중치 (조용함·방 크기·역 접근성·유흥 접근성·동네 분위기·지역 선호)
 *
 * 이 모듈은 LLM을 호출하지 않고, 네트워크 I/O가 없으며, embedding·vector·chunking·
 * semantic retrieval을 사용하지 않는다. 매핑은 명시적인 결정론 lexicon 조회다.
 * 매핑되지 않은 표현은 조용히 버리거나 추측하지 않고 `unmappedTerms`로 남긴다.
 *
 * 미래에 RAG가 들어갈 자리는 이 계층의 **출력 뒤**(structured knowledge → candidate retrieval)이며,
 * 이 파일은 그 경계를 넘지 않는다.
 */

export const softPreferenceAxes = [
  'quiet',
  'room_size',
  'station_access',
  'nightlife_access',
  'neighborhood_atmosphere',
] as const;
export type SoftPreferenceAxis = (typeof softPreferenceAxes)[number];

export const amenityTokens = [
  'accessible_room',
  'breakfast',
  'crib',
  'elevator',
  'kitchen',
  'non_smoking',
  'parking',
  'private_bathroom',
  'twin_beds',
  'wifi',
] as const;
export type AmenityToken = (typeof amenityTokens)[number];

export const forbiddenTraitTokens = [
  'dormitory',
  'no_elevator',
  'shared_bathroom',
  'smoking_room',
] as const;
export type ForbiddenTraitToken = (typeof forbiddenTraitTokens)[number];

export const roomSplitAuthorities = ['SPLIT_ALLOWED', 'SPLIT_NOT_ALLOWED', 'UNKNOWN'] as const;
export type RoomSplitAuthority = (typeof roomSplitAuthorities)[number];

/** importance(1·3·5) → basis point 가중치. 점수 계산이 아니라 우선순위 표현이다. */
const IMPORTANCE_WEIGHT_BP: Readonly<Record<1 | 3 | 5, number>> = { 1: 2000, 3: 6000, 5: 10_000 };
/** 프로필 fact로 뒷받침되지 않은 자유 표현의 기본 가중치. */
const DEFAULT_TERM_WEIGHT_BP = 4000;

type LexiconEntry =
  | { readonly kind: 'axis'; readonly axis: SoftPreferenceAxis }
  | { readonly kind: 'amenity'; readonly token: AmenityToken }
  | { readonly kind: 'forbidden'; readonly token: ForbiddenTraitToken }
  | { readonly kind: 'room_split'; readonly value: 'SPLIT_ALLOWED' | 'SPLIT_NOT_ALLOWED' };

/**
 * 명시적 lexicon. 여기에 없는 표현은 매핑하지 않는다.
 * 키는 `normalizeTerm`을 통과한 형태로 적는다.
 */
const LEXICON: ReadonlyArray<readonly [string, LexiconEntry]> = [
  ['조용', { kind: 'axis', axis: 'quiet' }],
  ['정숙', { kind: 'axis', axis: 'quiet' }],
  ['소음', { kind: 'axis', axis: 'quiet' }],
  ['quiet', { kind: 'axis', axis: 'quiet' }],

  ['넓은 방', { kind: 'axis', axis: 'room_size' }],
  ['큰 방', { kind: 'axis', axis: 'room_size' }],
  ['방 크기', { kind: 'axis', axis: 'room_size' }],
  ['room size', { kind: 'axis', axis: 'room_size' }],
  ['spacious', { kind: 'axis', axis: 'room_size' }],

  ['역세권', { kind: 'axis', axis: 'station_access' }],
  ['역 근처', { kind: 'axis', axis: 'station_access' }],
  ['역에서 가까운', { kind: 'axis', axis: 'station_access' }],
  ['지하철 근처', { kind: 'axis', axis: 'station_access' }],
  ['station access', { kind: 'axis', axis: 'station_access' }],
  ['near station', { kind: 'axis', axis: 'station_access' }],

  ['유흥', { kind: 'axis', axis: 'nightlife_access' }],
  ['밤문화', { kind: 'axis', axis: 'nightlife_access' }],
  ['nightlife', { kind: 'axis', axis: 'nightlife_access' }],

  ['동네 분위기', { kind: 'axis', axis: 'neighborhood_atmosphere' }],
  ['분위기', { kind: 'axis', axis: 'neighborhood_atmosphere' }],
  ['atmosphere', { kind: 'axis', axis: 'neighborhood_atmosphere' }],

  ['금연', { kind: 'amenity', token: 'non_smoking' }],
  ['non smoking', { kind: 'amenity', token: 'non_smoking' }],
  ['엘리베이터 없음', { kind: 'forbidden', token: 'no_elevator' }],
  ['no elevator', { kind: 'forbidden', token: 'no_elevator' }],
  ['엘리베이터', { kind: 'amenity', token: 'elevator' }],
  ['elevator', { kind: 'amenity', token: 'elevator' }],
  ['전용 욕실', { kind: 'amenity', token: 'private_bathroom' }],
  ['개인 욕실', { kind: 'amenity', token: 'private_bathroom' }],
  ['private bathroom', { kind: 'amenity', token: 'private_bathroom' }],
  ['휠체어', { kind: 'amenity', token: 'accessible_room' }],
  ['배리어프리', { kind: 'amenity', token: 'accessible_room' }],
  ['wheelchair', { kind: 'amenity', token: 'accessible_room' }],
  ['와이파이', { kind: 'amenity', token: 'wifi' }],
  ['wifi', { kind: 'amenity', token: 'wifi' }],
  ['조식', { kind: 'amenity', token: 'breakfast' }],
  ['breakfast', { kind: 'amenity', token: 'breakfast' }],
  ['취사', { kind: 'amenity', token: 'kitchen' }],
  ['주방', { kind: 'amenity', token: 'kitchen' }],
  ['kitchen', { kind: 'amenity', token: 'kitchen' }],
  ['침대 분리', { kind: 'amenity', token: 'twin_beds' }],
  ['트윈', { kind: 'amenity', token: 'twin_beds' }],
  ['twin beds', { kind: 'amenity', token: 'twin_beds' }],
  ['아기 침대', { kind: 'amenity', token: 'crib' }],
  ['crib', { kind: 'amenity', token: 'crib' }],
  ['주차', { kind: 'amenity', token: 'parking' }],
  ['parking', { kind: 'amenity', token: 'parking' }],

  ['흡연 객실', { kind: 'forbidden', token: 'smoking_room' }],
  ['흡연실', { kind: 'forbidden', token: 'smoking_room' }],
  ['smoking room', { kind: 'forbidden', token: 'smoking_room' }],
  ['공용 욕실', { kind: 'forbidden', token: 'shared_bathroom' }],
  ['공동 욕실', { kind: 'forbidden', token: 'shared_bathroom' }],
  ['shared bathroom', { kind: 'forbidden', token: 'shared_bathroom' }],
  ['도미토리', { kind: 'forbidden', token: 'dormitory' }],
  ['다인실', { kind: 'forbidden', token: 'dormitory' }],
  ['dormitory', { kind: 'forbidden', token: 'dormitory' }],

  ['객실 분리 불가', { kind: 'room_split', value: 'SPLIT_NOT_ALLOWED' }],
  ['분리 불가', { kind: 'room_split', value: 'SPLIT_NOT_ALLOWED' }],
  ['같은 객실', { kind: 'room_split', value: 'SPLIT_NOT_ALLOWED' }],
  ['같은 방', { kind: 'room_split', value: 'SPLIT_NOT_ALLOWED' }],
  ['한 방', { kind: 'room_split', value: 'SPLIT_NOT_ALLOWED' }],
  ['same room', { kind: 'room_split', value: 'SPLIT_NOT_ALLOWED' }],
  ['객실 분리 허용', { kind: 'room_split', value: 'SPLIT_ALLOWED' }],
  ['방 분리 가능', { kind: 'room_split', value: 'SPLIT_ALLOWED' }],
  ['분리 허용', { kind: 'room_split', value: 'SPLIT_ALLOWED' }],
  ['separate rooms ok', { kind: 'room_split', value: 'SPLIT_ALLOWED' }],
];

/**
 * 긴 키를 먼저 본다. `엘리베이터 없음`이 `엘리베이터`보다 먼저 매칭되어야 한다.
 * 길이가 같으면 키 사전순으로 고정해 결정론을 보장한다.
 */
const ORDERED_LEXICON: ReadonlyArray<readonly [string, LexiconEntry]> = [...LEXICON].sort(
  (left, right) => right[0].length - left[0].length || left[0].localeCompare(right[0]),
);

/** 대소문자·구두점·공백만 정규화한다. 어형 추론은 하지 않는다. */
export function normalizeTerm(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * 어절 시작 경계에서만 포함을 인정한다.
 *
 * 한국어는 조사·어미가 붙기 때문에 뒤쪽 경계는 요구할 수 없다("조용" ⊂ "조용한").
 * 그러나 앞쪽 경계를 요구하지 않으면 "조용한 방"이 "한 방"(같은 방)에 잘못 걸린다.
 * `normalizeTerm`이 구분자를 모두 공백 하나로 만들므로 선행 문자는 없거나 공백이다.
 */
function containsAtBoundary(haystack: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) return false;
    if (index === 0 || haystack[index - 1] === ' ') return true;
    from = index + 1;
  }
}

export function lookupTerm(value: string): LexiconEntry | null {
  const normalized = normalizeTerm(value);
  if (normalized.length === 0) return null;
  // 1차: 완전 일치. 2차: 어절 경계 포함(긴 키 우선).
  for (const [key, entry] of ORDERED_LEXICON) {
    if (normalized === key) return entry;
  }
  for (const [key, entry] of ORDERED_LEXICON) {
    if (containsAtBoundary(normalized, key)) return entry;
  }
  return null;
}

export interface PriceCeiling {
  /** 가장 낮은 개인 상한. 이 값을 넘으면 누군가의 hard 상한을 위반한다. */
  readonly bindingKrw: number;
  readonly byParticipantKrw: Readonly<Record<string, number>>;
}

export type SoftPreferenceTarget =
  | { readonly kind: 'axis'; readonly axis: SoftPreferenceAxis }
  | { readonly kind: 'amenity'; readonly token: AmenityToken }
  | { readonly kind: 'area'; readonly area: string };

export interface SoftPreference {
  readonly target: SoftPreferenceTarget;
  readonly direction: 'PREFER' | 'AVOID';
  /** 0~10000 bp 가중치. **필터가 아니다** — 이 값으로 후보를 제거하지 않는다. */
  readonly weightBp: number;
  readonly supportParticipantIds: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly terms: readonly string[];
}

export interface HardTraitConstraint {
  readonly kind: 'required_amenity' | 'forbidden_trait';
  readonly token: string;
  readonly participantIds: readonly string[];
  readonly factRefs: readonly string[];
}

export interface UnresolvedRef {
  readonly briefId: string;
  readonly participantId: string | null;
  readonly ref: string;
  readonly reason: 'PROFILE_NOT_PROVIDED' | 'FACT_NOT_FOUND' | 'UNMAPPED_HARD_FACT';
}

export interface UnmappedTerm {
  readonly briefId: string;
  readonly participantId: string | null;
  readonly term: string;
  readonly source: 'desiredTraits' | 'avoidTraits';
}

export type IntentConflictCode =
  | 'BUDGET_CEILING_MISMATCH'
  | 'MUST_KEEP_REF_NOT_HARD'
  | 'HARD_FACT_WITH_PREFER_POLARITY'
  | 'PREFERENCE_REF_IS_HARD_FACT'
  | 'PROFILE_VERSION_MISMATCH'
  | 'ROOM_SPLIT_AUTHORITY_CONFLICT'
  | 'HARD_REQUIRED_BUT_SOFT_AVOIDED';

export interface IntentConflict {
  readonly code: IntentConflictCode;
  readonly detail: string;
  readonly refs: readonly string[];
}

export interface StructuredSearchIntentHard {
  readonly partySize: number;
  readonly priceCeiling: PriceCeiling;
  /** 확인되지 않으면 UNKNOWN이다. UNKNOWN을 분리 동의로 해석하지 않는다. */
  readonly roomSplitAuthority: RoomSplitAuthority;
  readonly requiredAmenities: readonly HardTraitConstraint[];
  readonly forbiddenTraits: readonly HardTraitConstraint[];
  readonly neutralHardConstraintRefs: readonly string[];
}

export interface StructuredSearchIntent {
  readonly category: AgentCategory;
  readonly charterVersion: string;
  readonly proxyBriefIds: readonly string[];
  readonly neutralBriefId: string;
  /** Proxy Brief + 중립 Brief 전체. CandidateEvidence의 brief 계보 검증 입력이다. */
  readonly briefIds: readonly string[];
  readonly hard: StructuredSearchIntentHard;
  readonly soft: readonly SoftPreference[];
  /** Brief의 tradeoffs 원문. 필터로 쓰지 않고 그대로 보존한다. */
  readonly concessionTerms: readonly string[];
  /** Brief의 자연어 검색어 합집합. 단독으로 Provider에 전달하지 않는다. */
  readonly searchTerms: readonly string[];
  readonly unresolvedRefs: readonly UnresolvedRef[];
  readonly unmappedTerms: readonly UnmappedTerm[];
  readonly conflicts: readonly IntentConflict[];
}

export type SearchIntentErrorCode =
  | 'INVALID_INPUT'
  | 'CATEGORY_MISMATCH'
  | 'CHARTER_VERSION_MISMATCH'
  | 'BRIEF_ID_DUPLICATED'
  | 'PARTICIPANT_UNKNOWN'
  | 'SENSITIVE_CONTEXT';

export class SearchIntentError extends Error {
  constructor(
    readonly code: SearchIntentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SearchIntentError';
  }
}

export interface StructuredSearchIntentInput {
  readonly category: AgentCategory;
  readonly charter: TripCharter;
  readonly proxyBriefs: readonly ProxySearchBrief[];
  readonly neutralBrief: NeutralSearchBrief;
  /** 참가자 본인 프로필 투영. hard/soft 판정의 유일한 근거다. */
  readonly participantProfiles?: readonly UserProxyProfileView[];
  /** Destination Pack에 실제로 존재하는 지역명. Pack에 없는 지역은 만들지 않는다. */
  readonly knownAreas?: readonly string[];
}

interface SoftAccumulator {
  target: SoftPreferenceTarget;
  direction: 'PREFER' | 'AVOID';
  weightBp: number;
  participantIds: Set<string>;
  sourceRefs: Set<string>;
  terms: Set<string>;
}

interface HardAccumulator {
  kind: 'required_amenity' | 'forbidden_trait';
  token: string;
  participantIds: Set<string>;
  factRefs: Set<string>;
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sortedRecord(entries: ReadonlyArray<readonly [string, number]>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, value] of [...entries].sort((left, right) => left[0].localeCompare(right[0]))) {
    result[key] = value;
  }
  return result;
}

function targetKey(target: SoftPreferenceTarget): string {
  if (target.kind === 'axis') return `axis:${target.axis}`;
  if (target.kind === 'amenity') return `amenity:${target.token}`;
  return `area:${target.area}`;
}

function matchKnownArea(term: string, knownAreas: readonly string[]): string | null {
  const normalized = normalizeTerm(term);
  if (normalized.length === 0) return null;
  const ordered = [...knownAreas].sort(
    (left, right) => right.length - left.length || left.localeCompare(right),
  );
  for (const area of ordered) {
    const normalizedArea = normalizeTerm(area);
    if (normalizedArea.length === 0) continue;
    if (normalized === normalizedArea) return area;
  }
  for (const area of ordered) {
    const normalizedArea = normalizeTerm(area);
    if (normalizedArea.length === 0) continue;
    if (containsAtBoundary(normalized, normalizedArea)) return area;
  }
  return null;
}

/**
 * SearchBrief 묶음을 구조화 Intent로 변환한다.
 * 같은 입력이면 항상 같은 출력이 나온다 (정렬·중복 제거까지 고정).
 */
export function deriveStructuredSearchIntent(
  input: StructuredSearchIntentInput,
): StructuredSearchIntent {
  const charter = tripCharterSchema.parse(input.charter);
  const neutralBrief = neutralSearchBriefSchema.parse(input.neutralBrief);
  const proxyBriefs = input.proxyBriefs.map((brief) => proxySearchBriefSchema.parse(brief));
  const profiles = (input.participantProfiles ?? []).map((profile) =>
    userProxyProfileViewSchema.parse(profile),
  );
  const knownAreas = input.knownAreas ?? [];

  if (proxyBriefs.length === 0) {
    throw new SearchIntentError('INVALID_INPUT', 'Proxy SearchBrief가 최소 1개 필요합니다.');
  }
  if (neutralBrief.category !== input.category) {
    throw new SearchIntentError('CATEGORY_MISMATCH', '중립 Brief category가 요청과 다릅니다.');
  }
  if (neutralBrief.charterVersion !== charter.charterVersion) {
    throw new SearchIntentError(
      'CHARTER_VERSION_MISMATCH',
      '중립 Brief는 현재 TripCharter 버전을 참조해야 합니다.',
    );
  }

  const briefIdSet = new Set<string>([neutralBrief.briefId]);
  const participantIdSet = new Set(charter.participantIds);
  for (const brief of proxyBriefs) {
    if (brief.category !== input.category) {
      throw new SearchIntentError(
        'CATEGORY_MISMATCH',
        `Proxy Brief category가 요청과 다릅니다: ${brief.briefId}`,
      );
    }
    if (briefIdSet.has(brief.briefId)) {
      throw new SearchIntentError('BRIEF_ID_DUPLICATED', `중복 briefId입니다: ${brief.briefId}`);
    }
    briefIdSet.add(brief.briefId);
    if (!participantIdSet.has(brief.participantId)) {
      throw new SearchIntentError(
        'PARTICIPANT_UNKNOWN',
        `TripCharter에 없는 참가자입니다: ${brief.participantId}`,
      );
    }
  }

  const conflicts: IntentConflict[] = [];
  const unresolvedRefs: UnresolvedRef[] = [];
  const unmappedTerms: UnmappedTerm[] = [];
  const softByKey = new Map<string, SoftAccumulator>();
  const hardByKey = new Map<string, HardAccumulator>();
  const roomSplitVotes = new Map<'SPLIT_ALLOWED' | 'SPLIT_NOT_ALLOWED', Set<string>>();

  const profileByParticipant = new Map(profiles.map((profile) => [profile.participantId, profile]));

  const addSoft = (
    target: SoftPreferenceTarget,
    direction: 'PREFER' | 'AVOID',
    weightBp: number,
    participantId: string | null,
    sourceRef: string | null,
    term: string,
  ): void => {
    const key = `${targetKey(target)}|${direction}`;
    const existing = softByKey.get(key);
    if (existing === undefined) {
      softByKey.set(key, {
        target,
        direction,
        weightBp,
        participantIds: new Set(participantId === null ? [] : [participantId]),
        sourceRefs: new Set(sourceRef === null ? [] : [sourceRef]),
        terms: new Set([term]),
      });
      return;
    }
    // 가중치는 최댓값을 쓴다. 인원수로 합산하면 다수 취향이 hard처럼 굳어진다.
    existing.weightBp = Math.max(existing.weightBp, weightBp);
    if (participantId !== null) existing.participantIds.add(participantId);
    if (sourceRef !== null) existing.sourceRefs.add(sourceRef);
    existing.terms.add(term);
  };

  const addHard = (
    kind: 'required_amenity' | 'forbidden_trait',
    token: string,
    participantId: string,
    factRef: string,
  ): void => {
    const key = `${kind}|${token}`;
    const existing = hardByKey.get(key);
    if (existing === undefined) {
      hardByKey.set(key, {
        kind,
        token,
        participantIds: new Set([participantId]),
        factRefs: new Set([factRef]),
      });
      return;
    }
    existing.participantIds.add(participantId);
    existing.factRefs.add(factRef);
  };

  const classifyTerm = (
    brief: ProxySearchBrief,
    term: string,
    source: 'desiredTraits' | 'avoidTraits',
  ): void => {
    const direction: 'PREFER' | 'AVOID' = source === 'desiredTraits' ? 'PREFER' : 'AVOID';
    const area = matchKnownArea(term, knownAreas);
    if (area !== null) {
      addSoft(
        { kind: 'area', area },
        direction,
        DEFAULT_TERM_WEIGHT_BP,
        brief.participantId,
        null,
        term,
      );
      return;
    }
    const entry = lookupTerm(term);
    if (entry === null) {
      unmappedTerms.push({
        briefId: brief.briefId,
        participantId: brief.participantId,
        term,
        source,
      });
      return;
    }
    if (entry.kind === 'axis') {
      addSoft(
        { kind: 'axis', axis: entry.axis },
        direction,
        DEFAULT_TERM_WEIGHT_BP,
        brief.participantId,
        null,
        term,
      );
      return;
    }
    if (entry.kind === 'amenity') {
      // Brief의 자유 표현은 hard가 아니다. 편의시설도 soft 선호로만 반영한다.
      addSoft(
        { kind: 'amenity', token: entry.token },
        direction,
        DEFAULT_TERM_WEIGHT_BP,
        brief.participantId,
        null,
        term,
      );
      return;
    }
    if (entry.kind === 'forbidden') {
      // 부정 특성은 대응되는 긍정 편의시설로 바꾸고 방향을 뒤집는다.
      // "흡연실을 피하고 싶다" = "금연실을 선호한다". 필터로는 만들지 않는다.
      const positive = negatedAmenity(entry.token);
      if (positive === null) {
        unmappedTerms.push({
          briefId: brief.briefId,
          participantId: brief.participantId,
          term,
          source,
        });
        return;
      }
      addSoft(
        { kind: 'amenity', token: positive },
        direction === 'AVOID' ? 'PREFER' : 'AVOID',
        DEFAULT_TERM_WEIGHT_BP,
        brief.participantId,
        null,
        term,
      );
      return;
    }
    // room_split은 권한 문제다. 자유 표현만으로 권한을 부여하지 않는다.
    unmappedTerms.push({
      briefId: brief.briefId,
      participantId: brief.participantId,
      term,
      source,
    });
  };

  for (const brief of proxyBriefs) {
    const profile = profileByParticipant.get(brief.participantId);
    if (profile !== undefined && profile.profileVersion !== brief.profileVersion) {
      conflicts.push({
        code: 'PROFILE_VERSION_MISMATCH',
        detail: `Brief와 프로필의 profileVersion이 다릅니다: ${brief.briefId}`,
        refs: [brief.briefId, brief.participantId],
      });
    }
    const factById = new Map((profile?.facts ?? []).map((fact) => [fact.factId, fact]));

    for (const ref of brief.mustKeepRefs) {
      if (profile === undefined) {
        unresolvedRefs.push({
          briefId: brief.briefId,
          participantId: brief.participantId,
          ref,
          reason: 'PROFILE_NOT_PROVIDED',
        });
        continue;
      }
      const fact = factById.get(ref);
      if (fact === undefined) {
        unresolvedRefs.push({
          briefId: brief.briefId,
          participantId: brief.participantId,
          ref,
          reason: 'FACT_NOT_FOUND',
        });
        continue;
      }
      const weightBp = IMPORTANCE_WEIGHT_BP[fact.importance];
      if (!fact.hard) {
        conflicts.push({
          code: 'MUST_KEEP_REF_NOT_HARD',
          detail: `mustKeepRef가 hard fact가 아니므로 soft로 처리했습니다: ${ref}`,
          refs: [brief.briefId, ref],
        });
        applySoftFact(brief, fact.statement, fact.polarity, weightBp, ref);
        continue;
      }
      if (fact.polarity === 'PREFER') {
        conflicts.push({
          code: 'HARD_FACT_WITH_PREFER_POLARITY',
          detail: `hard fact가 PREFER 극성이라 필터로 승격하지 않았습니다: ${ref}`,
          refs: [brief.briefId, ref],
        });
        applySoftFact(brief, fact.statement, 'PREFER', weightBp, ref);
        continue;
      }

      const entry = lookupTerm(fact.statement);
      if (entry === null) {
        unresolvedRefs.push({
          briefId: brief.briefId,
          participantId: brief.participantId,
          ref,
          reason: 'UNMAPPED_HARD_FACT',
        });
        continue;
      }
      if (entry.kind === 'room_split') {
        const votes = roomSplitVotes.get(entry.value) ?? new Set<string>();
        votes.add(ref);
        roomSplitVotes.set(entry.value, votes);
        continue;
      }
      if (entry.kind === 'amenity') {
        if (fact.polarity === 'REQUIRE') {
          addHard('required_amenity', entry.token, brief.participantId, ref);
        } else {
          addHard('forbidden_trait', entry.token, brief.participantId, ref);
        }
        continue;
      }
      if (entry.kind === 'forbidden') {
        if (fact.polarity === 'AVOID') {
          addHard('forbidden_trait', entry.token, brief.participantId, ref);
          continue;
        }
        const positive = negatedAmenity(entry.token);
        if (positive === null) {
          unresolvedRefs.push({
            briefId: brief.briefId,
            participantId: brief.participantId,
            ref,
            reason: 'UNMAPPED_HARD_FACT',
          });
          continue;
        }
        addHard('required_amenity', positive, brief.participantId, ref);
        continue;
      }
      // axis는 순위 축이므로 hard 필터가 될 수 없다.
      applySoftFact(brief, fact.statement, fact.polarity, weightBp, ref);
    }

    for (const ref of brief.preferenceTargetRefs) {
      if (profile === undefined) {
        unresolvedRefs.push({
          briefId: brief.briefId,
          participantId: brief.participantId,
          ref,
          reason: 'PROFILE_NOT_PROVIDED',
        });
        continue;
      }
      const fact = factById.get(ref);
      if (fact === undefined) {
        unresolvedRefs.push({
          briefId: brief.briefId,
          participantId: brief.participantId,
          ref,
          reason: 'FACT_NOT_FOUND',
        });
        continue;
      }
      if (fact.hard) {
        conflicts.push({
          code: 'PREFERENCE_REF_IS_HARD_FACT',
          detail: `preferenceTargetRef가 hard fact를 가리켜 soft로만 반영했습니다: ${ref}`,
          refs: [brief.briefId, ref],
        });
      }
      applySoftFact(brief, fact.statement, fact.polarity, IMPORTANCE_WEIGHT_BP[fact.importance], ref);
    }

    for (const term of brief.desiredTraits) classifyTerm(brief, term, 'desiredTraits');
    for (const term of brief.avoidTraits) classifyTerm(brief, term, 'avoidTraits');
  }

  function applySoftFact(
    brief: ProxySearchBrief,
    statement: string,
    polarity: 'REQUIRE' | 'AVOID' | 'PREFER',
    weightBp: number,
    ref: string,
  ): void {
    const direction: 'PREFER' | 'AVOID' = polarity === 'AVOID' ? 'AVOID' : 'PREFER';
    const area = matchKnownArea(statement, knownAreas);
    if (area !== null) {
      addSoft({ kind: 'area', area }, direction, weightBp, brief.participantId, ref, statement);
      return;
    }
    const entry = lookupTerm(statement);
    if (entry === null) return;
    if (entry.kind === 'axis') {
      addSoft({ kind: 'axis', axis: entry.axis }, direction, weightBp, brief.participantId, ref, statement);
      return;
    }
    if (entry.kind === 'amenity') {
      addSoft(
        { kind: 'amenity', token: entry.token },
        direction,
        weightBp,
        brief.participantId,
        ref,
        statement,
      );
      return;
    }
    if (entry.kind === 'forbidden') {
      // 부정 특성 → 긍정 편의시설로 치환하며 방향을 뒤집는다.
      const positive = negatedAmenity(entry.token);
      if (positive === null) return;
      addSoft(
        { kind: 'amenity', token: positive },
        direction === 'AVOID' ? 'PREFER' : 'AVOID',
        weightBp,
        brief.participantId,
        ref,
        statement,
      );
    }
  }

  const allowed = roomSplitVotes.get('SPLIT_ALLOWED');
  const notAllowed = roomSplitVotes.get('SPLIT_NOT_ALLOWED');
  let roomSplitAuthority: RoomSplitAuthority = 'UNKNOWN';
  if (allowed !== undefined && notAllowed !== undefined) {
    // 충돌은 fail-closed로 닫는다. 동의 없는 객실 분리를 만들지 않는다.
    roomSplitAuthority = 'SPLIT_NOT_ALLOWED';
    conflicts.push({
      code: 'ROOM_SPLIT_AUTHORITY_CONFLICT',
      detail: '객실 분리 권한이 서로 충돌해 분리 불가로 닫았습니다.',
      refs: sortedUnique([...allowed, ...notAllowed]),
    });
  } else if (notAllowed !== undefined) {
    roomSplitAuthority = 'SPLIT_NOT_ALLOWED';
  } else if (allowed !== undefined) {
    roomSplitAuthority = 'SPLIT_ALLOWED';
  }

  const byParticipantEntries: Array<readonly [string, number]> = [];
  for (const participantId of charter.participantIds) {
    const charterCeiling = charter.budgetMaxByParticipantKrw[participantId];
    if (charterCeiling === undefined) {
      throw new SearchIntentError(
        'INVALID_INPUT',
        `TripCharter에 참가자 예산 상한이 없습니다: ${participantId}`,
      );
    }
    const profile = profileByParticipant.get(participantId);
    let ceiling = charterCeiling;
    if (profile !== undefined && profile.budgetMaxKrw !== charterCeiling) {
      ceiling = Math.min(charterCeiling, profile.budgetMaxKrw);
      conflicts.push({
        code: 'BUDGET_CEILING_MISMATCH',
        detail: `TripCharter와 프로필 예산 상한이 달라 더 엄격한 값을 사용했습니다: ${participantId}`,
        refs: [participantId],
      });
    }
    byParticipantEntries.push([participantId, ceiling]);
  }
  const byParticipantKrw = sortedRecord(byParticipantEntries);
  const bindingKrw = Math.min(...byParticipantEntries.map(([, value]) => value));

  const soft: SoftPreference[] = [...softByKey.values()]
    .map((accumulator) => ({
      target: accumulator.target,
      direction: accumulator.direction,
      weightBp: accumulator.weightBp,
      supportParticipantIds: sortedUnique(accumulator.participantIds),
      sourceRefs: sortedUnique(accumulator.sourceRefs),
      terms: sortedUnique(accumulator.terms),
    }))
    .sort(
      (left, right) =>
        targetKey(left.target).localeCompare(targetKey(right.target)) ||
        left.direction.localeCompare(right.direction),
    );

  const hardConstraints = [...hardByKey.values()].map((accumulator) => ({
    kind: accumulator.kind,
    token: accumulator.token,
    participantIds: sortedUnique(accumulator.participantIds),
    factRefs: sortedUnique(accumulator.factRefs),
  }));
  const requiredAmenities = hardConstraints
    .filter((constraint) => constraint.kind === 'required_amenity')
    .sort((left, right) => left.token.localeCompare(right.token));
  const forbiddenTraits = hardConstraints
    .filter((constraint) => constraint.kind === 'forbidden_trait')
    .sort((left, right) => left.token.localeCompare(right.token));

  for (const required of requiredAmenities) {
    const contradicting = soft.find(
      (preference) =>
        preference.direction === 'AVOID' &&
        preference.target.kind === 'amenity' &&
        preference.target.token === required.token,
    );
    if (contradicting !== undefined) {
      conflicts.push({
        code: 'HARD_REQUIRED_BUT_SOFT_AVOIDED',
        detail: `hard 필수 조건을 다른 참가자가 회피 선호로 표시했습니다: ${required.token}`,
        refs: sortedUnique([...required.factRefs, ...contradicting.supportParticipantIds]),
      });
    }
  }

  const proxyBriefIds = [...proxyBriefs.map((brief) => brief.briefId)].sort((left, right) =>
    left.localeCompare(right),
  );

  const intent: StructuredSearchIntent = {
    category: input.category,
    charterVersion: charter.charterVersion,
    proxyBriefIds,
    neutralBriefId: neutralBrief.briefId,
    briefIds: [...proxyBriefIds, neutralBrief.briefId],
    hard: {
      partySize: charter.partySize,
      priceCeiling: { bindingKrw, byParticipantKrw },
      roomSplitAuthority,
      requiredAmenities,
      forbiddenTraits,
      neutralHardConstraintRefs: sortedUnique(neutralBrief.hardConstraintRefs),
    },
    soft,
    concessionTerms: sortedUnique(proxyBriefs.flatMap((brief) => brief.tradeoffs)),
    searchTerms: sortedUnique([
      ...proxyBriefs.flatMap((brief) => brief.searchTerms),
      ...neutralBrief.searchTerms,
    ]),
    unresolvedRefs: [...unresolvedRefs].sort(
      (left, right) =>
        left.briefId.localeCompare(right.briefId) ||
        left.ref.localeCompare(right.ref) ||
        left.reason.localeCompare(right.reason),
    ),
    unmappedTerms: [...unmappedTerms].sort(
      (left, right) =>
        left.briefId.localeCompare(right.briefId) ||
        left.source.localeCompare(right.source) ||
        left.term.localeCompare(right.term),
    ),
    conflicts: [...conflicts].sort(
      (left, right) => left.code.localeCompare(right.code) || left.detail.localeCompare(right.detail),
    ),
  };

  try {
    assertAgentContextSafe(intent);
  } catch {
    throw new SearchIntentError(
      'SENSITIVE_CONTEXT',
      'Search Intent에 금지된 민감 필드가 포함되었습니다.',
    );
  }
  return intent;
}

/**
 * 금지 특성 ↔ 필수 편의의 결정론 대응.
 * 1:1 대응이 없는 항목은 null이다 — 없는 대응을 만들지 않는다.
 * (`dormitory`는 반대말이 하나로 정해지지 않으므로 대응하지 않는다.)
 */
function negatedAmenity(token: ForbiddenTraitToken): AmenityToken | null {
  switch (token) {
    case 'smoking_room':
      return 'non_smoking';
    case 'shared_bathroom':
      return 'private_bathroom';
    case 'no_elevator':
      return 'elevator';
    case 'dormitory':
      return null;
    default: {
      const exhaustive: never = token;
      return exhaustive;
    }
  }
}
