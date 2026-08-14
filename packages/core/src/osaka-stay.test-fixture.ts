import {
  candidateRecordSchema,
  capacityPlanSchema,
  evidenceSnapshotSchema,
  tripCharterSchema,
  type CandidateRecord,
  type EvidenceSnapshot,
  type TripCharter,
} from '@tm/contracts';
import {
  STAY_EVIDENCE_FIELDS,
  type StayCandidateValidationInput,
  type StayHardConstraint,
} from './fact-constraint-validator.js';

type CapacityPlan = ReturnType<typeof capacityPlanSchema.parse>;

export const osakaParticipantIds = ['u1', 'u2', 'u3'] as const;

export const osakaStayCharter: TripCharter = tripCharterSchema.parse({
  schemaVersion: 1,
  charterVersion: 'charter:osaka:stay:1',
  destination: '오사카',
  startDate: '2026-10-16',
  endDate: '2026-10-19',
  participantIds: [...osakaParticipantIds],
  partySize: 3,
  pace: 'balanced',
  budgetMaxByParticipantKrw: { u1: 300_000, u2: 400_000, u3: 500_000 },
});

export const osakaStayHardConstraints: StayHardConstraint[] = [
  {
    constraintId: 'constraint:u2:private-bathroom',
    kind: 'REQUIRED_ATTRIBUTE',
    attribute: 'private-bathroom',
  },
  {
    constraintId: 'constraint:u1:no-dormitory',
    kind: 'FORBIDDEN_ATTRIBUTE',
    attribute: 'dormitory',
  },
];

export const osakaStayPayload: Record<string, unknown> = {
  kind: 'hotel',
  id: 'hotel-osaka-namba-1',
  source: 'rakuten_travel',
  fetchedAt: '2026-08-14T00:00:00.000Z',
  disqualified: false,
  disqualifyReason: null,
  name: '난바 트리플 호텔',
  type: 'hotel',
  location: {
    lat: 34.6659,
    lng: 135.5015,
    area: '난바',
    address: '오사카시 주오구',
  },
  price: {
    amount: 100_000,
    currency: 'KRW',
    confidence: 'live',
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
    roomOptions: [{ config: '트리플', totalGuests: 3, pricePerNight: 300_000 }],
  },
  roomCombinationVerified: true,
  allInPriceVerified: true,
  amenities: ['wifi', 'private-bathroom', 'non-smoking'],
  accessibility: { wheelchair: null, elevator: true, stepFree: true },
  locationMetrics: { namba: { label: '난바역', minutes: 12 } },
  rating: { score: 4.4, count: 820 },
  cancelPolicy: { freeUntil: '2026-10-16T00:00:00.000Z', penaltyAfter: '100%' },
  bookingUrl: 'https://example.test/hotel/osaka-namba-1',
  stayVerification: {
    checkIn: '2026-10-16',
    checkOut: '2026-10-19',
    partySize: 3,
    available: true,
    travelBurdenMinutes: 12,
  },
};

export function createOsakaStayCandidate(
  overrides: Partial<CandidateRecord> = {},
): CandidateRecord {
  return candidateRecordSchema.parse({
    schemaVersion: 1,
    candidateId: 'candidate:osaka:namba',
    category: 'stay',
    sourceBriefIds: ['brief:u1', 'brief:u2', 'brief:u3', 'brief:neutral'],
    providerId: 'rakuten_travel',
    providerCandidateId: 'hotel-osaka-namba-1',
    title: '난바 트리플 호텔',
    sourceMode: 'live',
    poolEligibility: 'UNVERIFIED',
    exclusionReasons: [],
    evidenceIds: ['evidence:osaka:namba'],
    payload: osakaStayPayload,
    ...overrides,
  });
}

export function createOsakaStayEvidence(
  overrides: Partial<EvidenceSnapshot> = {},
): EvidenceSnapshot {
  return evidenceSnapshotSchema.parse({
    schemaVersion: 1,
    evidenceId: 'evidence:osaka:namba',
    queryPlanId: 'query:stay:osaka:namba',
    providerId: 'rakuten_travel',
    providerCandidateId: 'hotel-osaka-namba-1',
    sourceUrl: 'https://example.test/hotel/osaka-namba-1',
    retrievedAt: '2026-08-14T00:00:00.000Z',
    validUntil: '2026-08-15T00:00:00.000Z',
    confidence: 'live',
    status: 'PASS',
    termsRef: 'rakuten-fixture-terms',
    fieldStates: Object.fromEntries(
      Object.values(STAY_EVIDENCE_FIELDS).map((field) => [field, 'PASS']),
    ),
    ...overrides,
  });
}

export function createOsakaStayCapacityPlan(
  overrides: Partial<CapacityPlan> = {},
): CapacityPlan {
  return capacityPlanSchema.parse({
    requestedPartySize: 3,
    confirmedCapacity: 3,
    allocations: [
      {
        resourceUnitId: 'room:osaka:namba:triple',
        confirmedCapacity: 3,
        assignedParticipantIds: [...osakaParticipantIds],
      },
    ],
    unassignedParticipantIds: [],
    evidenceIds: ['evidence:osaka:namba'],
    splitAuthorityRef: null,
    ...overrides,
  });
}

export function createOsakaStayValidationInput(
  overrides: Partial<StayCandidateValidationInput> = {},
): StayCandidateValidationInput {
  return {
    proposalId: 'proposal:stay:candidate:osaka:namba:v1',
    candidate: createOsakaStayCandidate(),
    evidence: [createOsakaStayEvidence()],
    charter: osakaStayCharter,
    capacityPlan: createOsakaStayCapacityPlan(),
    hardConstraints: osakaStayHardConstraints,
    allowedRoomSplitAuthorityRefs: [],
    checkedAt: '2026-08-14T12:00:00.000Z',
    ...overrides,
  };
}
