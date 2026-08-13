import { reviewThresholds } from '@tm/contracts';

/**
 * Scoring Engine — 만족도 산출, 후보 선택, 양보 크레딧 갱신.
 *
 * LLM을 호출하지 않는다. 심판과 Supervisor는 후보를 **선택하지 않으며**,
 * 만족도·예산 수치를 만들지도 않는다 (agent-architecture.md INV-2).
 * 강도(intensity)는 쟁점 식별·절충 설계·만족도 하한·동점 타이브레이크에만 쓰인다.
 *
 * 근거: travel-mediation-plan.md 8.1 ~ 8.3
 */

/** 만족도 척도. 재심 임계치(C1 5.0, C2 4.0, 강한 반대 하한 5.5)가 이 척도를 전제한다 */
export const SATISFACTION_SCALE = 10;

/** 응답이 없는 카테고리는 중립으로 둔다. 0점을 주면 미응답자가 모든 후보를 끌어내린다 */
export const NEUTRAL_SATISFACTION = 5;

/** 소프트 제약 위반 1건당 감점 */
export const SOFT_VIOLATION_PENALTY = 1;

/** 부동소수 비교 허용 오차. 이 값 이내면 동률로 보고 다음 순위 기준으로 넘어간다 */
const EPSILON = 1e-9;

export interface ParticipantWeights {
  userId: string;
  /** 속성 → 가중치. 정규화 전 값을 넣어도 된다 (내부에서 합이 1이 되도록 정규화한다) */
  weights: Record<string, number>;
}

export interface CandidateAttributes {
  candidateId: string;
  /** 속성 → 적합도 [0,1]. API 메타데이터 기반이며 심판이 만들어내지 않는다 */
  match: Record<string, number>;
  /** 하드 제약 위반 사유. 있으면 **스코어링 이전에 실격**된다 (8.1) */
  disqualifyReason?: string;
  /** 소프트 제약 위반 태그. 개당 SOFT_VIOLATION_PENALTY 감점 */
  softViolations?: readonly string[];
  /**
   * 이 후보에 강도 0.8 이상으로 반대한 참여자.
   * 해당 참여자의 만족도가 5.5 미만이면 이 후보는 선택에서 뒤로 밀린다 (심판 공통 계약).
   */
  strongOpposerIds?: readonly string[];
}

/** 양보 크레딧 원장. 초기값은 전원 1.0 */
export type ConcessionLedger = Record<string, number>;

export const CONCESSION_ALPHA = 0.4;
export const CONCESSION_MIN = 0.6;
export const CONCESSION_MAX = 1.8;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const round2 = (value: number): number => Number(value.toFixed(2));

/**
 * 가중치를 합이 1이 되도록 정규화한다.
 * 합이 0이면(응답 없음) 빈 객체를 돌려주고, 만족도는 중립값으로 계산된다.
 */
export function normalizeWeights(weights: Record<string, number>): Record<string, number> {
  const entries = Object.entries(weights).filter(([, value]) => Number.isFinite(value) && value > 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return {};
  return Object.fromEntries(entries.map(([key, value]) => [key, value / total]));
}

/**
 * Sat(i, c) = Σ_k ( w[i][k] × match(c, k) ) × 척도 − 소프트 위반 감점
 *
 * 가중치가 없는 참여자(미응답·해당 카테고리 skip)는 중립값을 받는다.
 * 반환값은 [0, 10]으로 클리핑된다.
 */
export function satisfaction(
  participant: ParticipantWeights,
  candidate: CandidateAttributes,
  options: { softViolationPenalty?: number } = {},
): number {
  const penalty =
    (candidate.softViolations?.length ?? 0) *
    (options.softViolationPenalty ?? SOFT_VIOLATION_PENALTY);

  const weights = normalizeWeights(participant.weights);
  if (Object.keys(weights).length === 0) {
    return round2(clamp(NEUTRAL_SATISFACTION - penalty, 0, SATISFACTION_SCALE));
  }

  let raw = 0;
  for (const [attribute, weight] of Object.entries(weights)) {
    // 후보에 없는 속성은 0으로 본다. 없는 값을 추정해 채우지 않는다.
    raw += weight * clamp(candidate.match[attribute] ?? 0, 0, 1);
  }

  return round2(clamp(raw * SATISFACTION_SCALE - penalty, 0, SATISFACTION_SCALE));
}

export interface CandidateScore {
  candidateId: string;
  /** 참여자별 만족도 */
  byUser: Record<string, number>;
  /** 가장 불만족한 사람의 만족도. Maximin의 1순위 기준 */
  min: number;
  /** 총합. 동률일 때의 2순위 기준 */
  sum: number;
  /** 양보 크레딧 가중 총합. 동률일 때의 3순위 기준 */
  ccWeighted: number;
  /** 강도 0.8 이상 반대자 중 만족도 5.5 미만인 사람이 있는가 */
  violatesIntensityFloor: boolean;
}

export interface ScoreBoard {
  scored: CandidateScore[];
  /** 하드 제약 위반으로 스코어링 이전에 제외된 후보. 사유와 함께 회의록에 게시한다 */
  disqualified: { candidateId: string; reason: string }[];
}

export function scoreCandidates(
  participants: readonly ParticipantWeights[],
  candidates: readonly CandidateAttributes[],
  ledger: ConcessionLedger = {},
  options: { softViolationPenalty?: number } = {},
): ScoreBoard {
  const disqualified: ScoreBoard['disqualified'] = [];
  const scored: CandidateScore[] = [];

  for (const candidate of candidates) {
    if (candidate.disqualifyReason !== undefined) {
      disqualified.push({ candidateId: candidate.candidateId, reason: candidate.disqualifyReason });
      continue;
    }

    const byUser: Record<string, number> = {};
    for (const participant of participants) {
      byUser[participant.userId] = satisfaction(participant, candidate, options);
    }

    const values = Object.values(byUser);
    const strongOpposers = candidate.strongOpposerIds ?? [];

    scored.push({
      candidateId: candidate.candidateId,
      byUser,
      min: values.length === 0 ? 0 : Math.min(...values),
      sum: round2(values.reduce((total, value) => total + value, 0)),
      ccWeighted: round2(
        participants.reduce(
          (total, participant) =>
            total + (ledger[participant.userId] ?? 1) * (byUser[participant.userId] ?? 0),
          0,
        ),
      ),
      violatesIntensityFloor: strongOpposers.some(
        (userId) => (byUser[userId] ?? 0) < reviewThresholds.strongOpposeSatisfactionFloor,
      ),
    });
  }

  return { scored, disqualified };
}

export type SelectionTier = 'maximin' | 'sum' | 'concession_weighted' | 'candidate_order';

export interface Selection {
  winner: CandidateScore;
  /** 어느 기준에서 승부가 갈렸는가. 회의록에 그대로 노출한다 */
  decidedBy: SelectionTier;
  /** 1순위에서 동률이었던 후보들 */
  tiedWith: string[];
  /**
   * 강한 반대자 만족도 하한(5.5)을 지키는 후보가 하나도 없어 어쩔 수 없이
   * 위반 후보를 골랐는가. true면 미해결 쟁점으로 기록해야 한다.
   */
  intensityFloorUnmet: boolean;
}

/**
 * 평등주의 우선 선택 (8.2).
 *
 *   1순위 max( min_i Sat )        가장 불만족한 사람의 만족도 최대화
 *   2순위 max( Σ_i Sat )          총합
 *   3순위 max( Σ_i CC[i]×Sat )    양보 크레딧 가중
 *
 * 단순 합계로 뽑으면 소수가 계속 희생되므로 총합은 보조 기준이다.
 * 강한 반대자 하한을 지키는 후보가 있으면 그쪽을 먼저 본다.
 */
export function selectWinner(board: ScoreBoard): Selection | null {
  if (board.scored.length === 0) return null;

  const clean = board.scored.filter((candidate) => !candidate.violatesIntensityFloor);
  const pool = clean.length > 0 ? clean : board.scored;
  const intensityFloorUnmet = clean.length === 0;

  const bestBy = (
    items: CandidateScore[],
    pick: (candidate: CandidateScore) => number,
  ): CandidateScore[] => {
    const best = Math.max(...items.map(pick));
    return items.filter((candidate) => Math.abs(pick(candidate) - best) <= EPSILON);
  };

  const byMin = bestBy(pool, (candidate) => candidate.min);
  if (byMin.length === 1) {
    return {
      winner: byMin[0] as CandidateScore,
      decidedBy: 'maximin',
      tiedWith: [],
      intensityFloorUnmet,
    };
  }

  const tiedWith = byMin.map((candidate) => candidate.candidateId);

  const bySum = bestBy(byMin, (candidate) => candidate.sum);
  if (bySum.length === 1) {
    return { winner: bySum[0] as CandidateScore, decidedBy: 'sum', tiedWith, intensityFloorUnmet };
  }

  const byCc = bestBy(bySum, (candidate) => candidate.ccWeighted);
  if (byCc.length === 1) {
    return {
      winner: byCc[0] as CandidateScore,
      decidedBy: 'concession_weighted',
      tiedWith,
      intensityFloorUnmet,
    };
  }

  // 세 기준이 모두 동률이면 후보 순서로 결정한다. 무작위를 쓰면 재현성이 깨진다.
  return {
    winner: byCc[0] as CandidateScore,
    decidedBy: 'candidate_order',
    tiedWith,
    intensityFloorUnmet,
  };
}

export interface ConcessionUpdate {
  ledger: ConcessionLedger;
  /** 참여자별 평균 대비 손익. 음수면 양보한 것 */
  deltas: Record<string, number>;
}

/**
 * 양보 크레딧 갱신 (8.3).
 *
 *   Δ_i = Sat(i, winner) − mean_j( Sat(j, winner) )
 *   Δ_i < 0 (평균보다 손해) → CC[i] += |Δ_i| × α
 *   Δ_i > 0 (평균보다 이득) → CC[i] −= Δ_i × α × 0.5
 *   CC 범위: [0.6, 1.8] 클리핑
 *
 * Δ는 척도(0~10)로 나눠 정규화한다. 원문 그대로 0~10 스케일의 Δ에 α를 곱하면
 * 한 라운드 만에 클리핑 경계에 닿아 크레딧이 라운드 간 차이를 표현하지 못한다.
 * 정규화하면 라운드당 최대 이동폭이 0.4로 제한되어 7라운드에 걸쳐 누적된다.
 */
export function updateConcessionCredits(
  ledger: ConcessionLedger,
  winnerSatisfactions: Record<string, number>,
  alpha: number = CONCESSION_ALPHA,
): ConcessionUpdate {
  const userIds = Object.keys(winnerSatisfactions);
  if (userIds.length === 0) return { ledger: { ...ledger }, deltas: {} };

  const mean =
    userIds.reduce((total, userId) => total + (winnerSatisfactions[userId] ?? 0), 0) /
    userIds.length;

  const next: ConcessionLedger = { ...ledger };
  const deltas: Record<string, number> = {};

  for (const userId of userIds) {
    const delta = (winnerSatisfactions[userId] ?? 0) - mean;
    const normalized = delta / SATISFACTION_SCALE;
    const current = ledger[userId] ?? 1;

    // 손해 본 쪽은 이득 본 쪽의 2배 속도로 크레딧이 쌓인다. 누적 손해자를 우선 보정한다.
    const moved =
      normalized < 0 ? current + Math.abs(normalized) * alpha : current - normalized * alpha * 0.5;

    deltas[userId] = round2(delta);
    next[userId] = round2(clamp(moved, CONCESSION_MIN, CONCESSION_MAX));
  }

  return { ledger: next, deltas };
}

/** 발언 순서는 양보 크레딧 내림차순. 누적 손해자가 먼저 말한다 (7.3 STATEMENT) */
export function speakingOrder(
  userIds: readonly string[],
  ledger: ConcessionLedger,
): string[] {
  return [...userIds].sort((a, b) => {
    const diff = (ledger[b] ?? 1) - (ledger[a] ?? 1);
    // 크레딧이 같으면 userId 순. 무작위를 쓰면 재현성이 깨진다.
    return Math.abs(diff) > EPSILON ? diff : a.localeCompare(b);
  });
}
