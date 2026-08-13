import { z } from 'zod';
import { planningNodeIds } from './planning.js';
import { refereeCategories, reviewTriggers, roundIds } from './rounds.js';

/**
 * Constrained dispatch — Orchestrator가 합법 수를 계산하고 Supervisor가 그 안에서만 고른다.
 * 근거: agent-architecture.md 4장
 */
export const moveTypes = [
  'run_referee',
  'rerun_round',
  'resource_candidates',
  'recalc_node',
  'prefetch',
  'request_budget_transfer',
  'raise_approval',
  'finalize_plan',
  'block_run',
] as const;

export type MoveType = (typeof moveTypes)[number];

export const legalMoveSchema = z.object({
  moveId: z.string(),
  type: z.enum(moveTypes),
  target: z.object({
    round: z.enum(roundIds).optional(),
    category: z.enum(refereeCategories).optional(),
    nodeId: z.enum(planningNodeIds).optional(),
  }),
  dependencies: z.object({
    satisfied: z.array(z.string()),
    missing: z.array(z.string()),
  }),
  guards: z.object({
    roundRerunUsed: z.number().int().nonnegative(),
    roundRerunCap: z.number().int().nonnegative(),
    globalRecalcUsed: z.number().int().nonnegative(),
    globalRecalcCap: z.number().int().nonnegative(),
    turnsRemaining: z.number().int().nonnegative(),
  }),
  budget: z.object({
    tokensRemaining: z.number().int().nonnegative(),
    usdRemaining: z.number().nonnegative(),
    toolCallsRemaining: z.record(z.string(), z.number().int().nonnegative()),
  }),
  parallelGroup: z.string().nullable(),
  estimated: z.object({ latencySec: z.number().nonnegative(), usd: z.number().nonnegative() }),
});

export type LegalMove = z.infer<typeof legalMoveSchema>;

export const reviewDecisionSchema = z.object({
  roundId: z.enum(roundIds),
  decision: z.enum(['pass', 'rerun', 'resource']),
  triggered: z.array(z.enum(reviewTriggers)),
  /** 참여자에게 그대로 노출되는 설명 */
  reason: z.string(),
  /** 재심 시 심판에게 전달할 구체적 지시 */
  instruction: z.string().nullable(),
});

export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

export const dispatchProposalSchema = z.object({
  runId: z.string(),
  sequence: z
    .array(
      z.object({
        moveId: z.string(),
        reason: z.string(),
        parallelWith: z.array(z.string()).optional(),
      }),
    )
    .min(1),
  reviewDecisions: z.array(reviewDecisionSchema).default([]),
  budgetTransferRequest: z
    .object({
      fromRound: z.enum(roundIds),
      toRound: z.enum(roundIds),
      amountPerPersonKrw: z.number().int(),
      rationale: z.string(),
    })
    .nullable()
    .default(null),
  notes: z.string().default(''),
});

export type DispatchProposal = z.infer<typeof dispatchProposalSchema>;

/** 검증 규칙 식별자. 근거: agent-architecture.md 4.3 */
export const validationRuleIds = [
  'V1',
  'V2',
  'V3',
  'V4',
  'V5',
  'V6',
  'V7',
  'V8',
  'V9',
  'V10',
] as const;
export type ValidationRuleId = (typeof validationRuleIds)[number];

export interface DispatchValidationResult {
  accepted: boolean;
  violations: Array<{ rule: ValidationRuleId; moveId?: string; detail: string }>;
  /** V3 위반은 거부가 아니라 직렬화로 처리한다 */
  serialized: string[];
}

export interface DispatchOutcome {
  decidedBy: 'supervisor' | 'default';
  fallbackUsed: boolean;
  rejectedRules: ValidationRuleId[];
  executed: string[];
}
