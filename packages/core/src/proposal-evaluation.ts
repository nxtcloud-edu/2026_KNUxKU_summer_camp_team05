import {
  proposalEvaluationSchema,
  type CategoryProposalSet,
  type ProposalEvaluation,
  type UserProxyProfileView,
} from '@tm/contracts';

function clamp(value: number): number {
  return Math.max(0, Math.min(10_000, Math.round(value)));
}

export function evaluateStayProposalSetForProfile(
  profile: UserProxyProfileView,
  proposalSet: CategoryProposalSet,
): ProposalEvaluation[] {
  return proposalSet.proposals.map((proposal) => {
    const cost = proposal.costByParticipantKrw[profile.participantId] ?? proposal.totalCostKrw;
    const budget = profile.budgetMaxKrw;
    const budgetFit = budget <= 0 ? 0 : Math.max(0, (budget - cost) / budget);
    const travelPenalty = Math.min(2_000, proposal.travelBurdenMinutes * 20);
    const satisfactionBp = clamp(
      3_000 + budgetFit * 3_000 + proposal.evidenceQualityBp * 0.3
        + proposal.cancellationScoreBp * 0.1 - travelPenalty,
    );
    return proposalEvaluationSchema.parse({
      proposalId: proposal.proposalId,
      satisfactionBp,
      stance: satisfactionBp >= 6_000 ? 'support' : satisfactionBp >= 4_000 ? 'conditional' : 'oppose',
      profileFactRefs: profile.facts.map((fact) => fact.factId),
      evidenceIds: proposal.evidenceIds,
      conditionalTerms: satisfactionBp >= 6_000 ? [] : ['최종 가격과 재고 재확인'],
    });
  });
}
