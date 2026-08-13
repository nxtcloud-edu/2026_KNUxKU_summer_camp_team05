import { z } from 'zod';
import { intensityEntrySchema, refereeCategories, roundIds } from './rounds.js';
import { planningNodeIds } from './planning.js';

/** 심판 판결 공통 스키마. 카테고리별 확장 필드는 detail 에 담는다. */
export const verdictSchema = z.object({
  roundId: z.enum(roundIds),
  category: z.enum(refereeCategories),
  winner: z.object({
    type: z.enum(['single', 'compromise', 'policy', 'split_leg', 'none']),
    candidateIds: z.array(z.string()),
    detail: z.string(),
  }),
  /** 400자 이내 */
  rationale: z.string().max(400),
  runnerUp: z.string().nullable().default(null),
  disqualified: z
    .array(z.object({ candidateId: z.string(), reason: z.string() }))
    .default([]),
  intensityProfile: z.array(intensityEntrySchema).default([]),
  dissent: z
    .array(
      z.object({
        userId: z.string(),
        reason: z.string(),
        intensity: z.number().min(0).max(1).optional(),
        mitigation: z.string().nullable(),
      }),
    )
    .default([]),
  scores: z.record(z.string(), z.number()).default({}),
  minSatisfaction: z.number().nullable().default(null),
  satisfactionGap: z.number().nullable().default(null),
  budgetImpact: z.object({
    allocated: z.number(),
    actual: z.number(),
    delta: z.number(),
  }),
  handoff: z.record(z.string(), z.unknown()).default({}),
  /** 확인하지 못한 것은 숨기지 않는다 */
  uncertainties: z.array(z.string()).default([]),
  warnings: z.array(z.object({ type: z.string(), message: z.string() })).default([]),
  followups: z
    .array(
      z.object({
        task: z.string(),
        deadline: z.string().nullable(),
        reason: z.string(),
        url: z.string().nullable(),
      }),
    )
    .default([]),
  toolCalls: z.array(z.string()).default([]),
  /** 필수 검증이 빠진 상태에서 예약 체크리스트를 발행하는 근거가 되지 않는다 */
  partialSourcing: z.boolean().default(false),
  detail: z.record(z.string(), z.unknown()).default({}),
});

export type Verdict = z.infer<typeof verdictSchema>;

/** C5·C7 기계 검증 결과. Supervisor 판단보다 우선한다. */
export const mechanicalCheckSchema = z.object({
  roundId: z.enum(roundIds),
  hardConstraintViolations: z.array(
    z.object({ candidateId: z.string(), constraint: z.string(), userId: z.string() }),
  ),
  missingCandidateRefs: z.array(z.string()),
  failClosedUnverified: z.array(
    z.object({ candidateId: z.string(), queryClass: z.string() }),
  ),
  minSatisfaction: z.number().nullable(),
  satisfactionGap: z.number().nullable(),
  budgetDelta: z.number().nullable(),
  staleNodes: z.array(z.enum(planningNodeIds)),
});

export type MechanicalCheck = z.infer<typeof mechanicalCheckSchema>;
