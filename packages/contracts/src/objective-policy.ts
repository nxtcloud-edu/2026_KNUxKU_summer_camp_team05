import { z } from 'zod';

export const protectedObjectiveCategories = ['DINING', 'ACTIVITY', 'ACCOMMODATION'] as const;
export type ProtectedObjectiveCategory = (typeof protectedObjectiveCategories)[number];

export const protectedObjectiveRanks = [1, 2] as const;
export type ProtectedObjectiveRank = (typeof protectedObjectiveRanks)[number];

/** 상한은 정책값으로 분리해 후속 버전에서 스키마 구조를 바꾸지 않고 확장한다. */
export const protectedObjectivePolicyV1 = {
  maxPerParticipant: 2,
  selectionRequired: false,
  internalRankRequired: true,
  defaultRequestedCount: 1,
  autoDemotionAllowed: false,
  mergeRequiresEquivalentCoreAttributes: true,
} as const;

export const protectedObjectiveSchema = z.object({
  objectiveId: z.string().min(1),
  participantId: z.string().min(1),
  rank: z.union([z.literal(1), z.literal(2)]),
  category: z.enum(protectedObjectiveCategories),
  originalText: z.string().min(1).max(100),
  normalizedTargetId: z.string().min(1),
  requiredAttributeIds: z.array(z.string()),
  requestedCount: z.number().int().positive().default(1),
});
export type ProtectedObjective = z.infer<typeof protectedObjectiveSchema>;

export const protectedObjectiveListSchema = z
  .array(protectedObjectiveSchema)
  .max(protectedObjectivePolicyV1.maxPerParticipant)
  .superRefine((objectives, context) => {
    const ranks = objectives.map(({ rank }) => rank);
    if (new Set(ranks).size !== ranks.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '목적급 내부 순위는 중복될 수 없습니다.',
      });
    }
    if (ranks.includes(2) && !ranks.includes(1)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '2순위 목적급을 사용하려면 1순위 목적급이 필요합니다.',
      });
    }
  });

export const objectiveCapacityStatuses = ['FEASIBLE', 'CONFLICT', 'UNVERIFIED'] as const;
export type ObjectiveCapacityStatus = (typeof objectiveCapacityStatuses)[number];
