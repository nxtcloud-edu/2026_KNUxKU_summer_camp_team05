import type { Candidate, FlightCandidate, HotelCandidate, TransportCandidate } from '@tm/contracts';
import type { CandidateAttributes } from './scoring.js';
import type { PreferenceAxis } from './weights.js';

/**
 * 후보 → 스코어링 속성. **심판이 만들어내는 값이 아니다** (INV-2).
 *
 * `scoreCandidates`는 속성별 적합도 [0,1]을 받아 만족도를 계산한다. 그 적합도를
 * LLM이 매기면 만족도 전체가 환각 위에 서게 되므로, 정규화된 후보 필드에서
 * 기계적으로 유도한다. 여기 없는 축은 그 후보에 대해 판단할 근거가 없다는 뜻이며,
 * 0이 아니라 **없음**으로 둔다 — 0은 "최악"이고 없음은 "모름"이라 다르다.
 *
 * 가격 관련 축은 절대값이 아니라 **후보 집합 안의 상대 위치**로 계산한다.
 * 30만원이 비싼지 싼지는 같이 놓인 후보들이 정한다.
 *
 * 근거: scoring.ts(CandidateAttributes) · travel-mediation-plan.md 8.1~8.4
 */

export interface HardConstraintContext {
  /** 참여자 전원의 알레르기 태그 합집합. 안전 축이다 */
  allergens: readonly string[];
  /** 이동 약자 요구. 접근성 확인이 필요해진다 */
  mobilityNeeds: readonly string[];
  /** 자유서술에서 승격된 금지 항목 */
  noGoItems: readonly string[];
  /** 그룹 1인 예산 상한 = 최저 예산 참여자의 상한 (기획서 8.4) */
  budgetCapPerPersonKrw: number | null;
}

export interface AttributeContext {
  hard: HardConstraintContext;
  /** 인원수. 숙소 수용 판정에 쓴다 */
  groupSize: number;
}

/**
 * 후보 1건의 평가.
 *
 * `attributes`는 스코어링 입력이고, `unverified`는 fail-closed 경로다.
 * 둘을 합치지 않는 이유: **미확인은 위반이 아니다.** 접근성 정보가 없는 숙소를
 * 실격시키면 후보가 사라지고, 통과시키면 사용자가 못 들어가는 방을 예약한다.
 * 그래서 후보로는 남기되 검증 없이 승격하지 못하게 표시한다.
 */
export interface CandidateAssessment {
  attributes: CandidateAttributes;
  /** 확인되지 않은 안전·실행가능성 항목. 비어 있지 않으면 VERIFIED 승격 금지 */
  unverified: string[];
  /** 회의록·카드에 쓸 한 줄. 심판이 지어내지 않도록 코드가 만든다 */
  headline: string;
  /** 비교 기준이 되는 1인 비용(KRW). 예산 판정과 가격 축의 원본 */
  costPerPersonKrw: number | null;
}

type Matches = Partial<Record<PreferenceAxis, number>>;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const round3 = (value: number): number => Number(value.toFixed(3));

/**
 * 집합 안의 상대 위치를 [0,1]로. `lowerIsBetter`면 최저값이 1이다.
 * 후보가 하나뿐이거나 전부 같으면 비교 정보가 없으므로 1을 준다 — 더 나쁜 것이 없다.
 */
function relative(
  value: number | null,
  all: readonly number[],
  lowerIsBetter: boolean,
): number | null {
  if (value === null) return null;
  const known = all.filter((entry) => Number.isFinite(entry));
  if (known.length === 0) return null;

  const min = Math.min(...known);
  const max = Math.max(...known);
  if (max === min) return 1;

  const position = (value - min) / (max - min);
  return round3(clamp01(lowerIsBetter ? 1 - position : position));
}

/** ISO 시각의 시(hour). 파싱 실패면 null */
function hourOf(iso: string | null): number | null {
  if (iso === null) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getHours();
}

const costOfFlight = (candidate: FlightCandidate): number =>
  candidate.effectiveTotal.perPerson;
/**
 * 숙소 비교 비용. **가격을 모르면 0이 아니라 null이다.**
 *
 * 공급자가 요금을 주지 않는 경우가 실제로 있다 — TourAPI 숙박은 `roommaxcount`는
 * 채워 보내면서 `roomoffseasonminfee1`은 전부 0으로 준다(2026-08-14 부산 표본
 * 18객실 중 0건). 이때 0을 가격으로 쓰면 그 후보가 집합의 최저가가 되어
 * `price_low` 축에서 1점을 받고, "공짜 숙소"가 예산 비교를 전부 이긴다.
 *
 * 모르는 축은 없는 축이다. null을 주면 relative()가 매칭을 만들지 않는다.
 */
const costOfHotel = (candidate: HotelCandidate): number | null => {
  const effective = candidate.meals.effectiveLodgingCost;
  if (effective !== null) return effective;
  return candidate.price.confidence === 'unknown' ? null : candidate.price.totalPerPerson;
};
const costOfTransport = (candidate: TransportCandidate): number | null =>
  candidate.totals?.farePerPersonKrw ??
  candidate.policy?.estimatedDailyCostPerPersonKrw ??
  null;

/** 후보의 비교 기준 비용. 항공은 항공료가 아니라 effectiveTotal이다 */
export function costOf(candidate: Candidate): number | null {
  switch (candidate.kind) {
    case 'flight':
      return costOfFlight(candidate);
    case 'hotel':
      return costOfHotel(candidate);
    case 'transport':
      return costOfTransport(candidate);
  }
}

function flightMatches(
  candidate: FlightCandidate,
  costs: readonly number[],
): { matches: Matches; unverified: string[]; headline: string } {
  const matches: Matches = {};
  const unverified: string[] = [];

  const price = relative(costOfFlight(candidate), costs, true);
  if (price !== null) {
    matches.price_low = price;
    matches.transport_thrifty = price;
  }

  // 경유가 적고 짧을수록 편하다. 둘 다 후보 집합 안의 상대값이다.
  const connections = candidate.outbound.connections + candidate.inbound.connections;
  matches.transport_comfort = round3(clamp01(1 - connections * 0.35));

  const departHour = hourOf(candidate.outbound.departure.at);
  if (departHour !== null) {
    // 이른 출발을 선호하는 축과 늦은 출발을 선호하는 축은 서로 반대다.
    const early = clamp01((12 - departHour) / 6);
    matches.early_start = round3(early);
    matches.late_start = round3(1 - early);
  }

  // 그룹 좌석 동시 확보는 총 좌석 수 표기와 다르다 (fail-closed).
  if (!candidate.groupInventoryVerified) unverified.push('그룹 좌석 동시 예약 가능 여부 미확인');
  if (candidate.baggage.checkedIncluded === null) unverified.push('위탁 수하물 포함 여부 미확인');

  return {
    matches,
    unverified,
    headline: `${candidate.outbound.carrier.name} ${candidate.outbound.flightNumber} · 경유 ${connections}회`,
  };
}

function hotelMatches(
  candidate: HotelCandidate,
  costs: readonly number[],
  context: AttributeContext,
): { matches: Matches; unverified: string[]; headline: string } {
  const matches: Matches = {};
  const unverified: string[] = [];

  const price = relative(costOfHotel(candidate), costs, true);
  if (price !== null) matches.price_low = price;

  if (candidate.rating !== null) {
    // 평점은 10점 만점으로 오기도 하고 5점 만점으로 오기도 한다. 5 이하면 5점 척도로 본다.
    const scale = candidate.rating.score <= 5 ? 5 : 10;
    matches.comfort_high = round3(clamp01(candidate.rating.score / scale));
  }

  // 중심 접근성은 Pack이 정한 기준 지점까지의 분 단위 거리에서 온다.
  const minutes = Object.values(candidate.locationMetrics).map((entry) => entry.minutes);
  if (minutes.length > 0) {
    const best = Math.min(...minutes);
    matches.location_central = round3(clamp01(1 - best / 45));
  }

  const access = candidate.accessibility;
  const accessFlags = [access.wheelchair, access.elevator, access.stepFree];
  const known = accessFlags.filter((flag): flag is boolean => flag !== null);
  if (known.length > 0) {
    matches.accessibility = round3(known.filter(Boolean).length / known.length);
  }
  // 이동 약자 요구가 있는데 확인되지 않았으면 fail-closed 대상이다.
  if (context.hard.mobilityNeeds.length > 0 && known.length < accessFlags.length) {
    unverified.push('접근성(휠체어·엘리베이터·단차) 미확인');
  }

  if (candidate.meals.breakfastIncluded === true) matches.food_safe = 1;
  // 식사 크레딧은 알레르기·식이 대응이 확인되어야 계산할 수 있다.
  if (
    context.hard.allergens.length > 0 &&
    (candidate.meals.breakfastIncluded === true || candidate.meals.dinnerIncluded === true) &&
    !candidate.meals.dietSupportVerified
  ) {
    unverified.push('식사 제공 숙소의 알레르기 대응 미확인');
  }

  if (!candidate.roomCombinationVerified) unverified.push('객실 조합 동시 재고 미확인');
  if (!candidate.allInPriceVerified) unverified.push('세금·수수료 포함 총액 미확인');

  // 인원이 한 방에 들어가는 조합이 있는지. 총 수용 인원 표기와는 다른 문제다.
  const fits = candidate.capacity.roomOptions.some(
    (option) => option.totalGuests >= context.groupSize,
  );
  matches.group_together = fits ? 1 : 0;

  return {
    matches,
    unverified,
    headline: `${candidate.name} · ${candidate.location.area}`,
  };
}

function transportMatches(
  candidate: TransportCandidate,
  costs: readonly number[],
): { matches: Matches; unverified: string[]; headline: string } {
  const matches: Matches = {};
  const unverified: string[] = [];

  const price = relative(costOfTransport(candidate), costs, true);
  if (price !== null) {
    matches.price_low = price;
    matches.transport_thrifty = price;
  }

  const totals = candidate.totals;
  if (totals !== null) {
    // 환승과 도보가 적을수록 편하다.
    const transferPenalty = clamp01(totals.transfers * 0.25);
    const walkPenalty = clamp01(totals.walkMeters / 2000);
    matches.transport_comfort = round3(clamp01(1 - (transferPenalty + walkPenalty) / 2));
    matches.activity_easy = round3(clamp01(1 - walkPenalty));
  }

  const access = candidate.accessibility;
  if (access.stairsRequired !== null || access.elevatorAvailable !== null) {
    const good = [access.stairsRequired === false, access.elevatorAvailable === true].filter(
      Boolean,
    ).length;
    matches.accessibility = round3(good / 2);
  }
  // 접근성과 막차는 fail-closed다 (transport-referee-implementation.md).
  if (!access.verified) unverified.push('접근성·막차 시각 미확인');

  return {
    matches,
    unverified,
    headline: candidate.label,
  };
}

/**
 * 하드 제약 위반 판정.
 *
 * **확인된 위반만 실격시킨다.** 미확인(null)은 실격 사유가 아니라 `unverified`다 —
 * 정보가 없다는 이유로 후보를 지우면 조달이 부실한 목적지에서 후보가 전부 사라진다.
 */
function disqualifyReason(
  candidate: Candidate,
  cost: number | null,
  context: AttributeContext,
): string | undefined {
  if (candidate.disqualified) {
    return candidate.disqualifyReason ?? '조달 단계에서 실격 처리됨';
  }

  const cap = context.hard.budgetCapPerPersonKrw;
  if (cap !== null && cost !== null && cost > cap) {
    // 그룹 상한은 최저 예산 참여자의 상한이다. 넘으면 그 사람은 갈 수 없다.
    return `1인 ${cost.toLocaleString()}원으로 그룹 예산 상한 ${cap.toLocaleString()}원을 초과`;
  }

  if (candidate.kind === 'hotel') {
    const access = candidate.accessibility;
    if (
      context.hard.mobilityNeeds.length > 0 &&
      access.wheelchair === false &&
      access.stepFree === false
    ) {
      return '이동 약자 요구가 있으나 휠체어 접근과 단차 없음이 모두 불가로 확인됨';
    }
    if (candidate.capacity.maxGuests < context.groupSize) {
      return `최대 수용 ${candidate.capacity.maxGuests}명으로 일행 ${context.groupSize}명을 받지 못함`;
    }
  }

  return undefined;
}

/** 소프트 위반 태그. 개당 감점되며 회의록에 사유로 남는다 */
function softViolations(candidate: Candidate, context: AttributeContext): string[] {
  const tags: string[] = [];
  const haystack = JSON.stringify(candidate).toLowerCase();

  for (const item of context.hard.noGoItems) {
    const needle = item.trim().toLowerCase();
    if (needle.length > 0 && haystack.includes(needle)) tags.push(`기피 항목 포함: ${item}`);
  }
  return tags;
}

/**
 * 후보 집합을 한 번에 평가한다.
 *
 * 개별 변환이 아니라 집합 단위인 이유는 가격 축이 **상대값**이기 때문이다.
 * 후보를 하나씩 넣으면 모두 만점을 받는다.
 */
export function assessCandidates(
  candidates: readonly Candidate[],
  context: AttributeContext,
): CandidateAssessment[] {
  const costs = candidates
    .map((candidate) => costOf(candidate))
    .filter((cost): cost is number => cost !== null);

  return candidates.map((candidate): CandidateAssessment => {
    const cost = costOf(candidate);
    const evaluated =
      candidate.kind === 'flight'
        ? flightMatches(candidate, costs)
        : candidate.kind === 'hotel'
          ? hotelMatches(candidate, costs, context)
          : transportMatches(candidate, costs);

    const reason = disqualifyReason(candidate, cost, context);
    const soft = softViolations(candidate, context);

    return {
      attributes: {
        candidateId: candidate.id,
        match: evaluated.matches as Record<string, number>,
        ...(reason === undefined ? {} : { disqualifyReason: reason }),
        ...(soft.length === 0 ? {} : { softViolations: soft }),
      },
      unverified: evaluated.unverified,
      headline: evaluated.headline,
      costPerPersonKrw: cost,
    };
  });
}
