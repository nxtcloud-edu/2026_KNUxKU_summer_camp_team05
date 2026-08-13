import { z } from 'zod';
import { planningNodeIds } from './planning.js';
import { refereeCategories, roundIds } from './rounds.js';

/**
 * 이의 제기(Objection) — 사용자가 회의록과 결과물을 보고 재토론을 요구하는 유일한 경로.
 *
 * 설계 전제: 회의 중 실시간 개입은 영구적으로 제외된다(기획서 14.2). 이의 제기는 개입이
 * 아니라 완료된 결과에 대한 **사후 액션**이므로 "설문 내고 방치" 원칙을 깨지 않는다.
 * 근거: travel-mediation-plan.md 8.6 · 19.9, docs/objection-and-rerun.md
 */

/** 이의 유형. 기획서 8.6의 세 가지 재개최 옵션에 대응한다. */
export const objectionKinds = ['add_condition', 'replace_candidates', 'redo'] as const;
export type ObjectionKind = (typeof objectionKinds)[number];

export const objectionStatuses = [
  'submitted',
  'rejected',
  'needs_approval',
  'accepted',
  'queued',
  'applied',
  'expired',
] as const;
export type ObjectionStatus = (typeof objectionStatuses)[number];

/** 이의 제기 상한. 방 단위와 1인 단위를 함께 둔다. */
export const objectionCaps = {
  /** 방 전체 누적 상한 */
  perRoom: 3,
  /** 1인 상한. 한 사람이 방 상한을 독점하지 못하게 한다 */
  perUser: 1,
} as const;

/**
 * 회의록 앵커. 이의가 특정 발언·판결·후보를 지목하면 심판이 그 지점을 반드시 재검증한다.
 * 앵커 없는 이의는 "그냥 다시"로만 처리된다.
 */
export const objectionAnchorSchema = z.object({
  verdictId: z.string().optional(),
  /** Negotiation Causality Ledger의 claimId */
  claimIds: z.array(z.string()).default([]),
  candidateIds: z.array(z.string()).default([]),
  /** 회의록 메시지 seq */
  messageSeqs: z.array(z.number().int().nonnegative()).default([]),
});

export type ObjectionAnchor = z.infer<typeof objectionAnchorSchema>;

/**
 * 이의로 새 하드 제약을 등록할 수 있다.
 * 설문에서 놓친 제약이 영구히 반영되지 않는 리스크(기획서 R3)의 유일한 회복 경로다.
 * safety = true 인 항목(알레르기·접근성)은 등록되는 순간 fail-closed 재검증 대상이 된다.
 */
export const lateConstraintSchema = z.object({
  tag: z.string().trim().min(1).max(40),
  kind: z.enum(['allergy', 'dietary', 'mobility', 'forbidden', 'budget']),
  safety: z.boolean(),
  note: z.string().max(200).optional(),
});

export type LateConstraint = z.infer<typeof lateConstraintSchema>;

export const objectionRequestSchema = z.object({
  roomId: z.string().min(1),
  /** 이의를 제기한 참여자. 방장 여부와 무관하게 누구나 제기할 수 있다 */
  userId: z.string().min(1),
  /** 어떤 결정에 대한 이의인가 */
  targetRoundId: z.enum(roundIds),
  targetCategory: z.enum(refereeCategories),
  kind: z.enum(objectionKinds),
  /** 사용자가 쓴 이의 사유. 회의록과 재심 지시문에 그대로 인용된다 */
  reason: z.string().trim().min(1).max(300),
  anchor: objectionAnchorSchema.default({ claimIds: [], candidateIds: [], messageSeqs: [] }),
  /** kind === 'add_condition' 일 때 사용 */
  lateConstraints: z.array(lateConstraintSchema).default([]),
  /** kind === 'add_condition' 이며 예산 완화를 요청할 때 사용 */
  budgetDeltaPerPersonKrw: z.number().int().default(0),
  /** kind === 'replace_candidates' 일 때, 배제를 요청하는 후보 */
  excludeCandidateIds: z.array(z.string()).default([]),
});

export type ObjectionRequest = z.infer<typeof objectionRequestSchema>;

/** 이의 접수 거부 사유. 사용자에게 그대로 노출한다. */
export const objectionRejectReasons = [
  'room_not_completed',
  'room_cap_exhausted',
  'user_cap_exhausted',
  'duplicate_target',
  'unknown_target',
  'not_a_member',
] as const;
export type ObjectionRejectReason = (typeof objectionRejectReasons)[number];

/**
 * 재실행 전 사용자에게 보여줄 영향 예측.
 * 무엇이 바뀌고 무엇을 잃을 수 있는지 먼저 보여주지 않으면 이의는 도박이 된다.
 * 근거: travel-mediation-plan.md 19.9
 */
export const objectionImpactSchema = z.object({
  /** STALE로 전환되어 다시 계산될 노드 */
  staleNodes: z.array(z.enum(planningNodeIds)),
  /** 연쇄 재실행될 라운드 */
  rerunRounds: z.array(z.enum(roundIds)),
  estimatedDurationSec: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  /** 이미 예약한 항목이 흔들릴 위험 */
  bookedNodesAffected: z.array(z.enum(planningNodeIds)),
  cancellationRisk: z.enum(['none', 'low', 'high']),
  /** 승인이 필요한 이유. 비어 있으면 즉시 실행 가능 */
  approvalRequired: z.array(
    z.enum(['booked_node_change', 'date_change', 'exclude_attendee', 'budget_over_10_percent']),
  ),
  remainingAfterThis: z.object({
    room: z.number().int().nonnegative(),
    user: z.number().int().nonnegative(),
  }),
});

export type ObjectionImpact = z.infer<typeof objectionImpactSchema>;

export const objectionRecordSchema = z.object({
  objectionId: z.string(),
  request: objectionRequestSchema,
  status: z.enum(objectionStatuses),
  rejectReason: z.enum(objectionRejectReasons).nullable().default(null),
  impact: objectionImpactSchema.nullable().default(null),
  /** 이의로 생성된 재실행 run */
  runId: z.string().nullable().default(null),
  submittedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable().default(null),
  /** 재실행 결과 요약. 만족도·예산·동선 전후 비교 */
  outcome: z
    .object({
      changed: z.boolean(),
      minSatisfactionBefore: z.number().nullable(),
      minSatisfactionAfter: z.number().nullable(),
      budgetDeltaPerPersonKrw: z.number().int(),
      /** 이의가 반영되지 못했다면 그 이유를 반드시 남긴다 */
      unresolvedReason: z.string().nullable(),
    })
    .nullable()
    .default(null),
});

export type ObjectionRecord = z.infer<typeof objectionRecordSchema>;

/** 남은 이의 횟수 계산. 방 상한과 1인 상한 중 작은 쪽이 실제 여유다. */
export function remainingObjections(
  used: { room: number; user: number },
  caps: { perRoom: number; perUser: number } = objectionCaps,
): { room: number; user: number; canSubmit: boolean } {
  const room = Math.max(0, caps.perRoom - used.room);
  const user = Math.max(0, caps.perUser - used.user);
  return { room, user, canSubmit: room > 0 && user > 0 };
}
