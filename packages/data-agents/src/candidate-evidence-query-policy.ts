import type { CandidateEvidenceQueryPlan } from '@tm/contracts';

export type CandidateEvidenceQueryPolicyIssueCode =
  | 'DUPLICATE_QUERY_PLAN_ID'
  | 'BRIEF_LINEAGE_MISMATCH'
  | 'BRIEF_QUERY_BUDGET_EXCEEDED';

export interface CandidateEvidenceQueryPolicyIssue {
  readonly code: CandidateEvidenceQueryPolicyIssueCode;
  readonly message: string;
}

const MAX_QUERY_PLANS_PER_BRIEF = 1;

function sameStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return (
    actualSet.size === expectedSet.size &&
    [...actualSet].every((value) => expectedSet.has(value))
  );
}

export function candidateEvidenceQueryPolicyIssue(
  plans: readonly CandidateEvidenceQueryPlan[],
  expectedBriefIds: readonly string[],
): CandidateEvidenceQueryPolicyIssue | null {
  const queryPlanIds = plans.map((plan) => plan.queryPlanId);
  if (new Set(queryPlanIds).size !== queryPlanIds.length) {
    return {
      code: 'DUPLICATE_QUERY_PLAN_ID',
      message: 'queryPlanId는 CandidateEvidence 실행 안에서 중복될 수 없습니다.',
    };
  }

  const actualBriefIds = plans.flatMap((plan) => plan.sourceBriefIds);
  if (!sameStringSet(actualBriefIds, expectedBriefIds)) {
    return {
      code: 'BRIEF_LINEAGE_MISMATCH',
      message: 'Proxy Brief와 중립 Brief가 QueryPlan에 정확히 한 번 이상 대표되어야 합니다.',
    };
  }

  const queryCountByBriefId = new Map<string, number>();
  for (const plan of plans) {
    for (const briefId of new Set(plan.sourceBriefIds)) {
      const nextCount = (queryCountByBriefId.get(briefId) ?? 0) + 1;
      if (nextCount > MAX_QUERY_PLANS_PER_BRIEF) {
        return {
          code: 'BRIEF_QUERY_BUDGET_EXCEEDED',
          message: '한 Brief가 허용된 수보다 많은 QueryPlan 호출 예산을 사용했습니다.',
        };
      }
      queryCountByBriefId.set(briefId, nextCount);
    }
  }

  return null;
}
