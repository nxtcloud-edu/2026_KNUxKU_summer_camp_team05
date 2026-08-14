import { FixtureMvpAgentRuntime, type MvpAgentRuntime } from '@tm/agents';
import {
  mvpStayFixtureInputSchema,
  mvpStayFixtureRunResultSchema,
  type MvpAgentRunResult,
  type MvpProposalEvaluation,
  type MvpProxyBallot,
  type MvpStayFixtureRunResult,
  type MvpUserProxyInput,
} from '@tm/contracts';
import {
  buildMvpGuardChecks,
  evaluateMvpStayProposal,
  planMvpCandidateSearch,
  projectMvpUserProxyProfile,
  selectMvpStayProposal,
} from '@tm/core';

function assertFixtureMetaAligned(
  fixture: ReturnType<typeof mvpStayFixtureInputSchema.parse>,
): void {
  if (
    fixture.search.runId !== fixture.runId ||
    fixture.search.tripId !== fixture.tripId ||
    fixture.search.planVersion !== fixture.planVersion
  ) {
    throw new Error('fixture와 Candidate Search 메타데이터가 일치하지 않습니다.');
  }
  if (new Set(fixture.participantIds).size !== fixture.participantIds.length) {
    throw new Error('participantIds는 중복될 수 없습니다.');
  }
}

function assertBallotMatchesEvaluations(
  output: MvpAgentRunResult,
  input: MvpUserProxyInput,
): MvpProxyBallot {
  if (output.role !== 'USER_PROXY') {
    throw new Error('USER_PROXY 호출이 다른 역할의 결과를 반환했습니다.');
  }
  if (output.ballot.participantId !== input.participant.participantId) {
    throw new Error('USER_PROXY가 다른 참여자의 ballot을 반환했습니다.');
  }
  const expected = new Map(
    input.evaluations.map((evaluation) => [evaluation.proposalId, evaluation.satisfactionBp]),
  );
  const receivedIds = Object.keys(output.ballot.satisfactionByProposalBp);
  if (receivedIds.length !== expected.size) {
    throw new Error('USER_PROXY가 코드 계산 만족도의 proposal 집합을 변경했습니다.');
  }
  for (const [proposalId, satisfactionBp] of expected) {
    if (output.ballot.satisfactionByProposalBp[proposalId] !== satisfactionBp) {
      throw new Error('USER_PROXY가 코드 계산 만족도를 변경했습니다.');
    }
  }
  return output.ballot;
}

function evaluationsFor(
  profile: MvpUserProxyInput['participant'],
  proposals: MvpUserProxyInput['proposals'],
): MvpProposalEvaluation[] {
  return proposals.map((proposal) => evaluateMvpStayProposal(profile, proposal));
}

export async function runMvpStayFixture(
  rawFixture: unknown,
  runtime: MvpAgentRuntime = new FixtureMvpAgentRuntime(),
): Promise<MvpStayFixtureRunResult> {
  const fixture = mvpStayFixtureInputSchema.parse(rawFixture);
  assertFixtureMetaAligned(fixture);
  const search = planMvpCandidateSearch(fixture.search);
  if (search.status === 'NO_SAFE_QUERY') {
    return mvpStayFixtureRunResultSchema.parse({
      status: 'NO_SAFE_QUERY',
      runId: fixture.runId,
      tripId: fixture.tripId,
      search,
      roleTrace: [],
      ballots: [],
      selection: null,
      arbiter: null,
      guardChecks: [],
      supervisor: null,
    });
  }

  const profiles = fixture.participantIds.map((participantId) =>
    projectMvpUserProxyProfile(fixture.profileSource, participantId),
  );
  const protectedIds = new Set(
    profiles.flatMap((profile) => [
      ...profile.hardConstraints.map((constraint) => constraint.constraintId),
      ...profile.protectedObjectives.map((objective) => objective.constraintId),
    ]),
  );
  const eligibleProposals = fixture.candidates.filter((proposal) =>
    proposal.violatedConstraintIds.every((id) => !protectedIds.has(id)),
  );
  if (eligibleProposals.length === 0) {
    return mvpStayFixtureRunResultSchema.parse({
      status: 'BLOCKED',
      runId: fixture.runId,
      tripId: fixture.tripId,
      search,
      roleTrace: [],
      ballots: [],
      selection: null,
      arbiter: null,
      guardChecks: [],
      supervisor: null,
    });
  }

  const userProxyInputs: MvpUserProxyInput[] = profiles.map((profile) => ({
    role: 'USER_PROXY',
    runId: fixture.runId,
    tripId: fixture.tripId,
    planVersion: fixture.planVersion,
    participant: profile,
    proposals: eligibleProposals,
    evaluations: evaluationsFor(profile, eligibleProposals),
    evidence: fixture.evidence,
  }));
  const userProxyOutputs = await Promise.all(userProxyInputs.map((input) => runtime.run(input)));
  const ballots = userProxyOutputs.map((output, index) => {
    const input = userProxyInputs[index];
    if (input === undefined) throw new Error('USER_PROXY 입력과 출력 개수가 다릅니다.');
    return assertBallotMatchesEvaluations(output, input);
  });

  const selection = selectMvpStayProposal(
    ballots,
    eligibleProposals.map((proposal) => proposal.proposalId),
  );
  const arbiterResult = await runtime.run({
    role: 'STAY_ARBITER',
    runId: fixture.runId,
    tripId: fixture.tripId,
    planVersion: fixture.planVersion,
    proposals: eligibleProposals,
    ballots,
    deterministicSelection: selection,
    evidence: fixture.evidence,
  });
  if (arbiterResult.role !== 'STAY_ARBITER') {
    throw new Error('STAY_ARBITER 호출이 다른 역할의 결과를 반환했습니다.');
  }
  const selectedProposal = eligibleProposals.find(
    (proposal) => proposal.proposalId === selection.selectedProposalId,
  );
  if (selectedProposal === undefined) {
    throw new Error('결정론 선택 결과가 eligible proposal 집합에 없습니다.');
  }
  const guardChecks = buildMvpGuardChecks({
    arbiterSelectedProposalId: arbiterResult.selectedProposalId,
    deterministicSelection: selection,
    selectedProposal,
    profiles,
    participantCount: profiles.length,
    evidence: fixture.evidence,
  });
  const supervisorResult = await runtime.run({
    role: 'TRIP_SUPERVISOR',
    runId: fixture.runId,
    tripId: fixture.tripId,
    planVersion: fixture.planVersion,
    selectedProposal,
    participantCount: profiles.length,
    guardChecks,
    evidence: fixture.evidence,
  });
  if (supervisorResult.role !== 'TRIP_SUPERVISOR') {
    throw new Error('TRIP_SUPERVISOR 호출이 다른 역할의 결과를 반환했습니다.');
  }
  const mechanicallyClear = guardChecks.every((check) => check.passed);
  const expectedSupervisorStatus = mechanicallyClear ? 'CLEAR' : 'HOLD';
  if (
    supervisorResult.observedSelectedProposalId !== selection.selectedProposalId ||
    supervisorResult.guardStatus !== expectedSupervisorStatus
  ) {
    throw new Error('TRIP_SUPERVISOR 결과가 코드의 guard 판정과 일치하지 않습니다.');
  }

  return mvpStayFixtureRunResultSchema.parse({
    status: mechanicallyClear ? 'FIXTURE_PATH_CLEAR' : 'BLOCKED',
    runId: fixture.runId,
    tripId: fixture.tripId,
    search,
    roleTrace: [
      ...profiles.map(() => 'USER_PROXY' as const),
      'STAY_ARBITER',
      'TRIP_SUPERVISOR',
    ],
    ballots,
    selection,
    arbiter: arbiterResult,
    guardChecks,
    supervisor: supervisorResult,
  });
}
