import { executionCaps, reviewThresholds, type ReviewTrigger, type RoundId } from '@tm/contracts';

/**
 * Chief 자동 재심 조건의 **기계 판정과 수치 산출** (기획서 8.5).
 *
 * 권한 분배 (agent-architecture.md 3.1):
 *   · C1~C4·C6 — 코드가 수치를 산출하고, Supervisor가 그 수치를 보고 판정·서술한다
 *   · C5·C7   — 코드 판정이 최종이다. Supervisor 판단이 다르면 코드를 채택하고 불일치를 남긴다
 *
 * 그래서 이 파일은 "재심할지"를 결정하지 않는다. 재심 여부는 Supervisor의 몫이고,
 * 여기서는 판정에 필요한 수치와 기계 판정만 만든다 (INV-2).
 */

export interface ReviewInput {
  roundId: RoundId;
  /** 승자 후보에 대한 참여자별 만족도 */
  satisfactions: Record<string, number>;
  /** 이 라운드에 배정된 1인 예산과 실제 지출 (KRW) */
  budget: { allocatedPerPersonKrw: number; spentPerPersonKrw: number };
  /** 참여자별 연속 최하위 라운드 수 (이 라운드 포함) */
  lastPlaceStreak?: Record<string, number>;
  /** C5: 하드 제약 위반. 코드가 사전 필터링한 결과이며 1건이라도 있으면 즉시 재조달 */
  hardConstraintViolations?: readonly string[];
  /** C7: 후보 검증 실패. 존재하지 않는 항목을 참조했거나 fail-closed 검증이 불가했다 */
  unverifiedCandidateIds?: readonly string[];
  /** C6: 이전 라운드와의 모순 (지역 불일치 등). 코드가 검출한 목록 */
  contradictions?: readonly string[];
}

export interface ReviewMetrics {
  minSatisfaction: number;
  maxSatisfaction: number;
  satisfactionGap: number;
  meanSatisfaction: number;
  /** 최하위 참여자. 동률이면 userId 순 */
  lastPlaceUserId: string | null;
  budgetOverrunRatio: number;
  hardViolationCount: number;
  unverifiedCount: number;
  contradictionCount: number;
}

export interface MechanicalCheckResult {
  roundId: RoundId;
  metrics: ReviewMetrics;
  /** 임계치에 걸린 조건. Supervisor에게 그대로 전달된다 */
  triggered: ReviewTrigger[];
  /** C5·C7 — 코드 판정이 최종이다. Supervisor가 뒤집을 수 없다 */
  machineVerdict: { C5: boolean; C7: boolean };
  /**
   * C5·C7이 하나라도 참이면 재심이 아니라 **재조달**이다 (8.5 마지막 줄).
   * 같은 후보군으로 다시 토론해봐야 위반은 사라지지 않는다.
   */
  requiresResourcing: boolean;
}

const round2 = (value: number): number => Number(value.toFixed(2));

export function runMechanicalChecks(input: ReviewInput): MechanicalCheckResult {
  const entries = Object.entries(input.satisfactions);
  const values = entries.map(([, value]) => value);

  const minSatisfaction = values.length === 0 ? 0 : Math.min(...values);
  const maxSatisfaction = values.length === 0 ? 0 : Math.max(...values);
  const meanSatisfaction =
    values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

  // 최하위가 여럿이면 userId 순으로 하나를 고른다. 무작위를 쓰면 재현성이 깨진다.
  const lastPlaceUserId =
    entries
      .filter(([, value]) => value === minSatisfaction)
      .map(([userId]) => userId)
      .sort()[0] ?? null;

  const { allocatedPerPersonKrw, spentPerPersonKrw } = input.budget;
  const budgetOverrunRatio =
    allocatedPerPersonKrw > 0
      ? (spentPerPersonKrw - allocatedPerPersonKrw) / allocatedPerPersonKrw
      : 0;

  const hardViolationCount = input.hardConstraintViolations?.length ?? 0;
  const unverifiedCount = input.unverifiedCandidateIds?.length ?? 0;
  const contradictionCount = input.contradictions?.length ?? 0;

  const maxStreak = Math.max(0, ...Object.values(input.lastPlaceStreak ?? {}));

  const triggered: ReviewTrigger[] = [];
  if (minSatisfaction < reviewThresholds.minSatisfaction) triggered.push('C1');
  if (maxSatisfaction - minSatisfaction > reviewThresholds.maxSatisfactionGap) triggered.push('C2');
  if (maxStreak >= reviewThresholds.consecutiveLastPlace) triggered.push('C3');
  if (budgetOverrunRatio > reviewThresholds.budgetOverrunRatio) triggered.push('C4');
  if (hardViolationCount > 0) triggered.push('C5');
  if (contradictionCount > 0) triggered.push('C6');
  if (unverifiedCount > 0) triggered.push('C7');

  const machineVerdict = { C5: hardViolationCount > 0, C7: unverifiedCount > 0 };

  return {
    roundId: input.roundId,
    metrics: {
      minSatisfaction: round2(minSatisfaction),
      maxSatisfaction: round2(maxSatisfaction),
      satisfactionGap: round2(maxSatisfaction - minSatisfaction),
      meanSatisfaction: round2(meanSatisfaction),
      lastPlaceUserId,
      budgetOverrunRatio: round2(budgetOverrunRatio),
      hardViolationCount,
      unverifiedCount,
      contradictionCount,
    },
    triggered,
    machineVerdict,
    requiresResourcing: machineVerdict.C5 || machineVerdict.C7,
  };
}

/**
 * Supervisor의 REVIEW 판정을 코드 판정과 대조한다 (INV-3 · 테스트 A6).
 * 불일치는 프롬프트 회귀 추적 대상이므로 조용히 넘기지 않는다.
 */
export function reconcileReview(
  machine: MechanicalCheckResult,
  supervisorTriggered: readonly ReviewTrigger[],
): { triggered: ReviewTrigger[]; mismatch: boolean; mismatchDetail: string[] } {
  const supervisorSet = new Set(supervisorTriggered);
  const mismatchDetail: string[] = [];

  for (const trigger of ['C5', 'C7'] as const) {
    const machineSaid = machine.machineVerdict[trigger];
    const supervisorSaid = supervisorSet.has(trigger);
    if (machineSaid !== supervisorSaid) {
      mismatchDetail.push(
        `${trigger}: 코드=${machineSaid ? '위반' : '통과'} / Supervisor=${supervisorSaid ? '위반' : '통과'}`,
      );
    }
  }

  // C5·C7은 코드 판정을 강제하고, 나머지는 Supervisor 판단을 존중한다.
  const merged = new Set(supervisorTriggered);
  for (const trigger of ['C5', 'C7'] as const) {
    if (machine.machineVerdict[trigger]) merged.add(trigger);
    else merged.delete(trigger);
  }

  const order: ReviewTrigger[] = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
  return {
    triggered: order.filter((trigger) => merged.has(trigger)),
    mismatch: mismatchDetail.length > 0,
    mismatchDetail,
  };
}

/**
 * 재심 상한 판정 (8.5). 라운드당 2회를 넘으면 차선책을 채택하고 미해결 쟁점을 기록한다.
 * 조용히 차선책으로 바꾸지 않는 것이 핵심이다.
 */
export function canRerun(rerunCount: number, cap = executionCaps.rerunsPerRound): boolean {
  return rerunCount < cap;
}
