import { FixtureAgentRuntime, type AgentRuntime } from '@tm/agents';
import {
  type AgentRole,
  type CategoryProposal,
  type CategoryProposalSet,
  type EvidenceSnapshot,
  type FinalPlanRecord,
  type ProxyBallot,
  type ProxySearchBrief,
  type NeutralSearchBrief,
  type TripCharter,
  type TripOrchestratorReport,
  type UserProxyProfileView,
  type VerificationReceipt,
  type CategoryDecisionContract,
  type DeterministicSelection,
  type CandidateEvidenceQueryPlan,
} from '@tm/contracts';
import { selectCategoryProposalLeximin } from '@tm/core';
import type {
  CandidateEvidenceExecutionPort,
  CandidateEvidenceExecutionResult,
} from '@tm/data-agents';

const participantIds = ['u1', 'u2', 'u3'] as const;

const charter: TripCharter = {
  schemaVersion: 1,
  charterVersion: 'charter:osaka:1',
  destination: '오사카',
  startDate: '2026-10-16',
  endDate: '2026-10-19',
  participantIds: [...participantIds],
  partySize: 3,
  pace: 'balanced',
  budgetMaxByParticipantKrw: { u1: 300_000, u2: 400_000, u3: 500_000 },
};

const profiles: UserProxyProfileView[] = [
  {
    participantId: 'u1',
    profileVersion: 'profile:u1:1',
    facts: [
      { factId: 'fact:u1:namba', statement: '난바 이동 편의', importance: 5, hard: false, polarity: 'PREFER' },
      { factId: 'fact:u1:no-dorm', statement: '도미토리 제외', importance: 5, hard: true, polarity: 'AVOID' },
    ],
    budgetMaxKrw: 300_000,
  },
  {
    participantId: 'u2',
    profileVersion: 'profile:u2:1',
    facts: [
      { factId: 'fact:u2:quiet', statement: '조용하고 넓은 객실', importance: 5, hard: false, polarity: 'PREFER' },
      { factId: 'fact:u2:private-bath', statement: '전용 욕실', importance: 5, hard: true, polarity: 'REQUIRE' },
    ],
    budgetMaxKrw: 400_000,
  },
  {
    participantId: 'u3',
    profileVersion: 'profile:u3:1',
    facts: [
      { factId: 'fact:u3:bath', statement: '대욕장과 조식', importance: 5, hard: false, polarity: 'PREFER' },
      { factId: 'fact:u3:capacity', statement: '3인 전원 수용', importance: 5, hard: true, polarity: 'REQUIRE' },
    ],
    budgetMaxKrw: 500_000,
  },
];

function proposal(
  proposalId: string,
  summary: string,
  totalCostKrw: number,
  travelBurdenMinutes: number,
): CategoryProposal {
  return {
    schemaVersion: 1,
    proposalId,
    category: 'stay',
    proposalSetVersion: 1,
    summary,
    candidateIds: [`candidate:${proposalId}`],
    costByParticipantKrw: Object.fromEntries(
      participantIds.map((participantId) => [participantId, Math.round(totalCostKrw / 3)]),
    ),
    capacityPlan: {
      requestedPartySize: 3,
      confirmedCapacity: 3,
      allocations: [
        {
          resourceUnitId: `room:${proposalId}`,
          confirmedCapacity: 3,
          assignedParticipantIds: [...participantIds],
        },
      ],
      unassignedParticipantIds: [],
      evidenceIds: [`evidence:${proposalId}`],
      splitAuthorityRef: null,
    },
    violatedConstraintIds: [],
    evidenceIds: [`evidence:${proposalId}`],
    attributesBp: {},
    concessionByParticipantBp: { u1: 1_000, u2: 1_000, u3: 1_000 },
    totalCostKrw,
    travelBurdenMinutes,
    cancellationScoreBp: 7_000,
    evidenceQualityBp: 4_000,
  };
}

const proposalSet: CategoryProposalSet = {
  schemaVersion: 1,
  proposalSetId: 'proposal-set:stay:1',
  category: 'stay',
  proposalSetVersion: 1,
  candidatePoolVersion: 1,
  proposals: [
    proposal('stay:a', '난바 중심 숙소', 270_000, 20),
    proposal('stay:b', '중간 위치 절충 숙소', 300_000, 25),
    proposal('stay:c', '대욕장 숙소', 360_000, 35),
  ],
  sealedAt: '2026-08-14T00:00:00.000Z',
};

const evidence: EvidenceSnapshot[] = proposalSet.proposals.map((item) => ({
  schemaVersion: 1,
  evidenceId: item.evidenceIds[0] ?? `evidence:${item.proposalId}`,
  queryPlanId: `fixture-query:${item.proposalId}`,
  providerId: 'fixture',
  providerCandidateId: item.candidateIds[0] ?? null,
  sourceUrl: null,
  retrievedAt: '2026-08-14T00:00:00.000Z',
  validUntil: null,
  confidence: 'estimated',
  status: 'UNKNOWN',
  termsRef: 'fixture-only',
  fieldStates: { capacity: 'UNKNOWN', price: 'UNKNOWN' },
}));

const satisfaction: Record<string, Record<string, number>> = {
  u1: { 'stay:a': 9_000, 'stay:b': 7_000, 'stay:c': 6_000 },
  u2: { 'stay:a': 5_000, 'stay:b': 9_000, 'stay:c': 7_000 },
  u3: { 'stay:a': 6_000, 'stay:b': 7_000, 'stay:c': 9_000 },
};

function receipts(): VerificationReceipt[] {
  return proposalSet.proposals.map((item) => ({
    schemaVersion: 1,
    receiptId: `receipt:${item.proposalId}:fixture`,
    proposalId: item.proposalId,
    ruleId: 'stay.fixture-evidence',
    status: 'UNKNOWN',
    evidenceIds: item.evidenceIds,
    explanation: '계약 fixture이며 실제 Provider 검증 영수증이 아닙니다.',
  }));
}

export interface CanonicalFixtureRunResult {
  status: 'FIXTURE_CONTRACT_CLEAR';
  roleTrace: AgentRole[];
  searchBriefs: ProxySearchBrief[];
  queryPlans: CandidateEvidenceQueryPlan[];
  providerExecution: CandidateEvidenceExecutionResult | null;
  ballots: ProxyBallot[];
  selection: DeterministicSelection;
  categoryContract: CategoryDecisionContract;
  orchestratorReport: TripOrchestratorReport;
  finalPlan: FinalPlanRecord;
}

export async function runCanonicalStayContractFixture(
  runtime: AgentRuntime = new FixtureAgentRuntime(),
  candidateExecutionPort?: CandidateEvidenceExecutionPort,
): Promise<CanonicalFixtureRunResult> {
  const roleTrace: AgentRole[] = [];
  const searchBriefs: ProxySearchBrief[] = [];
  for (const profile of profiles) {
    const result = await runtime.run({
      schemaVersion: 1,
      role: 'USER_PROXY',
      task: 'CREATE_SEARCH_BRIEF',
      runId: 'run:canonical-fixture:1',
      tripId: 'trip:osaka:fixture',
      inputVersion: 1,
      category: 'stay',
      participant: profile,
      charter,
      priorContractRefs: [],
    });
    roleTrace.push(result.role);
    if (result.role !== 'USER_PROXY' || result.task !== 'CREATE_SEARCH_BRIEF') {
      throw new Error('UserProxy SearchBrief 결과가 아닙니다.');
    }
    searchBriefs.push(result.brief);
  }

  const neutralBrief: NeutralSearchBrief = {
    schemaVersion: 1,
    briefId: 'brief:neutral:stay:1',
    category: 'stay',
    charterVersion: charter.charterVersion,
    hardConstraintRefs: ['charter:party-size', 'charter:budget'],
    searchTerms: ['오사카 3인 숙소 가격 위치 절충'],
  };
  const candidateEvidence = await runtime.run({
    schemaVersion: 1,
    role: 'CANDIDATE_EVIDENCE',
    runId: 'run:canonical-fixture:1',
    tripId: 'trip:osaka:fixture',
    inputVersion: 1,
    category: 'stay',
    briefs: searchBriefs,
    neutralBrief,
    availableProviderIds: ['rakuten_travel'],
    searchAttempt: 0,
    currentCandidateIds: [],
  });
  roleTrace.push(candidateEvidence.role);
  if (candidateEvidence.role !== 'CANDIDATE_EVIDENCE') {
    throw new Error('CandidateEvidence 결과가 아닙니다.');
  }
  const providerExecution = candidateExecutionPort === undefined
    ? null
    : await candidateExecutionPort.execute({
        runId: 'run:canonical-fixture:1',
        tripId: 'trip:osaka:fixture',
        inputVersion: 1,
        searchAttempt: 0,
        packId: 'jp-osaka',
        category: 'stay',
        charter,
        queryPlans: candidateEvidence.queryPlans,
        expectedBriefIds: [
          ...searchBriefs.map((brief) => brief.briefId),
          neutralBrief.briefId,
        ],
        queryBudget: 4,
        area: '난바',
        center: { lat: 34.6659, lng: 135.5017 },
        roomCount: 1,
        limit: 5,
        searchRadiusKm: 2,
      });

  const ballots: ProxyBallot[] = [];
  for (const profile of profiles) {
    const scores = satisfaction[profile.participantId];
    if (scores === undefined) throw new Error('참가자 만족도 fixture가 없습니다.');
    const result = await runtime.run({
      schemaVersion: 1,
      role: 'USER_PROXY',
      task: 'CREATE_BALLOT',
      runId: 'run:canonical-fixture:1',
      tripId: 'trip:osaka:fixture',
      inputVersion: 1,
      category: 'stay',
      participant: profile,
      proposalSet,
      evaluations: proposalSet.proposals.map((item) => ({
        proposalId: item.proposalId,
        satisfactionBp: scores[item.proposalId] ?? 0,
        stance: (scores[item.proposalId] ?? 0) >= 7_000 ? 'support' : 'conditional',
        profileFactRefs: profile.facts.map((fact) => fact.factId),
        evidenceIds: item.evidenceIds,
        conditionalTerms: [],
      })),
      evidence,
    });
    roleTrace.push(result.role);
    if (result.role !== 'USER_PROXY' || result.task !== 'CREATE_BALLOT') {
      throw new Error('UserProxy Ballot 결과가 아닙니다.');
    }
    ballots.push(result.ballot);
  }

  const selection = selectCategoryProposalLeximin(ballots, proposalSet);
  const arbiter = await runtime.run({
    schemaVersion: 1,
    role: 'CATEGORY_ARBITER',
    runId: 'run:canonical-fixture:1',
    tripId: 'trip:osaka:fixture',
    inputVersion: 1,
    category: 'stay',
    charter,
    proposalSet,
    ballots,
    deterministicSelection: selection,
    receipts: receipts(),
    priorObligations: [],
  });
  roleTrace.push(arbiter.role);
  if (arbiter.role !== 'CATEGORY_ARBITER') throw new Error('CategoryArbiter 결과가 아닙니다.');

  const orchestrator = await runtime.run({
    schemaVersion: 1,
    role: 'TRIP_ORCHESTRATOR',
    runId: 'run:canonical-fixture:1',
    tripId: 'trip:osaka:fixture',
    inputVersion: 1,
    charter,
    categoryContracts: [arbiter.contract],
    guardChecks: [
      {
        code: 'ARBITER_SELECTION_ALIGNED',
        passed: arbiter.contract.selectedProposalId === selection.selectedProposalId,
        message: 'CategoryArbiter는 결정론 선택을 변경할 수 없습니다.',
        refs: [selection.selectedProposalId],
      },
      {
        code: 'BALLOT_VERSION_ALIGNED',
        passed: ballots.every(
          (ballot) => ballot.proposalSetVersion === proposalSet.proposalSetVersion,
        ),
        message: '모든 Ballot은 같은 ProposalSet 버전을 사용해야 합니다.',
        refs: ballots.map((ballot) => ballot.ballotId),
      },
    ],
    evidence,
  });
  roleTrace.push(orchestrator.role);
  if (orchestrator.role !== 'TRIP_ORCHESTRATOR') {
    throw new Error('TripOrchestrator 결과가 아닙니다.');
  }

  const finalizer = await runtime.run({
    schemaVersion: 1,
    role: 'PLAN_FINALIZER',
    runId: 'run:canonical-fixture:1',
    tripId: 'trip:osaka:fixture',
    inputVersion: 1,
    charter,
    categoryContracts: [arbiter.contract],
    orchestratorReport: orchestrator.report,
    evidenceMode: 'FIXTURE',
    evidence,
  });
  roleTrace.push(finalizer.role);
  if (finalizer.role !== 'PLAN_FINALIZER') throw new Error('PlanFinalizer 결과가 아닙니다.');

  return {
    status: 'FIXTURE_CONTRACT_CLEAR',
    roleTrace,
    searchBriefs,
    queryPlans: candidateEvidence.queryPlans,
    providerExecution,
    ballots,
    selection,
    categoryContract: arbiter.contract,
    orchestratorReport: orchestrator.report,
    finalPlan: finalizer.finalPlan,
  };
}
