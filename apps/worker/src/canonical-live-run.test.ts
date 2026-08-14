import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FixtureAgentRuntime, type AgentRuntime } from '@tm/agents';
import type {
  AgentRunRequest,
  AgentRunResult,
  CandidatePoolVersion,
  CandidateRecord,
  CategoryProposal,
  CategoryProposalSet,
  EvidenceSnapshot,
  ProposalEvaluation,
  UserProxyProfileView,
  VerificationReceipt,
} from '@tm/contracts';
import {
  runCanonicalLive,
  type CanonicalLiveRunDependencies,
  type CanonicalLiveRunInput,
  type CanonicalLiveRunResult,
  type CanonicalPersistedRun,
  type CanonicalRunPersistencePort,
} from './canonical-live-run.js';
import { createCanonicalRunPersistence } from './canonical-run-recorder.js';
import { createMemoryRepositories } from '@tm/db';

const profiles: UserProxyProfileView[] = [
  {
    participantId: 'u1',
    profileVersion: 'profile:u1:1',
    facts: [
      { factId: 'fact:u1:quiet', statement: 'quiet room', importance: 5, hard: false, polarity: 'PREFER' },
    ],
    budgetMaxKrw: 300_000,
  },
  {
    participantId: 'u2',
    profileVersion: 'profile:u2:1',
    facts: [
      { factId: 'fact:u2:bath', statement: 'private bath', importance: 5, hard: true, polarity: 'REQUIRE' },
    ],
    budgetMaxKrw: 400_000,
  },
];

const input: CanonicalLiveRunInput = {
  runId: 'run:canonical-live:1',
  inputVersion: 1,
  room: {
    roomId: 'room:1',
    tripId: 'trip:1',
    packId: 'jp-osaka',
    destination: 'Osaka',
    pace: 'balanced',
    category: 'stay',
  },
  profiles,
  dateResolverInput: {
    participants: [],
    pack: { recommendedNights: 2 },
    today: '2026-08-14',
  },
};

const evidence: EvidenceSnapshot[] = [
  {
    schemaVersion: 1,
    evidenceId: 'evidence:stay:a',
    queryPlanId: 'query:1',
    providerId: 'rakuten_travel',
    providerCandidateId: 'provider:a',
    sourceUrl: 'https://example.com/stay/a',
    retrievedAt: '2026-08-14T00:00:00.000Z',
    validUntil: null,
    confidence: 'estimated',
    status: 'UNKNOWN',
    termsRef: 'provider-terms',
    fieldStates: { price: 'UNKNOWN', capacity: 'UNKNOWN' },
  },
];

const candidates: CandidateRecord[] = [
  {
    schemaVersion: 1,
    candidateId: 'candidate:stay:a',
    category: 'stay',
    sourceBriefIds: ['brief:u1:stay:1', 'brief:u2:stay:1', 'brief:neutral:stay:1'],
    providerId: 'rakuten_travel',
    providerCandidateId: 'provider:a',
    title: 'Stay A',
    sourceMode: 'estimated',
    poolEligibility: 'UNVERIFIED',
    exclusionReasons: [],
    evidenceIds: ['evidence:stay:a'],
    payload: {},
  },
];

const candidatePool: CandidatePoolVersion = {
  schemaVersion: 1,
  poolId: 'pool:stay:1',
  category: 'stay',
  version: 1,
  candidateIds: ['candidate:stay:a'],
  representativeCandidateByParticipantId: {
    u1: 'candidate:stay:a',
    u2: 'candidate:stay:a',
  },
  neutralCandidateIds: ['candidate:stay:a'],
  excludedCandidates: [],
  createdAt: '2026-08-14T00:00:00.000Z',
};

function proposal(
  proposalId: string,
  totalCostKrw: number,
  travelBurdenMinutes: number,
): CategoryProposal {
  return {
    schemaVersion: 1,
    proposalId,
    category: 'stay',
    proposalSetVersion: 1,
    summary: proposalId,
    candidateIds: ['candidate:stay:a'],
    costByParticipantKrw: { u1: totalCostKrw / 2, u2: totalCostKrw / 2 },
    capacityPlan: {
      requestedPartySize: 2,
      confirmedCapacity: 2,
      allocations: [
        {
          resourceUnitId: `room:${proposalId}`,
          confirmedCapacity: 2,
          assignedParticipantIds: ['u1', 'u2'],
        },
      ],
      unassignedParticipantIds: [],
      evidenceIds: ['evidence:stay:a'],
      splitAuthorityRef: null,
    },
    violatedConstraintIds: [],
    evidenceIds: ['evidence:stay:a'],
    attributesBp: {},
    concessionByParticipantBp: { u1: 1_000, u2: 1_000 },
    totalCostKrw,
    travelBurdenMinutes,
    cancellationScoreBp: 8_000,
    evidenceQualityBp: 4_000,
  };
}

const proposalSet: CategoryProposalSet = {
  schemaVersion: 1,
  proposalSetId: 'proposal-set:stay:1',
  category: 'stay',
  proposalSetVersion: 1,
  candidatePoolVersion: 1,
  proposals: [proposal('proposal:a', 200_000, 20), proposal('proposal:b', 250_000, 15)],
  sealedAt: '2026-08-14T00:00:00.000Z',
};

const receipts: VerificationReceipt[] = proposalSet.proposals.map((item) => ({
  schemaVersion: 1,
  receiptId: `receipt:${item.proposalId}`,
  proposalId: item.proposalId,
  ruleId: 'stay.capacity',
  status: 'UNKNOWN',
  evidenceIds: item.evidenceIds,
  explanation: 'Provider evidence is not live-verified.',
}));

function evaluations(participantId: string): ProposalEvaluation[] {
  return proposalSet.proposals.map((item, index) => ({
    proposalId: item.proposalId,
    satisfactionBp: participantId === 'u1' ? 8_000 - index * 1_000 : 7_000 + index * 1_000,
    stance: 'support',
    profileFactRefs: profiles.find((profile) => profile.participantId === participantId)?.facts.map(
      (fact) => fact.factId,
    ) ?? [],
    evidenceIds: item.evidenceIds,
    conditionalTerms: [],
  }));
}

class MemoryPersistence implements CanonicalRunPersistencePort {
  record: CanonicalPersistedRun | null = null;
  readonly states: string[] = [];

  async load(runId: string): Promise<CanonicalPersistedRun | null> {
    return this.record?.runId === runId ? this.record : null;
  }

  async markQueued(runInput: CanonicalLiveRunInput): Promise<void> {
    this.states.push('QUEUED');
    this.record = { runId: runInput.runId, executionStatus: 'QUEUED', result: null };
  }

  async markRunning(runId: string): Promise<void> {
    this.states.push('RUNNING');
    this.record = { runId, executionStatus: 'RUNNING', result: null };
  }

  async complete(result: CanonicalLiveRunResult): Promise<void> {
    this.states.push('COMPLETED');
    this.record = { runId: result.runId, executionStatus: 'COMPLETED', result };
  }

  async fail(result: CanonicalLiveRunResult): Promise<void> {
    this.states.push('FAILED');
    this.record = { runId: result.runId, executionStatus: 'FAILED', result };
  }
}

function dependencies(
  overrides: Partial<CanonicalLiveRunDependencies> = {},
): CanonicalLiveRunDependencies & { persistence: MemoryPersistence } {
  const persistence = overrides.persistence instanceof MemoryPersistence
    ? overrides.persistence
    : new MemoryPersistence();
  return {
    agentRuntime: new FixtureAgentRuntime(),
    dateResolver: {
      resolve: () => ({
        status: 'confirmed',
        windows: [],
        chosen: {
          start: '2026-10-16',
          end: '2026-10-18',
          nights: 2,
          attendees: ['u1', 'u2'],
          absentees: [],
          score: 1,
          breakdown: {},
        },
        relaxation: 'none',
        nights: 2,
        reason: 'fixture date',
      }),
    },
    structuredSearch: {
      async build() {
        return {
          neutralBrief: {
            schemaVersion: 1,
            briefId: 'brief:neutral:stay:1',
            category: 'stay',
            charterVersion: 'charter:trip:1:1',
            hardConstraintRefs: ['charter:party-size'],
            searchTerms: ['Osaka stay'],
          },
          availableProviderIds: ['rakuten_travel'],
          providerExecution: {
            packId: 'jp-osaka',
            area: 'Namba',
            center: { lat: 34.6659, lng: 135.5017 },
            roomCount: 1,
            limit: 5,
            searchRadiusKm: 2,
            queryBudget: 4,
          },
        };
      },
    },
    candidateEvidence: {
      async execute() {
        return { status: 'SUCCEEDED', candidates, evidence, failures: [] };
      },
    },
    candidateValidator: {
      async validate() {
        return {
          status: 'READY',
          candidatePool,
          candidates,
          evidence,
          receipts,
          reason: null,
        };
      },
    },
    proposalSet: {
      async create() {
        return {
          proposalSet,
          evaluationsByParticipantId: {
            u1: evaluations('u1'),
            u2: evaluations('u2'),
          },
        };
      },
    },
    persistence,
    ...overrides,
  } as CanonicalLiveRunDependencies & { persistence: MemoryPersistence };
}

test('canonical dependency fakes execute the complete composition in order', async () => {
  const deps = dependencies();
  const result = await runCanonicalLive(deps, input);

  assert.equal(result.executionStatus, 'COMPLETED');
  assert.equal(result.resultStatus, 'PROVISIONAL');
  assert.equal(result.finalPlan?.evidenceMode, 'MIXED');
  assert.equal(result.artifacts?.selection.selectedProposalId, 'proposal:a');
  assert.deepEqual(deps.persistence.states, ['QUEUED', 'RUNNING', 'COMPLETED']);
  assert.deepEqual(result.trace, [
    'DATE_RESOLVER',
    'TRIP_CHARTER',
    'USER_PROXY_SEARCH_BRIEFS',
    'STRUCTURED_SEARCH_CONTEXT',
    'CANDIDATE_EVIDENCE_QUERY_PLAN',
    'PROVIDER_EXECUTION',
    'FACT_CONSTRAINT_VALIDATION',
    'CANDIDATE_POOL_VERSION',
    'CATEGORY_PROPOSAL_SET',
    'USER_PROXY_BALLOTS',
    'DETERMINISTIC_LEXIMIN',
    'CATEGORY_ARBITER',
    'TRIP_ORCHESTRATOR',
    'PLAN_FINALIZER',
    'DB_PERSISTENCE',
  ]);
});

test('provider failure completes with a BLOCKED result ceiling', async () => {
  const deps = dependencies({
    candidateEvidence: {
      async execute() {
        return {
          status: 'FAILED',
          candidates: [],
          evidence: [],
          failures: [{ code: 'PROVIDER_UNAVAILABLE', message: 'provider unavailable' }],
        };
      },
    },
  });
  const result = await runCanonicalLive(deps, input);
  assert.equal(result.executionStatus, 'COMPLETED');
  assert.equal(result.resultStatus, 'BLOCKED');
  assert.equal(result.failure?.code, 'PROVIDER_UNAVAILABLE');
  assert.equal(result.trace.includes('FACT_CONSTRAINT_VALIDATION'), false);
});

test('FactConstraintValidator BLOCKED result stops before proposal creation', async () => {
  let proposalCalls = 0;
  const deps = dependencies({
    candidateValidator: {
      async validate() {
        return {
          status: 'BLOCKED',
          candidatePool: null,
          candidates: [],
          evidence,
          receipts: [],
          reason: 'capacity constraint failed',
        };
      },
    },
    proposalSet: {
      async create() {
        proposalCalls += 1;
        throw new Error('must not run');
      },
    },
  });
  const result = await runCanonicalLive(deps, input);
  assert.equal(result.resultStatus, 'BLOCKED');
  assert.equal(result.failure?.code, 'FACT_CONSTRAINT_BLOCKED');
  assert.equal(proposalCalls, 0);
});

class NeedsChoiceRuntime implements AgentRuntime {
  private readonly fixture = new FixtureAgentRuntime();

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const result = await this.fixture.run(request);
    if (request.role === 'TRIP_ORCHESTRATOR' && result.role === 'TRIP_ORCHESTRATOR') {
      return {
        ...result,
        report: {
          ...result.report,
          guardStatus: 'RECHECK',
          recheckTargets: ['proposal:a'],
        },
      };
    }
    return result;
  }
}

test('RECHECK flows through PlanFinalizer as NEEDS_USER_CHOICE', async () => {
  const deps = dependencies({ agentRuntime: new NeedsChoiceRuntime() });
  const result = await runCanonicalLive(deps, input);
  assert.equal(result.executionStatus, 'COMPLETED');
  assert.equal(result.resultStatus, 'NEEDS_USER_CHOICE');
  assert.equal(result.finalPlan?.status, 'NEEDS_USER_CHOICE');
});

class FailingRuntime implements AgentRuntime {
  async run(): Promise<AgentRunResult> {
    throw new Error('runtime transport failed');
  }
}

test('runtime failure records FAILED execution and a BLOCKED result ceiling', async () => {
  const deps = dependencies({ agentRuntime: new FailingRuntime() });
  const result = await runCanonicalLive(deps, input);
  assert.equal(result.executionStatus, 'FAILED');
  assert.equal(result.resultStatus, 'BLOCKED');
  assert.equal(result.failure?.code, 'CANONICAL_RUNTIME_FAILED');
  assert.deepEqual(deps.persistence.states, ['QUEUED', 'RUNNING', 'FAILED']);
});

test('completed run is returned idempotently without executing dependencies again', async () => {
  let providerCalls = 0;
  const persistence = new MemoryPersistence();
  const deps = dependencies({
    persistence,
    candidateEvidence: {
      async execute() {
        providerCalls += 1;
        return { status: 'SUCCEEDED', candidates, evidence, failures: [] };
      },
    },
  });
  const first = await runCanonicalLive(deps, input);
  const second = await runCanonicalLive(deps, input);

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(second.finalPlan?.finalPlanId, first.finalPlan?.finalPlanId);
  assert.equal(providerCalls, 1);
  assert.deepEqual(persistence.states, ['QUEUED', 'RUNNING', 'COMPLETED']);
});

test('repository adapter durably records and reloads the canonical result', async () => {
  const repos = createMemoryRepositories();
  try {
    const room = await repos.rooms.create('jp-osaka');
    const runInput: CanonicalLiveRunInput = {
      ...input,
      runId: 'run:repository-adapter:1',
      room: { ...input.room, roomId: room.roomId },
    };
    const persistence = createCanonicalRunPersistence(repos);
    const deps = dependencies({ persistence });
    const result = await runCanonicalLive(deps, runInput);
    const stored = await persistence.load(runInput.runId);
    const itinerary = await repos.itineraries.latest(room.roomId);

    assert.equal(result.executionStatus, 'COMPLETED');
    assert.equal(stored?.executionStatus, 'COMPLETED');
    assert.equal(stored?.result?.finalPlan?.finalPlanId, result.finalPlan?.finalPlanId);
    assert.equal(itinerary?.publishedAt, null);
  } finally {
    await repos.close();
  }
});
