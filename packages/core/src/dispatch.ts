import {
  roundIds,
  type DispatchProposal,
  type DispatchValidationResult,
  type LegalMove,
  type PlanningNodeId,
  type RoundId,
  type ValidationRuleId,
} from '@tm/contracts';
import type { MechanicalCheckResult } from './review.js';

/**
 * 디스패치 검증 V1~V10 (agent-architecture.md 4.3).
 *
 * Supervisor의 출력은 항상 "제안"이다. 이 검증을 통과하지 못한 제안은 어떤 상태도
 * 바꾸지 못한다 (INV-1). 그래서 이 파일은 LLM을 호출하지 않고, 호출자가 주는
 * 상태만 보고 판정한다.
 *
 * 위반 처리는 규칙마다 다르다:
 *   거부       V1 V2 V4 V5 V7 V9
 *   직렬화     V3   (병렬 그룹이 다르면 순차 실행으로 강등)
 *   축약 모드  V6   (상한 초과 시 거부가 아니라 강등)
 *   변환       V8   (raise_approval 잡으로 바꾼다)
 *   코드 채택  V10  (C5·C7 불일치 시 코드 판정을 쓰고 불일치를 기록)
 */

/** 기본 위상 순서. Supervisor 실패 시의 폴백이자 V2의 기준이다 (4.5) */
export const defaultRoundOrder: readonly RoundId[] = roundIds;

export interface DispatchContext {
  moves: readonly LegalMove[];
  /** 예약 완료·사용자 수동 확정 노드. 제안으로 변경할 수 없다 (INV-5) */
  lockedNodes?: readonly PlanningNodeId[];
  /**
   * fail-closed 검증을 통과하지 못한 노드.
   * V9의 핵심 입력이며, Data Agent의 VerificationUnavailableError가 원천이다.
   */
  unverifiedNodes?: readonly PlanningNodeId[];
  /** 아직 한 번도 판결을 남기지 않은 라운드. 하나라도 있으면 finalize 금지 (V7) */
  pendingRounds?: readonly RoundId[];
  /** 이미 실행이 끝난 라운드. V2의 위상 순서 판정에 쓴다 */
  completedRounds?: readonly RoundId[];
  /** 승인이 필요한 이동 종류 (날짜 변경·참석자 제외·예산 +10% 초과) */
  approvalRequiredMoveIds?: readonly string[];
  /** 남은 예산·턴이 부족한가. true면 축약 모드로 강등한다 (V6) */
  budgetExhausted?: boolean;
  /** 기계 판정 결과. V10에서 Supervisor의 C5·C7 주장과 대조한다 */
  mechanicalChecks?: readonly MechanicalCheckResult[];
}

export interface DispatchVerdict extends DispatchValidationResult {
  /** V6 위반. 거부가 아니라 축약 모드로 진행한다 */
  degradeToReduced: boolean;
  /** V8 위반. 자동 실행 대신 승인 요청 잡으로 바꿀 moveId */
  convertToApproval: string[];
  /** V9 위반으로 BLOCKED 처리해야 하는 노드 */
  blockedNodes: PlanningNodeId[];
  /** V10 불일치. 프롬프트 회귀 추적 대상 */
  reviewMismatch: { roundId: RoundId; detail: string }[];
}

const PROMOTING_MOVES = new Set(['finalize_plan']);

export function validateProposal(
  proposal: DispatchProposal,
  context: DispatchContext,
): DispatchVerdict {
  const violations: DispatchValidationResult['violations'] = [];
  const serialized: string[] = [];
  const convertToApproval: string[] = [];
  const blockedNodes: PlanningNodeId[] = [];
  const reviewMismatch: DispatchVerdict['reviewMismatch'] = [];
  let degradeToReduced = false;

  const byId = new Map(context.moves.map((move) => [move.moveId, move]));
  const locked = new Set(context.lockedNodes ?? []);
  const unverified = new Set(context.unverifiedNodes ?? []);
  const pending = new Set(context.pendingRounds ?? []);
  const completed = new Set(context.completedRounds ?? []);
  const approvalRequired = new Set(context.approvalRequiredMoveIds ?? []);

  const fail = (rule: ValidationRuleId, detail: string, moveId?: string): void => {
    violations.push(moveId === undefined ? { rule, detail } : { rule, moveId, detail });
  };

  // ── V1: 모든 moveId가 현재 LegalMove 집합에 존재 ──────────────────────────
  for (const step of proposal.sequence) {
    if (!byId.has(step.moveId)) {
      fail('V1', '합법 수 집합에 없습니다', step.moveId);
    }
  }

  const steps = proposal.sequence.filter((step) => byId.has(step.moveId));

  // ── V2: 노드 의존성 위상 순서 위반 금지 ────────────────────────────────────
  // 이미 끝난 라운드를 제외한 나머지가 기본 위상 순서를 거스르면 거부한다.
  const orderIndex = new Map(defaultRoundOrder.map((round, index) => [round, index]));
  let previousIndex = -1;
  for (const step of steps) {
    const move = byId.get(step.moveId) as LegalMove;
    const round = move.target.round;
    if (round === undefined || move.type === 'prefetch') continue; // 프리페치는 순서 밖이다
    const index = orderIndex.get(round) ?? -1;
    if (index < previousIndex) {
      fail('V2', `위상 순서 위반: ${round}가 앞선 라운드보다 뒤에 와야 합니다`, step.moveId);
    }
    previousIndex = Math.max(previousIndex, index);

    if (move.dependencies.missing.length > 0) {
      fail('V2', `미충족 의존성: ${move.dependencies.missing.join(', ')}`, step.moveId);
    }
  }

  // ── V3: parallelWith는 같은 parallelGroup끼리만 → 위반은 직렬화 ────────────
  for (const step of steps) {
    const move = byId.get(step.moveId) as LegalMove;
    for (const peerId of step.parallelWith ?? []) {
      const peer = byId.get(peerId);
      if (peer === undefined || peer.parallelGroup === null || move.parallelGroup === null) {
        serialized.push(step.moveId);
        continue;
      }
      if (peer.parallelGroup !== move.parallelGroup) serialized.push(step.moveId);
    }
  }

  // ── V4: 잠긴 노드(BOOKED·수동 확정)를 변경하지 않는다 ──────────────────────
  for (const step of steps) {
    const move = byId.get(step.moveId) as LegalMove;
    const nodeId = move.target.nodeId;
    if (nodeId !== undefined && locked.has(nodeId)) {
      fail('V4', `잠긴 노드 변경 시도: ${nodeId}. 취소 비용·영향 범위 제시 후 승인 필요`, step.moveId);
    }
  }

  // ── V5: 재심 ≤2 · 전역 재계산 ≤3 ─────────────────────────────────────────
  for (const step of steps) {
    const move = byId.get(step.moveId) as LegalMove;
    if (move.guards.roundRerunUsed >= move.guards.roundRerunCap && move.type === 'rerun_round') {
      fail('V5', '재심 상한 초과', step.moveId);
    }
    if (move.guards.globalRecalcUsed >= move.guards.globalRecalcCap && move.type === 'recalc_node') {
      fail('V5', '전역 재계산 상한 초과', step.moveId);
    }
  }

  // ── V6: 토큰·비용·턴 상한 → 거부가 아니라 축약 모드 강등 ───────────────────
  for (const step of steps) {
    const move = byId.get(step.moveId) as LegalMove;
    const overBudget = move.estimated.usd > move.budget.usdRemaining;
    const outOfTurns = move.guards.turnsRemaining <= 0;
    if (overBudget || outOfTurns || context.budgetExhausted === true) degradeToReduced = true;
  }

  // ── V7: 미실행 라운드가 있으면 finalize 금지 ──────────────────────────────
  for (const step of steps) {
    const move = byId.get(step.moveId) as LegalMove;
    if (move.type === 'finalize_plan' && pending.size > 0) {
      fail('V7', `미실행 라운드가 남아 있습니다: ${[...pending].join(', ')}`, step.moveId);
    }
  }

  // ── V8: approval_required는 자동 실행하지 않고 승인 요청으로 변환 ───────────
  for (const step of steps) {
    const move = byId.get(step.moveId) as LegalMove;
    if (approvalRequired.has(step.moveId) && move.type !== 'raise_approval') {
      convertToApproval.push(step.moveId);
      fail('V8', '승인이 필요한 변경입니다. raise_approval로 변환합니다', step.moveId);
    }
  }

  // ── V9: fail-closed 미검증 노드를 finalize/BOOKABLE로 승격 금지 ────────────
  // 안전과 직결된다. 알레르기 대응·접근성·객실 조합은 확인 전 최종 후보가 될 수 없다.
  for (const step of steps) {
    const move = byId.get(step.moveId) as LegalMove;

    if (PROMOTING_MOVES.has(move.type) && unverified.size > 0) {
      fail('V9', `미검증 노드가 있어 finalize할 수 없습니다: ${[...unverified].join(', ')}`, step.moveId);
      blockedNodes.push(...unverified);
      continue;
    }

    const nodeId = move.target.nodeId;
    if (nodeId !== undefined && unverified.has(nodeId)) {
      fail('V9', `fail-closed 검증 실패 노드는 승격할 수 없습니다: ${nodeId}`, step.moveId);
      blockedNodes.push(nodeId);
    }
  }

  // ── V10: reviewDecisions의 C5·C7이 기계 판정과 일치하는가 ─────────────────
  const machineByRound = new Map(
    (context.mechanicalChecks ?? []).map((check) => [check.roundId, check]),
  );
  for (const decision of proposal.reviewDecisions) {
    const machine = machineByRound.get(decision.roundId);
    if (machine === undefined) continue;
    for (const trigger of ['C5', 'C7'] as const) {
      const machineSaid = machine.machineVerdict[trigger];
      const supervisorSaid = decision.triggered.includes(trigger);
      if (machineSaid !== supervisorSaid) {
        reviewMismatch.push({
          roundId: decision.roundId,
          detail: `${trigger}: 코드=${machineSaid ? '위반' : '통과'} / Supervisor=${supervisorSaid ? '위반' : '통과'}`,
        });
        fail('V10', `${decision.roundId} ${trigger} 판정 불일치 — 코드 판정을 채택합니다`);
      }
    }
  }

  void completed; // V2를 완료 라운드 기반으로 확장할 때 쓴다

  return {
    // V3(직렬화)·V6(강등)·V10(코드 채택)은 거부 사유가 아니다.
    accepted: violations.every((violation) => ['V3', 'V6', 'V10'].includes(violation.rule)),
    violations,
    serialized: [...new Set(serialized)],
    degradeToReduced,
    convertToApproval: [...new Set(convertToApproval)],
    blockedNodes: [...new Set(blockedNodes)],
    reviewMismatch,
  };
}

/**
 * 거부가 누적됐을 때의 폴백 판단 (4.4).
 * 2회 거부되면 기본 위상 순서를 채택하고, run당 3회 누적되면 남은 run을 기본 순서로 고정한다.
 */
export function shouldFallback(rejectionCount: number): boolean {
  return rejectionCount >= 2;
}

export function shouldPinDefaultOrder(fallbackCount: number): boolean {
  return fallbackCount >= 3;
}
