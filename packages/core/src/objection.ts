import {
  objectionCaps,
  remainingObjections,
  type ObjectionImpact,
  type ObjectionRejectReason,
  type ObjectionRequest,
  type PlanningNodeId,
  type RoundId,
} from '@tm/contracts';
import { categoryToNode, roundsForNodes } from './round-map.js';
import { computeStaleNodes } from './planning-graph.js';

/**
 * 이의 제기 심사와 영향 산출. 전부 결정론이며 LLM을 쓰지 않는다.
 * 상세 정책: docs/objection-and-rerun.md
 */

export interface ObjectionContext {
  roomStatus: string;
  isMember: boolean;
  used: { room: number; user: number };
  caps?: { perRoom: number; perUser: number };
  /** 예약 완료로 잠긴 노드 */
  bookedNodes: readonly PlanningNodeId[];
  /** 이미 접수된 (userId, targetRoundId) 조합 */
  existingTargets: ReadonlyArray<{ userId: string; targetRoundId: RoundId }>;
  /** 이 방에서 실제로 실행된 라운드 */
  completedRounds: readonly RoundId[];
  /** 1인 예산 기준선. 예산 완화 요청이 10%를 넘는지 판정에 쓴다 */
  budgetBaselinePerPersonKrw?: number;
}

/**
 * 라운드당 재실행 비용·시간의 거친 추정치.
 * 실측 p50/p95로 교체할 자리다 (agent-architecture.md 12.2).
 */
const ROUND_ESTIMATE = { durationSec: 150, costUsd: 0.05 } as const;

export function screenObjection(
  request: ObjectionRequest,
  context: ObjectionContext,
): ObjectionRejectReason | null {
  if (context.roomStatus !== 'COMPLETED') return 'room_not_completed';
  if (!context.isMember) return 'not_a_member';
  if (!context.completedRounds.includes(request.targetRoundId)) return 'unknown_target';

  const caps = context.caps ?? objectionCaps;
  const remaining = remainingObjections(context.used, caps);
  if (remaining.user <= 0) return 'user_cap_exhausted';
  if (remaining.room <= 0) return 'room_cap_exhausted';

  const duplicate = context.existingTargets.some(
    (target) => target.userId === request.userId && target.targetRoundId === request.targetRoundId,
  );
  if (duplicate) return 'duplicate_target';

  return null;
}

export function assessObjection(
  request: ObjectionRequest,
  context: ObjectionContext,
): ObjectionImpact {
  const caps = context.caps ?? objectionCaps;
  // R0은 심판 카테고리가 아니라 일정 확정 라운드다. 변경 시작점은 date 노드다.
  const changedNode: PlanningNodeId =
    request.targetRoundId === 'r_0' ? 'date' : categoryToNode[request.targetCategory];
  const staleNodes = computeStaleNodes([changedNode]);
  const rerunRounds = roundsForNodes(staleNodes);

  const bookedNodesAffected = staleNodes.filter((node) => context.bookedNodes.includes(node));

  const approvalRequired: ObjectionImpact['approvalRequired'] = [];
  if (bookedNodesAffected.length > 0) approvalRequired.push('booked_node_change');

  // 날짜는 R0 산출물이며 모든 하위 노드를 흔든다. 자동 실행하지 않는다.
  if (request.targetRoundId === 'r_0') approvalRequired.push('date_change');

  const baseline = context.budgetBaselinePerPersonKrw;
  if (
    request.budgetDeltaPerPersonKrw > 0 &&
    baseline !== undefined &&
    baseline > 0 &&
    request.budgetDeltaPerPersonKrw / baseline > 0.1
  ) {
    approvalRequired.push('budget_over_10_percent');
  }

  const used = { room: context.used.room + 1, user: context.used.user + 1 };
  const remaining = remainingObjections(used, caps);

  return {
    staleNodes,
    rerunRounds,
    estimatedDurationSec: rerunRounds.length * ROUND_ESTIMATE.durationSec,
    estimatedCostUsd: Number((rerunRounds.length * ROUND_ESTIMATE.costUsd).toFixed(3)),
    bookedNodesAffected,
    cancellationRisk: bookedNodesAffected.length > 0 ? 'high' : 'none',
    approvalRequired,
    remainingAfterThis: { room: remaining.room, user: remaining.user },
  };
}

/**
 * 이의에 안전 관련 하드 제약이 포함되면 해당 후보는 재검증 전까지 최종안이 될 수 없다.
 * 근거: travel-mediation-plan.md 19.6 fail-closed
 */
export function requiresFailClosedRecheck(request: ObjectionRequest): boolean {
  return request.lateConstraints.some((constraint) => constraint.safety);
}
