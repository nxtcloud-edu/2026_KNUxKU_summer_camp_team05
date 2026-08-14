import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { FixtureAgentRuntime } from '@tm/agents';
import {
  STAY_EVIDENCE_FIELDS,
} from '@tm/core';
import type {
  CandidateRecord,
  EvidenceSnapshot,
  ProxySearchBrief,
  TripCharter,
  UserProxyProfileView,
} from '@tm/contracts';
import {
  createCandidateEvidenceExecutionPort,
  createDataAgent,
  createStaticRegistry,
  type ProviderAdapter,
} from '@tm/data-agents';
import { createMemoryRepositories } from '@tm/db';
import {
  createB1StructuredSearchPort,
  createB4CandidateValidationPort,
  createB4ProposalSetPort,
} from './canonical-component-adapters.js';

const checkedAt = '2026-08-14T12:00:00.000Z';
const participantIds = ['u1', 'u2', 'u3'];
const profiles: UserProxyProfileView[] = participantIds.map((participantId, index) => ({
  participantId,
  profileVersion: `profile:${participantId}:1`,
  facts: index === 0
    ? [{ factId: `fact:${participantId}:bath`, statement: 'private bathroom', importance: 5, hard: true, polarity: 'REQUIRE' }]
    : [],
  budgetMaxKrw: 400_000,
}));
const charter: TripCharter = {
  schemaVersion: 1,
  charterVersion: 'charter:trip:osaka:1',
  destination: 'Osaka',
  startDate: '2026-10-16',
  endDate: '2026-10-19',
  participantIds,
  partySize: 3,
  pace: 'balanced',
  budgetMaxByParticipantKrw: { u1: 400_000, u2: 400_000, u3: 400_000 },
};

async function packSource() {
  const pack = JSON.parse(
    await readFile(new URL('../../../packs/jp-osaka.json', import.meta.url), 'utf8'),
  ) as unknown;
  return { get: async (packId: string) => packId === 'jp-osaka' ? { pack } : undefined };
}

async function searchBriefs(): Promise<ProxySearchBrief[]> {
  const runtime = new FixtureAgentRuntime();
  const briefs: ProxySearchBrief[] = [];
  for (const profile of profiles) {
    const result = await runtime.run({
      schemaVersion: 1,
      role: 'USER_PROXY',
      task: 'CREATE_SEARCH_BRIEF',
      runId: 'run:adapter:1',
      tripId: 'trip:osaka',
      inputVersion: 1,
      category: 'stay',
      participant: profile,
      charter,
      priorContractRefs: [],
    });
    if (result.role !== 'USER_PROXY' || result.task !== 'CREATE_SEARCH_BRIEF') {
      throw new Error('search brief fixture failed');
    }
    briefs.push(result.brief);
  }
  return briefs;
}

test('B1 context와 B2 execution을 B4 validator에 연결하면 UNKNOWN evidence가 fail-closed 된다', async () => {
  const structuredSearch = createB1StructuredSearchPort(await packSource());
  const briefs = await searchBriefs();
  const searchContext = await structuredSearch.build({
    runId: 'run:adapter:1',
    room: {
      roomId: 'room:osaka',
      tripId: 'trip:osaka',
      packId: 'jp-osaka',
      destination: 'Osaka',
      pace: 'balanced',
      category: 'stay',
    },
    charter,
    briefs,
    profiles,
  });
  const runtime = new FixtureAgentRuntime();
  const queryResult = await runtime.run({
    schemaVersion: 1,
    role: 'CANDIDATE_EVIDENCE',
    runId: 'run:adapter:1',
    tripId: 'trip:osaka',
    inputVersion: 1,
    category: 'stay',
    briefs,
    neutralBrief: searchContext.neutralBrief,
    availableProviderIds: searchContext.availableProviderIds,
    searchAttempt: 0,
    currentCandidateIds: [],
  });
  if (queryResult.role !== 'CANDIDATE_EVIDENCE') throw new Error('query fixture failed');
  const provider: ProviderAdapter = {
    id: 'rakuten_travel',
    supports: (queryClass) => queryClass === 'hotel.search',
    async fetch() {
      return {
        confidence: 'live',
        validUntil: '2026-08-15T12:00:00.000Z',
        termsRef: 'fixture-provider-terms',
        payload: { candidates: [hotelPayload()] },
      };
    },
  };
  const repos = createMemoryRepositories();
  try {
    const gateway = createDataAgent({
      cache: repos.cache,
      providers: createStaticRegistry([provider], { 'jp-osaka': { hotel: ['rakuten_travel'] } }),
      now: () => new Date(checkedAt),
    });
    const execution = await createCandidateEvidenceExecutionPort(gateway).execute({
      runId: 'run:adapter:1',
      tripId: 'trip:osaka',
      inputVersion: 1,
      searchAttempt: 0,
      charter,
      queryPlans: queryResult.queryPlans,
      expectedBriefIds: [...briefs.map((brief) => brief.briefId), searchContext.neutralBrief.briefId],
      ...searchContext.providerExecution,
      category: 'stay',
    });
    const validator = createB4CandidateValidationPort({
      now: () => new Date(checkedAt),
      capacityPlanForCandidate: ({ candidate }) => capacityPlan(candidate.evidenceIds),
    });
    const result = await validator.validate({
      runId: 'run:adapter:1',
      room: {
        roomId: 'room:osaka',
        tripId: 'trip:osaka',
        packId: 'jp-osaka',
        destination: 'Osaka',
        pace: 'balanced',
        category: 'stay',
      },
      charter,
      profiles,
      execution,
      searchContext,
    });
    assert.equal(execution.status, 'SUCCEEDED');
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.validations[0]?.eligibility, 'UNVERIFIED');
    assert.ok(result.receipts.some((receipt) => receipt.status === 'UNKNOWN'));
  } finally {
    await repos.close();
  }
});

test('B4 adapter는 모두 PASS인 Osaka 3인 3박 후보만 pool과 proposal로 봉인한다', async () => {
  const briefs = await searchBriefs();
  const structuredSearch = createB1StructuredSearchPort(await packSource());
  const searchContext = await structuredSearch.build({
    runId: 'run:adapter:eligible',
    room: {
      roomId: 'room:osaka', tripId: 'trip:osaka', packId: 'jp-osaka',
      destination: 'Osaka', pace: 'balanced', category: 'stay',
    },
    charter,
    briefs,
    profiles,
  });
  const evidenceId = 'evidence:osaka:verified';
  const candidate: CandidateRecord = {
    schemaVersion: 1,
    candidateId: 'candidate:osaka:verified',
    category: 'stay',
    sourceBriefIds: [...briefs.map((brief) => brief.briefId), searchContext.neutralBrief.briefId],
    providerId: 'fixture-verifier',
    providerCandidateId: 'hotel-osaka-verified',
    title: 'Osaka verified stay',
    sourceMode: 'live',
    poolEligibility: 'UNVERIFIED',
    exclusionReasons: [],
    evidenceIds: [evidenceId],
    payload: {
      ...hotelPayload(),
      id: 'hotel-osaka-verified',
      source: 'fixture-verifier',
      stayVerification: {
        checkIn: charter.startDate,
        checkOut: charter.endDate,
        partySize: 3,
        available: true,
        travelBurdenMinutes: 8,
      },
    },
  };
  const evidence: EvidenceSnapshot = {
    schemaVersion: 1,
    evidenceId,
    queryPlanId: 'query:osaka:verified',
    providerId: 'fixture-verifier',
    providerCandidateId: 'hotel-osaka-verified',
    sourceUrl: 'https://example.test/osaka-verified',
    retrievedAt: checkedAt,
    validUntil: '2026-08-15T12:00:00.000Z',
    confidence: 'live',
    status: 'PASS',
    termsRef: 'verified-fixture-terms',
    fieldStates: Object.fromEntries(
      Object.values(STAY_EVIDENCE_FIELDS).map((field) => [field, 'PASS']),
    ),
  };
  const validator = createB4CandidateValidationPort({
    now: () => new Date(checkedAt),
    capacityPlanForCandidate: () => capacityPlan([evidenceId]),
  });
  const validated = await validator.validate({
    runId: 'run:adapter:eligible',
    room: {
      roomId: 'room:osaka', tripId: 'trip:osaka', packId: 'jp-osaka',
      destination: 'Osaka', pace: 'balanced', category: 'stay',
    },
    charter,
    profiles,
    execution: { status: 'SUCCEEDED', candidates: [candidate], evidence: [evidence], failures: [] },
    searchContext,
  });
  assert.equal(validated.status, 'READY');
  assert.equal(validated.validations[0]?.eligibility, 'ELIGIBLE');
  if (validated.candidatePool === null) throw new Error('candidate pool missing');
  const proposalPort = createB4ProposalSetPort({
    now: () => new Date(checkedAt),
    evaluate: ({ profile, proposalSet }) => proposalSet.proposals.map((proposal) => ({
      proposalId: proposal.proposalId,
      satisfactionBp: 8_000,
      stance: 'support',
      profileFactRefs: profile.facts.map((fact) => fact.factId),
      evidenceIds: proposal.evidenceIds,
      conditionalTerms: [],
    })),
  });
  const proposed = await proposalPort.create({
    runId: 'run:adapter:eligible',
    room: {
      roomId: 'room:osaka', tripId: 'trip:osaka', packId: 'jp-osaka',
      destination: 'Osaka', pace: 'balanced', category: 'stay',
    },
    charter,
    profiles,
    candidatePool: validated.candidatePool,
    candidates: validated.candidates,
    evidence: validated.evidence,
    receipts: validated.receipts,
    validations: validated.validations,
  });
  assert.equal(proposed.proposalSet.proposals.length, 1);
  assert.equal(Object.keys(proposed.evaluationsByParticipantId).length, 3);
});

function capacityPlan(evidenceIds: readonly string[]) {
  return {
    requestedPartySize: 3,
    confirmedCapacity: 3,
    allocations: [{
      resourceUnitId: 'room:osaka:triple',
      confirmedCapacity: 3,
      assignedParticipantIds: participantIds,
    }],
    unassignedParticipantIds: [],
    evidenceIds: [...evidenceIds],
    splitAuthorityRef: null,
  };
}

function hotelPayload() {
  return {
    kind: 'hotel' as const,
    id: 'hotel-osaka-1',
    source: 'rakuten_travel',
    fetchedAt: checkedAt,
    disqualified: false,
    disqualifyReason: null,
    name: 'Osaka triple stay',
    type: 'hotel' as const,
    location: { lat: 34.6659, lng: 135.5015, area: '난바', address: null },
    price: {
      amount: 900_000,
      currency: 'KRW',
      confidence: 'live' as const,
      perNightPerPerson: 100_000,
      totalPerPerson: 300_000,
      groupTotal: 900_000,
      taxesIncluded: true,
    },
    meals: {
      breakfastIncluded: false,
      dinnerIncluded: false,
      mealValuePerPersonPerNight: null,
      effectiveLodgingCost: null,
      dietSupportVerified: false,
    },
    capacity: {
      maxGuests: 3,
      roomOptions: [{ config: 'triple', totalGuests: 3, pricePerNight: 300_000 }],
    },
    roomCombinationVerified: true,
    allInPriceVerified: true,
    amenities: ['private_bathroom', 'wifi'],
    accessibility: { wheelchair: null, elevator: true, stepFree: true },
    locationMetrics: { station: { label: 'Namba', minutes: 8 } },
    rating: { score: 4.5, count: 100 },
    cancelPolicy: { freeUntil: '2026-10-16T00:00:00.000Z', penaltyAfter: '100%' },
    bookingUrl: 'https://example.test/osaka',
  };
}
