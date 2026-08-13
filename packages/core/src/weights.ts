import { parseBudgetKrw, type SurveySubmission } from '@tm/contracts';
import type { ParticipantWeights } from './scoring.js';

/**
 * 설문 → `ParticipantWeights` 변환기.
 *
 * Scoring Engine은 `Sat(i,c) = Σ w[i][k] × match(c,k)`를 계산하는데, `w[i][k]`를
 * 만드는 곳이 여기다. 이게 없으면 만족도 계산 전체가 입력 없이 놀게 된다.
 *
 * ## 왜 축에 방향을 넣는가
 *
 * `match(c,k)`는 후보 하나당 하나의 값이다(참여자마다 다시 계산하지 않는다).
 * 그런데 "느긋한 일정"은 누군가에게는 장점이고 누군가에게는 단점이다. 그래서
 * **축 자체에 방향을 인코딩한다** — `pace_relaxed`와 `pace_packed`를 따로 둔다.
 * 참여자는 자기 방향 축에만 가중치를 주고, 후보는 각 축에 적합도를 갖는다.
 * 이렇게 하면 Scoring Engine을 손대지 않고 개인차를 표현할 수 있다.
 *
 * 심판은 후보를 만들 때 **여기 정의된 축 이름을 그대로** `match`의 키로 써야 한다.
 * 이 목록이 심판과 스코어링 사이의 공유 어휘다.
 *
 * 근거: travel-mediation-plan.md 8.1 · 설문 5.2 슬라이더 12문항
 */

export const preferenceAxes = [
  /** 가격 민감도. 그룹 상한이 최저 예산자에게 묶이므로 예산이 낮을수록 커진다 (8.4) */
  'price_low',
  'comfort_high',
  'location_central',
  /** 이동 약자·유아 동반 등. 안전 축에 가깝다 */
  'accessibility',
  'pace_relaxed',
  'pace_packed',
  'plan_structured',
  'plan_spontaneous',
  'nature',
  'urban',
  'heritage',
  'trendy',
  'food_local',
  'food_safe',
  'group_together',
  'group_free',
  'early_start',
  'late_start',
  'nightlife',
  'evening_rest',
  'transport_comfort',
  'transport_thrifty',
  'photogenic',
  'activity_active',
  'activity_easy',
] as const;

export type PreferenceAxis = (typeof preferenceAxes)[number];

/**
 * 슬라이더 → 양극 축. `apps/web/src/data.ts`의 12문항과 1:1로 대응한다.
 * 오른쪽 축이 null이면 그 방향은 "무관심"이라 가중치를 만들지 않는다.
 */
export const SLIDER_AXES: Record<string, { low: PreferenceAxis; high: PreferenceAxis | null }> = {
  pace: { low: 'pace_relaxed', high: 'pace_packed' },
  planning: { low: 'plan_spontaneous', high: 'plan_structured' },
  'accommodation-spend': { low: 'price_low', high: 'comfort_high' },
  atmosphere: { low: 'nature', high: 'urban' },
  'place-style': { low: 'heritage', high: 'trendy' },
  'food-style': { low: 'food_local', high: 'food_safe' },
  togetherness: { low: 'group_together', high: 'group_free' },
  'daily-rhythm': { low: 'early_start', high: 'late_start' },
  'evening-style': { low: 'nightlife', high: 'evening_rest' },
  'transport-style': { low: 'transport_comfort', high: 'transport_thrifty' },
  // "사진 관심 없음"은 선호가 아니라 무관심이다. 축을 만들지 않는다.
  'photo-priority': { low: 'photogenic', high: null },
  'activity-level': { low: 'activity_active', high: 'activity_easy' },
};

/** 슬라이더 중앙값. 이 값이면 어느 쪽에도 가중치를 주지 않는다 */
const SLIDER_CENTER = 4;
const SLIDER_ARM = 3;

/** 예산 최저 참여자의 가격 가중치. 최고 예산자는 1.0 */
const PRICE_WEIGHT_MAX = 3;
const PRICE_WEIGHT_MIN = 1;

export interface WeightInput {
  userId: string;
  survey: SurveySubmission;
  /**
   * 그룹 전체의 1인 예산 상한. 가격 민감도를 **상대값**으로 계산한다.
   * 없으면 절대값을 알 수 없으므로 기본 가중치만 준다.
   */
  groupBudgetsKrw?: readonly number[];
  /**
   * 카드 id → 축 매핑. T4의 카드덱 메타가 확정되면 채워진다.
   * 없으면 `activityScores`를 반영하지 못하고 그 사실을 notes에 남긴다.
   */
  cardAxes?: Readonly<Record<string, PreferenceAxis>>;
}

export interface WeightResult {
  weights: ParticipantWeights;
  /**
   * 반영하지 못한 입력. 조용히 버리지 않는다 —
   * 설문에서 받은 것이 결과에 안 들어갔다면 그건 드러나야 할 사실이다.
   */
  notes: string[];
}

const add = (into: Record<string, number>, axis: PreferenceAxis, amount: number): void => {
  if (amount <= 0) return;
  into[axis] = (into[axis] ?? 0) + amount;
};

/**
 * 양극 슬라이더를 축 가중치로 바꾼다.
 * 4(중앙)는 무가중, 1과 7이 각 방향의 최대(1.0)다.
 */
function applySlider(
  into: Record<string, number>,
  sliderId: string,
  value: number,
  notes: string[],
): void {
  const axes = SLIDER_AXES[sliderId];
  if (axes === undefined) {
    notes.push(`매핑되지 않은 슬라이더입니다: ${sliderId}`);
    return;
  }
  if (value === SLIDER_CENTER) return;

  if (value < SLIDER_CENTER) {
    add(into, axes.low, (SLIDER_CENTER - value) / SLIDER_ARM);
    return;
  }
  if (axes.high === null) return;
  add(into, axes.high, (value - SLIDER_CENTER) / SLIDER_ARM);
}

/**
 * 예산 상한 → 가격 가중치.
 *
 * 그룹 예산 상한은 최저 예산 참여자에게 묶인다(8.4). 그 사람에게 가격은 취향이 아니라
 * 제약이므로 가중치를 더 크게 준다. 상대 위치를 모르면 기본값만 준다.
 */
export function priceWeight(
  budgetKrw: number | null,
  groupBudgetsKrw: readonly number[] = [],
): number {
  if (budgetKrw === null) return PRICE_WEIGHT_MIN;

  const others = groupBudgetsKrw.filter((value) => Number.isFinite(value) && value > 0);
  if (others.length < 2) return PRICE_WEIGHT_MIN;

  const min = Math.min(...others);
  const max = Math.max(...others);
  if (max === min) return PRICE_WEIGHT_MIN;

  const position = (budgetKrw - min) / (max - min); // 0 = 최저 예산
  return PRICE_WEIGHT_MIN + (PRICE_WEIGHT_MAX - PRICE_WEIGHT_MIN) * (1 - position);
}

export function weightsFromSurvey(input: WeightInput): WeightResult {
  const notes: string[] = [];
  const weights: Record<string, number> = {};
  const survey = input.survey;

  // ── 슬라이더 12문항 ──────────────────────────────────────────────────────
  let answered = 0;
  for (const [sliderId, value] of Object.entries(survey.travelStyles)) {
    if (value === null) continue;
    answered += 1;
    applySlider(weights, sliderId, value, notes);
  }
  if (answered === 0) {
    notes.push('슬라이더 응답이 없어 취향 축이 비었습니다. 만족도는 중립값으로 계산됩니다.');
  }

  // ── 예산 → 가격 민감도 ──────────────────────────────────────────────────
  const budget = parseBudgetKrw(survey.hardConstraints.budgetLimit);
  if (budget === null) {
    notes.push('예산 상한을 읽지 못해 가격 가중치를 기본값으로 둡니다.');
  }
  add(weights, 'price_low', priceWeight(budget, input.groupBudgetsKrw));

  // ── 이동 제약 → 접근성·중심가 ───────────────────────────────────────────
  const walkKm = survey.hardConstraints.walkingDistanceKm;
  if (walkKm !== null) {
    // 하루 도보 한계가 짧을수록 숙소 위치가 결정적이다.
    if (walkKm <= 5) add(weights, 'location_central', 2);
    else if (walkKm <= 10) add(weights, 'location_central', 1);
  }
  if (survey.hardConstraints.mobilityNeeds.length > 0) {
    add(weights, 'accessibility', 3);
    add(weights, 'location_central', 1);
  }

  // ── 카드덱 점수 ─────────────────────────────────────────────────────────
  const cardIds = Object.keys(survey.activityScores);
  if (cardIds.length > 0) {
    if (input.cardAxes === undefined) {
      notes.push(
        `카드덱 축 매핑이 없어 카드 점수 ${cardIds.length}건을 반영하지 못했습니다 (T4 cardDeck 메타 필요).`,
      );
    } else {
      let mapped = 0;
      for (const [cardId, score] of Object.entries(survey.activityScores)) {
        const axis = input.cardAxes[cardId];
        if (score === null || axis === undefined) continue;
        // 1~10 → 0~1. 카드 점수는 취향의 강도지 순위가 아니다.
        add(weights, axis, score / 10);
        mapped += 1;
      }
      if (mapped < cardIds.length) {
        notes.push(`축이 없는 카드 ${cardIds.length - mapped}건은 반영하지 못했습니다.`);
      }
    }
  }

  // ── 자유서술 ────────────────────────────────────────────────────────────
  // 정규화 규칙이 아직 없다(T4 미결정 3번). 하드 제약 승격 규칙이 정해지면 여기에 붙는다.
  if (survey.mustDo.trim() !== '' || survey.avoid.trim() !== '') {
    notes.push('자유서술(mustDo·avoid)은 정규화 규칙이 확정되기 전까지 가중치에 반영되지 않습니다.');
  }

  return { weights: { userId: input.userId, weights }, notes };
}

/**
 * 방 전체를 한 번에 변환한다. 가격 민감도가 **상대값**이라 개별 변환보다 정확하다.
 * 예산을 적지 않은 사람은 상대 계산에서 빠진다.
 */
export function weightsForRoom(
  entries: readonly { userId: string; survey: SurveySubmission }[],
  options: { cardAxes?: Readonly<Record<string, PreferenceAxis>> } = {},
): { weights: ParticipantWeights[]; notesByUser: Record<string, string[]> } {
  const groupBudgetsKrw = entries
    .map((entry) => parseBudgetKrw(entry.survey.hardConstraints.budgetLimit))
    .filter((budget): budget is number => budget !== null);

  const weights: ParticipantWeights[] = [];
  const notesByUser: Record<string, string[]> = {};

  for (const entry of entries) {
    const result = weightsFromSurvey({
      userId: entry.userId,
      survey: entry.survey,
      groupBudgetsKrw,
      ...(options.cardAxes === undefined ? {} : { cardAxes: options.cardAxes }),
    });
    weights.push(result.weights);
    notesByUser[entry.userId] = result.notes;
  }

  return { weights, notesByUser };
}
