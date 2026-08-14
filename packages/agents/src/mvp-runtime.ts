import {
  mvpAgentRunRequestSchema,
  mvpAgentRunResultSchema,
  mvpStayArbiterOutputSchema,
  mvpTripSupervisorOutputSchema,
  mvpUserProxyOutputSchema,
  type MvpAgentRunRequest,
  type MvpAgentRunResult,
  type MvpStayArbiterInput,
  type MvpStayArbiterOutput,
  type MvpTripSupervisorInput,
  type MvpTripSupervisorOutput,
  type MvpUserProxyInput,
  type MvpUserProxyOutput,
} from '@tm/contracts';
import { assertMvpAgentContextSafe } from '@tm/core';

export interface MvpAgentRuntime {
  run(request: MvpAgentRunRequest): Promise<MvpAgentRunResult>;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function runUserProxy(input: MvpUserProxyInput): MvpUserProxyOutput {
  const proposalIds = new Set(input.proposals.map((proposal) => proposal.proposalId));
  if (
    input.evaluations.length !== proposalIds.size ||
    input.evaluations.some((evaluation) => !proposalIds.has(evaluation.proposalId))
  ) {
    throw new Error('USER_PROXY evaluation은 proposal 집합과 정확히 일치해야 합니다.');
  }
  const ranked = [...input.evaluations].sort(
    (left, right) =>
      right.satisfactionBp - left.satisfactionBp ||
      left.proposalId.localeCompare(right.proposalId),
  );
  return mvpUserProxyOutputSchema.parse({
    role: 'USER_PROXY',
    ballot: {
      participantId: input.participant.participantId,
      rankedProposalIds: ranked.map((evaluation) => evaluation.proposalId),
      satisfactionByProposalBp: Object.fromEntries(
        ranked.map((evaluation) => [evaluation.proposalId, evaluation.satisfactionBp]),
      ),
      profileFactIds: unique(ranked.flatMap((evaluation) => evaluation.profileFactIds)),
      evidenceIds: unique(ranked.flatMap((evaluation) => evaluation.evidenceIds)),
      rationale: '코드가 계산한 본인 만족도를 높은 순서로 설명했습니다.',
    },
  });
}

function runStayArbiter(input: MvpStayArbiterInput): MvpStayArbiterOutput {
  const selected = input.proposals.find(
    (proposal) => proposal.proposalId === input.deterministicSelection.selectedProposalId,
  );
  if (selected === undefined) {
    return mvpStayArbiterOutputSchema.parse({
      role: 'STAY_ARBITER',
      outcome: 'NO_SAFE_DECISION',
      selectedProposalId: null,
      summary: '결정론 선택이 현재 proposal 집합에 없습니다.',
      unresolvedIssues: ['SELECTED_PROPOSAL_MISSING'],
      evidenceIds: [],
    });
  }
  return mvpStayArbiterOutputSchema.parse({
    role: 'STAY_ARBITER',
    outcome: 'CONCLUDED',
    selectedProposalId: selected.proposalId,
    summary: `${input.deterministicSelection.decidedBy} 결과를 변경 없이 채택했습니다.`,
    unresolvedIssues: [],
    evidenceIds: selected.evidenceIds,
  });
}

function runTripSupervisor(input: MvpTripSupervisorInput): MvpTripSupervisorOutput {
  const failed = input.guardChecks.filter((check) => !check.passed);
  return mvpTripSupervisorOutputSchema.parse({
    role: 'TRIP_SUPERVISOR',
    guardStatus: failed.length === 0 ? 'CLEAR' : 'HOLD',
    observedSelectedProposalId: input.selectedProposal.proposalId,
    findings: failed.map((check) => ({
      code: check.code,
      message: check.message,
      evidenceIds: check.evidenceIds,
    })),
    evidenceIds: unique(input.guardChecks.flatMap((check) => check.evidenceIds)),
  });
}

export class FixtureMvpAgentRuntime implements MvpAgentRuntime {
  async run(rawRequest: MvpAgentRunRequest): Promise<MvpAgentRunResult> {
    const request = mvpAgentRunRequestSchema.parse(rawRequest);
    assertMvpAgentContextSafe(request);
    const output =
      request.role === 'USER_PROXY'
        ? runUserProxy(request)
        : request.role === 'STAY_ARBITER'
          ? runStayArbiter(request)
          : runTripSupervisor(request);
    const result = mvpAgentRunResultSchema.parse(output);
    assertMvpAgentContextSafe(result);
    return result;
  }
}
