import type { PlanningNodeId, RoundId } from '@tm/contracts';

/**
 * Validation Pass — 문서 생성 직전의 기계 검증 (agent-architecture.md 9.1).
 *
 * 문서 에이전트에 합치지 않는다. 환각·모순·실현 가능성 검증은 기계 판정이어야 하고,
 * 문서 에이전트는 **검증된 사실을 서술**하는 역할이다.
 *
 * 검증 항목:
 *   1. external_id 전수 검증 — 계획서의 모든 항목이 실제 조달된 후보인가
 *   2. 예산 정합성        — 항목 합계가 총계와 맞고 최저 예산자 상한을 넘지 않는가
 *   3. 일정 실현 가능성    — 시간대 중복, 이동시간 부족, 영업시간 위반
 *   4. fail-closed 미검증  — 안전·실행가능성 항목이 확인되지 않은 채 최종안에 있는가
 *
 * 근거: travel-mediation-plan.md 19.6 · README 신뢰할 수 있는 대리인 원칙
 */

export type BlockerKind =
  | 'unknown_external_id'
  | 'budget_mismatch'
  | 'budget_over_cap'
  | 'schedule_overlap'
  | 'travel_time_infeasible'
  | 'closed_at_visit_time'
  | 'unverified_fail_closed';

export interface ValidationBlocker {
  kind: BlockerKind;
  detail: string;
  /** 영향받는 노드. BLOCKED로 표시된다 */
  nodeId?: PlanningNodeId;
  roundId?: RoundId;
  itemId?: string;
}

export interface ItineraryItem {
  itemId: string;
  /** 심판이 조달한 후보의 external_id. 계획서에 실린 모든 항목이 이 값을 가져야 한다 */
  externalId: string | null;
  nodeId: PlanningNodeId;
  /** ISO 시각. 미정이면 null */
  startAt: string | null;
  endAt: string | null;
  /** 직전 항목에서 이 항목까지의 실측 이동시간(분). 미측정이면 null */
  travelMinutesFromPrev: number | null;
  /** 방문 시각에 영업하는가. null은 **미확인**이며 확인 실패와 같게 취급한다 */
  openAtVisitTime: boolean | null;
  /** 1인 비용 (KRW) */
  costPerPersonKrw: number;
  /** fail-closed 검증이 필요한 항목인가 (알레르기 대응·접근성·객실 조합 등) */
  requiresFailClosedCheck?: boolean;
  /** 그 검증을 통과했는가. requiresFailClosedCheck가 true인데 여기가 true가 아니면 차단 */
  failClosedVerified?: boolean;
}

export interface ValidationInput {
  items: readonly ItineraryItem[];
  /** 심판이 실제로 조달한 후보의 external_id 전체 집합 */
  sourcedExternalIds: readonly string[];
  budget: {
    /** 계획서에 표기된 1인 총액 */
    declaredTotalPerPersonKrw: number;
    /** 그룹 상한 = 최저 예산 참여자의 상한 (기획서 8.4) */
    groupCapPerPersonKrw: number;
  };
  /** 허용 오차 (KRW). 환율·반올림 차이를 흡수한다 */
  budgetToleranceKrw?: number;
}

export interface ValidationReport {
  /** 하나라도 blocker가 있으면 false. 계획서는 PARTIAL로만 발행된다 */
  passed: boolean;
  blockers: ValidationBlocker[];
  /** 차단은 아니지만 계획서에 표기해야 하는 것 */
  warnings: ValidationBlocker[];
  /** BLOCKED로 표시할 노드 */
  blockedNodes: PlanningNodeId[];
  checked: {
    items: number;
    externalIds: number;
    budgetDeltaKrw: number;
  };
}

const DEFAULT_TOLERANCE_KRW = 1000;

export function runValidationPass(input: ValidationInput): ValidationReport {
  const blockers: ValidationBlocker[] = [];
  const warnings: ValidationBlocker[] = [];
  const sourced = new Set(input.sourcedExternalIds);

  // ── 1. external_id 전수 검증 ─────────────────────────────────────────────
  // 후보 밖 항목이 계획서에 들어오는 경로는 환각뿐이다. 하나라도 있으면 차단한다.
  for (const item of input.items) {
    if (item.externalId === null) {
      blockers.push({
        kind: 'unknown_external_id',
        detail: `조달 근거가 없는 항목입니다: ${item.itemId}`,
        nodeId: item.nodeId,
        itemId: item.itemId,
      });
      continue;
    }
    if (!sourced.has(item.externalId)) {
      blockers.push({
        kind: 'unknown_external_id',
        detail: `조달된 후보에 없는 external_id: ${item.externalId}`,
        nodeId: item.nodeId,
        itemId: item.itemId,
      });
    }
  }

  // ── 2. 예산 정합성 ───────────────────────────────────────────────────────
  const summed = input.items.reduce((total, item) => total + item.costPerPersonKrw, 0);
  const tolerance = input.budgetToleranceKrw ?? DEFAULT_TOLERANCE_KRW;
  const delta = summed - input.budget.declaredTotalPerPersonKrw;

  if (Math.abs(delta) > tolerance) {
    blockers.push({
      kind: 'budget_mismatch',
      detail: `항목 합계 ${summed.toLocaleString()}원과 표기 총액 ${input.budget.declaredTotalPerPersonKrw.toLocaleString()}원이 ${Math.abs(delta).toLocaleString()}원 어긋납니다`,
      nodeId: 'budget',
    });
  }

  if (summed > input.budget.groupCapPerPersonKrw) {
    blockers.push({
      kind: 'budget_over_cap',
      detail: `최저 예산 참여자 상한 ${input.budget.groupCapPerPersonKrw.toLocaleString()}원을 ${(summed - input.budget.groupCapPerPersonKrw).toLocaleString()}원 초과합니다`,
      nodeId: 'budget',
    });
  }

  // ── 3. 일정 실현 가능성 ──────────────────────────────────────────────────
  const scheduled = input.items
    .filter((item) => item.startAt !== null && item.endAt !== null)
    .sort((a, b) => Date.parse(a.startAt as string) - Date.parse(b.startAt as string));

  for (const [index, item] of scheduled.entries()) {
    const start = Date.parse(item.startAt as string);
    const end = Date.parse(item.endAt as string);

    if (end <= start) {
      blockers.push({
        kind: 'schedule_overlap',
        detail: `종료가 시작보다 빠르거나 같습니다: ${item.itemId}`,
        nodeId: item.nodeId,
        itemId: item.itemId,
      });
    }

    const previous = scheduled[index - 1];
    if (previous !== undefined) {
      const previousEnd = Date.parse(previous.endAt as string);
      if (start < previousEnd) {
        blockers.push({
          kind: 'schedule_overlap',
          detail: `시간대가 겹칩니다: ${previous.itemId} → ${item.itemId}`,
          nodeId: item.nodeId,
          itemId: item.itemId,
        });
      } else if (item.travelMinutesFromPrev === null) {
        // 이동시간을 재보지 않았다는 것은 실현 가능성을 모른다는 뜻이다.
        warnings.push({
          kind: 'travel_time_infeasible',
          detail: `이동시간이 실측되지 않았습니다: ${previous.itemId} → ${item.itemId}`,
          nodeId: item.nodeId,
          itemId: item.itemId,
        });
      } else {
        const gapMinutes = (start - previousEnd) / 60000;
        if (gapMinutes < item.travelMinutesFromPrev) {
          blockers.push({
            kind: 'travel_time_infeasible',
            detail: `이동시간 ${item.travelMinutesFromPrev}분이 필요한데 여유가 ${Math.round(gapMinutes)}분뿐입니다: ${previous.itemId} → ${item.itemId}`,
            nodeId: item.nodeId,
            itemId: item.itemId,
          });
        }
      }
    }

    // 영업시간은 fail-closed다. 미확인(null)은 통과가 아니라 차단이다.
    if (item.openAtVisitTime === false) {
      blockers.push({
        kind: 'closed_at_visit_time',
        detail: `방문 시각에 영업하지 않습니다: ${item.itemId}`,
        nodeId: item.nodeId,
        itemId: item.itemId,
      });
    } else if (item.openAtVisitTime === null) {
      blockers.push({
        kind: 'closed_at_visit_time',
        detail: `영업시간을 확인하지 못했습니다: ${item.itemId}`,
        nodeId: item.nodeId,
        itemId: item.itemId,
      });
    }
  }

  // ── 4. fail-closed 미검증 ────────────────────────────────────────────────
  for (const item of input.items) {
    if (item.requiresFailClosedCheck !== true) continue;
    if (item.failClosedVerified === true) continue;
    blockers.push({
      kind: 'unverified_fail_closed',
      detail: `안전·실행가능성 검증을 통과하지 못했습니다: ${item.itemId}`,
      nodeId: item.nodeId,
      itemId: item.itemId,
    });
  }

  const blockedNodes = [
    ...new Set(
      blockers
        .map((blocker) => blocker.nodeId)
        .filter((nodeId): nodeId is PlanningNodeId => nodeId !== undefined),
    ),
  ];

  return {
    passed: blockers.length === 0,
    blockers,
    warnings,
    blockedNodes,
    checked: {
      items: input.items.length,
      externalIds: sourced.size,
      budgetDeltaKrw: delta,
    },
  };
}

/**
 * 문서 생성 게이트 (테스트 A20).
 * Validation Pass가 실패하면 완전한 계획서를 발행할 수 없고 PARTIAL만 가능하다.
 * PARTIAL은 예약 행동을 유도하지 않는다.
 */
export function documentGate(report: ValidationReport): {
  allowed: boolean;
  badge: 'VERIFIED' | 'PARTIAL';
  reason: string | null;
} {
  if (report.passed) return { allowed: true, badge: 'VERIFIED', reason: null };
  return {
    allowed: false,
    badge: 'PARTIAL',
    reason: `검증 실패 ${report.blockers.length}건: ${report.blockers
      .slice(0, 3)
      .map((blocker) => blocker.detail)
      .join(' / ')}`,
  };
}
