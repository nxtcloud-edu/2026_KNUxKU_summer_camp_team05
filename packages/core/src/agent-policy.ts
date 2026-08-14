import {
  categoryProposalSetSchema,
  deterministicSelectionSchema,
  proxyBallotSchema,
  type CategoryProposal,
  type CategoryProposalSet,
  type DeterministicSelection,
  type ProxyBallot,
} from '@tm/contracts';
import { assertMvpAgentContextSafe } from './mvp-agent-policy.js';

export function assertAgentContextSafe(value: unknown): void {
  assertMvpAgentContextSafe(value);
}

interface ProposalScore {
  proposal: CategoryProposal;
  satisfactionVector: number[];
  totalSatisfaction: number;
  concessionImbalance: number;
}

function compareLeximin(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? -1;
    const rightValue = right[index] ?? -1;
    if (leftValue !== rightValue) return rightValue - leftValue;
  }
  return 0;
}

function concessionImbalance(
  proposal: CategoryProposal,
  participantIds: readonly string[],
): number {
  const values = participantIds.map((participantId) => {
    const value = proposal.concessionByParticipantBp[participantId];
    if (value === undefined) {
      throw new Error(`${proposal.proposalId}에 ${participantId} 양보 부담이 없습니다.`);
    }
    return value;
  });
  return Math.max(...values) - Math.min(...values);
}

function compareScores(left: ProposalScore, right: ProposalScore): number {
  const leximin = compareLeximin(left.satisfactionVector, right.satisfactionVector);
  if (leximin !== 0) return leximin;
  if (left.totalSatisfaction !== right.totalSatisfaction) {
    return right.totalSatisfaction - left.totalSatisfaction;
  }
  if (left.concessionImbalance !== right.concessionImbalance) {
    return left.concessionImbalance - right.concessionImbalance;
  }
  if (left.proposal.totalCostKrw !== right.proposal.totalCostKrw) {
    return left.proposal.totalCostKrw - right.proposal.totalCostKrw;
  }
  if (left.proposal.travelBurdenMinutes !== right.proposal.travelBurdenMinutes) {
    return left.proposal.travelBurdenMinutes - right.proposal.travelBurdenMinutes;
  }
  if (left.proposal.cancellationScoreBp !== right.proposal.cancellationScoreBp) {
    return right.proposal.cancellationScoreBp - left.proposal.cancellationScoreBp;
  }
  if (left.proposal.evidenceQualityBp !== right.proposal.evidenceQualityBp) {
    return right.proposal.evidenceQualityBp - left.proposal.evidenceQualityBp;
  }
  return left.proposal.proposalId.localeCompare(right.proposal.proposalId);
}

function decidedBy(winner: ProposalScore, runnerUp: ProposalScore | undefined): DeterministicSelection['decidedBy'] {
  if (runnerUp === undefined) return 'LEXIMIN';
  if (compareLeximin(winner.satisfactionVector, runnerUp.satisfactionVector) !== 0) return 'LEXIMIN';
  if (winner.totalSatisfaction !== runnerUp.totalSatisfaction) return 'AVERAGE';
  if (winner.concessionImbalance !== runnerUp.concessionImbalance) return 'CONCESSION_IMBALANCE';
  if (winner.proposal.totalCostKrw !== runnerUp.proposal.totalCostKrw) return 'TOTAL_COST';
  if (winner.proposal.travelBurdenMinutes !== runnerUp.proposal.travelBurdenMinutes) {
    return 'TRAVEL_BURDEN';
  }
  if (winner.proposal.cancellationScoreBp !== runnerUp.proposal.cancellationScoreBp) {
    return 'CANCELLATION';
  }
  if (winner.proposal.evidenceQualityBp !== runnerUp.proposal.evidenceQualityBp) {
    return 'EVIDENCE_QUALITY';
  }
  return 'PROPOSAL_ID';
}

export function selectCategoryProposalLeximin(
  rawBallots: readonly ProxyBallot[],
  rawProposalSet: CategoryProposalSet,
): DeterministicSelection {
  const proposalSet = categoryProposalSetSchema.parse(rawProposalSet);
  const ballots = rawBallots.map((ballot) => proxyBallotSchema.parse(ballot));
  if (ballots.length === 0) throw new Error('leximin 선택에는 ProxyBallot이 필요합니다.');

  const participantIds = ballots.map((ballot) => ballot.participantId);
  if (new Set(participantIds).size !== participantIds.length) {
    throw new Error('참가자는 proposalSetVersion마다 한 표만 제출할 수 있습니다.');
  }
  const proposalIds = proposalSet.proposals.map((proposal) => proposal.proposalId).sort();
  for (const ballot of ballots) {
    if (
      ballot.category !== proposalSet.category ||
      ballot.proposalSetVersion !== proposalSet.proposalSetVersion
    ) {
      throw new Error('Ballot의 category 또는 proposalSetVersion이 활성 ProposalSet과 다릅니다.');
    }
    if (JSON.stringify([...ballot.rankedProposalIds].sort()) !== JSON.stringify(proposalIds)) {
      throw new Error('모든 Proxy는 동일 Proposal 전체를 평가해야 합니다.');
    }
  }

  const scores: ProposalScore[] = proposalSet.proposals.map((proposal) => {
    const satisfactionVector = ballots
      .map((ballot) => {
        const score = ballot.satisfactionByProposalBp[proposal.proposalId];
        if (score === undefined) {
          throw new Error(`${ballot.participantId} Ballot에 ${proposal.proposalId} 만족도가 없습니다.`);
        }
        return score;
      })
      .sort((left, right) => left - right);
    return {
      proposal,
      satisfactionVector,
      totalSatisfaction: satisfactionVector.reduce((sum, value) => sum + value, 0),
      concessionImbalance: concessionImbalance(proposal, participantIds),
    };
  });
  scores.sort(compareScores);
  const winner = scores[0];
  if (winner === undefined) throw new Error('선택 가능한 CategoryProposal이 없습니다.');
  const runnerUp = scores[1];
  const tieBreak = decidedBy(winner, runnerUp);

  return deterministicSelectionSchema.parse({
    schemaVersion: 1,
    selectedProposalId: winner.proposal.proposalId,
    rankedProposalIds: scores.map((score) => score.proposal.proposalId),
    satisfactionVectorByProposal: Object.fromEntries(
      scores.map((score) => [score.proposal.proposalId, score.satisfactionVector]),
    ),
    decidedBy: tieBreak,
    trace: [
      `proposalSetVersion=${proposalSet.proposalSetVersion}`,
      `leximin=${winner.satisfactionVector.join(',')}`,
      `decidedBy=${tieBreak}`,
    ],
  });
}
