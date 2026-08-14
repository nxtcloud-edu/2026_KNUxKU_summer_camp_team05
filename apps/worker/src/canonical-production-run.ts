import { FixtureAgentRuntime } from '@tm/agents';
import {
  capacityPlanSchema,
  hotelCandidateSchema,
  parseBudgetKrw,
  type UserProxyProfileView,
} from '@tm/contracts';
import { evaluateStayProposalSetForProfile } from '@tm/core';
import {
  createCandidateEvidenceExecutionPort,
  createDataAgent,
  createDemoProvider,
  providersFromEnv,
  shouldUseDemoProvider,
} from '@tm/data-agents';
import type { Repositories, SurveyRow } from '@tm/db';
import {
  createB1StructuredSearchPort,
  createB4CandidateValidationPort,
  createB4ProposalSetPort,
} from './canonical-component-adapters.js';
import { runCanonicalLive, type CanonicalLiveRunInput } from './canonical-live-run.js';
import { createCanonicalRunPersistence } from './canonical-run-recorder.js';
import { createWorkerAgentRuntime } from './codex-gateway.js';
import type { JobPayload } from './queue.js';

function preferredNights(value: SurveyRow['payload']['availability']['preferredNights']): number | null {
  if (value === null) return null;
  return value === '4+' ? 4 : Number(value);
}

type ProfileFact = UserProxyProfileView['facts'][number];

function profileFacts(survey: SurveyRow): ProfileFact[] {
  const facts: ProfileFact[] = [];
  const add = (
    prefix: string,
    statements: readonly string[],
    hard: boolean,
    polarity: ProfileFact['polarity'],
  ) => {
    for (const [index, statement] of statements.entries()) {
      if (statement.trim().length === 0) continue;
      facts.push({
        factId: `fact:${survey.userId}:${prefix}:${index + 1}`,
        statement,
        importance: hard ? 5 : 3,
        hard,
        polarity,
      });
    }
  };
  add('mobility', survey.payload.hardConstraints.mobilityNeeds, true, 'REQUIRE');
  add('no-go', survey.payload.hardConstraints.noGoItems, true, 'AVOID');
  add('must-do', [survey.payload.mustDo], false, 'PREFER');
  add('avoid', [survey.payload.avoid], false, 'AVOID');
  return facts;
}

function profileOf(survey: SurveyRow): UserProxyProfileView {
  return {
    participantId: survey.userId,
    profileVersion: `survey:${survey.surveyId}:v${survey.schemaVersion}`,
    facts: profileFacts(survey),
    budgetMaxKrw: parseBudgetKrw(survey.payload.hardConstraints.budgetLimit) ?? 0,
  };
}

function dateChoiceOf(setting: Record<string, unknown>): { start: string; end: string } | undefined {
  const value = setting['canonicalDateChoice'];
  if (typeof value !== 'object' || value === null) return undefined;
  const start = (value as Record<string, unknown>)['start'];
  const end = (value as Record<string, unknown>)['end'];
  return typeof start === 'string' && typeof end === 'string' ? { start, end } : undefined;
}

export async function createCanonicalProductionInput(
  repos: Repositories,
  payload: Extract<JobPayload, { kind: 'full_run' }>,
  today = new Date().toISOString().slice(0, 10),
): Promise<CanonicalLiveRunInput> {
  const room = await repos.rooms.get(payload.roomId);
  if (room === undefined) throw new Error(`Room not found: ${payload.roomId}`);
  const [pack, surveys] = await Promise.all([
    repos.packs.get(room.packId),
    repos.surveys.listByRoom(room.roomId),
  ]);
  if (pack === undefined) throw new Error(`Destination Pack not found: ${room.packId}`);
  if (surveys.length === 0) throw new Error('Canonical run requires submitted surveys.');
  const profiles = surveys.map(profileOf);
  return {
    runId: payload.runId,
    inputVersion: 1,
    room: {
      roomId: room.roomId,
      tripId: room.roomId,
      packId: room.packId,
      destination: pack.pack.displayName,
      pace: 'balanced',
      category: 'stay',
    },
    profiles,
    ...(dateChoiceOf(room.setting) === undefined ? {} : { dateChoice: dateChoiceOf(room.setting) }),
    dateResolverInput: {
      participants: surveys.map((survey) => ({
        userId: survey.userId,
        availableDates: survey.payload.availability.availableDates,
        preferredNights: preferredNights(survey.payload.availability.preferredNights),
        nightFlexible: survey.payload.availability.nightFlexibility === 'plus-minus-one',
      })),
      pack: {
        recommendedNights: pack.pack.recommendedNights,
        peakSeasons: pack.pack.peakSeasons,
        avoidDates: pack.pack.avoidDates,
        weatherProfile: pack.pack.weatherProfile,
        requiresAirTravel: pack.pack.requiresAirTravel,
      },
      today,
    },
  };
}

export async function executeCanonicalProductionRun(
  repos: Repositories,
  payload: Extract<JobPayload, { kind: 'full_run' }>,
  env: NodeJS.ProcessEnv = process.env,
) {
  const input = await createCanonicalProductionInput(repos, payload);
  const pack = await repos.packs.get(input.room.packId);
  if (pack === undefined) throw new Error(`Destination Pack not found: ${input.room.packId}`);
  const liveSetup = providersFromEnv(env);
  const useDemo = shouldUseDemoProvider(env, liveSetup.adapters.length);
  const setup = providersFromEnv(env, useDemo ? [createDemoProvider()] : []);
  const gateway = createDataAgent({
    cache: repos.cache,
    providers: setup.registry({ [pack.packId]: pack.pack.providers }),
  });
  const candidateEvidence = createCandidateEvidenceExecutionPort(gateway);
  const candidateValidator = createB4CandidateValidationPort({
    capacityPlanForCandidate({ candidate, charter, roomCount }) {
      const hotel = hotelCandidateSchema.safeParse(candidate.payload);
      if (!hotel.success || !hotel.data.roomCombinationVerified || roomCount !== 1) return null;
      return capacityPlanSchema.parse({
        requestedPartySize: charter.partySize,
        confirmedCapacity: hotel.data.capacity.maxGuests,
        allocations: [{
          resourceUnitId: `room-combination:${candidate.providerCandidateId}`,
          confirmedCapacity: hotel.data.capacity.maxGuests,
          assignedParticipantIds: [...charter.participantIds],
        }],
        unassignedParticipantIds: [],
        evidenceIds: [...candidate.evidenceIds],
        splitAuthorityRef: null,
      });
    },
  });
  const agentRuntime = env['MOA_AGENT_RUNTIME'] === 'fixture'
    ? new FixtureAgentRuntime()
    : createWorkerAgentRuntime(env);
  return runCanonicalLive({
    agentRuntime,
    structuredSearch: createB1StructuredSearchPort(
      repos.packs,
      setup.adapters.map((adapter) => adapter.id),
    ),
    candidateEvidence,
    candidateValidator,
    proposalSet: createB4ProposalSetPort({
      evaluate: ({ profile, proposalSet }) => evaluateStayProposalSetForProfile(profile, proposalSet),
    }),
    persistence: createCanonicalRunPersistence(repos),
  }, input);
}
