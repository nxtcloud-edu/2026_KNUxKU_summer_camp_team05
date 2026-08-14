import type { FastifyInstance } from 'fastify';
import { resolveDates, type DateResolution, type DateWindow } from '@tm/core';
import type { Repositories, RoomRow } from '@tm/db';
import { currentUserId } from './session.js';

type PublicResolutionStatus = 'PROVISIONAL' | 'VERIFIED' | 'NEEDS_USER_CHOICE' | 'BLOCKED';

interface DateResolutionEnvelope {
  status: PublicResolutionStatus;
  reason: string | null;
  data: (DateResolution & { chosen: DateWindow | null }) | null;
}

export interface DateChoiceStore {
  get(roomId: string): DateWindow | undefined;
  set(roomId: string, choice: DateWindow): void;
}

export function createDateChoiceStore(): DateChoiceStore {
  const values = new Map<string, DateWindow>();
  return {
    get: (roomId) => values.get(roomId),
    set: (roomId, choice) => values.set(roomId, choice),
  };
}

function preferredNights(value: '1' | '2' | '3' | '4+' | null): number | null {
  if (value === null) return null;
  return value === '4+' ? 4 : Number(value);
}

function publicStatus(resolution: DateResolution): PublicResolutionStatus {
  if (resolution.status === 'confirmed') return 'VERIFIED';
  if (resolution.status === 'needs_discussion' || resolution.status === 'needs_host_choice') {
    return 'NEEDS_USER_CHOICE';
  }
  return 'BLOCKED';
}

async function calculate(
  repos: Repositories,
  room: RoomRow,
  today: string,
): Promise<DateResolutionEnvelope> {
  const [members, surveys, pack] = await Promise.all([
    repos.members.list(room.roomId),
    repos.surveys.listByRoom(room.roomId),
    repos.packs.get(room.packId),
  ]);
  if (pack === undefined) {
    return { status: 'BLOCKED', reason: 'destination_pack_not_found', data: null };
  }

  const submitted = new Set(surveys.map((survey) => survey.userId));
  const missing = members.filter((member) => !submitted.has(member.userId));
  if (surveys.length === 0 || missing.length > 0) {
    return {
      status: 'PROVISIONAL',
      reason: surveys.length === 0 ? 'missing_survey_evidence' : 'member_survey_evidence_incomplete',
      data: null,
    };
  }

  const resolution = resolveDates({
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
  });
  return { status: publicStatus(resolution), reason: resolution.reason, data: resolution };
}

export async function registerDateResolutionRoutes(
  app: FastifyInstance,
  repos: Repositories,
  choices: DateChoiceStore = createDateChoiceStore(),
): Promise<void> {
  const read = async (roomId: string): Promise<DateResolutionEnvelope | undefined> => {
    const room = await repos.rooms.get(roomId);
    if (room === undefined) return undefined;
    const result = await calculate(repos, room, new Date().toISOString().slice(0, 10));
    const chosen = choices.get(roomId);
    const choiceIsStillOffered = result.data?.windows.some(
      (window) => window.start === chosen?.start && window.end === chosen.end,
    ) ?? false;
    if (chosen === undefined || result.data === null || !choiceIsStillOffered) return result;
    return {
      status: 'VERIFIED',
      reason: null,
      data: { ...result.data, status: 'confirmed', chosen },
    };
  };

  app.get('/api/rooms/:roomId/date-resolution', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const result = await read(roomId);
    if (result === undefined) return reply.status(404).send({ error: 'room_not_found' });
    return reply.send(result);
  });

  app.post('/api/rooms/:roomId/date-resolution/choice', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const room = await repos.rooms.get(roomId);
    if (room === undefined) return reply.status(404).send({ error: 'room_not_found' });

    const member = await repos.members.get(roomId, currentUserId(request));
    if (member === undefined) return reply.status(403).send({ error: 'member_only' });
    if (member.role !== 'host') return reply.status(403).send({ error: 'host_only' });

    const body = (request.body ?? {}) as { start?: unknown; end?: unknown };
    if (typeof body.start !== 'string' || typeof body.end !== 'string') {
      return reply.status(400).send({ error: 'invalid_date_choice' });
    }
    const result = await calculate(repos, room, new Date().toISOString().slice(0, 10));
    if (result.data === null) return reply.status(409).send(result);
    const choice = result.data.windows.find(
      (window) => window.start === body.start && window.end === body.end,
    );
    if (choice === undefined) {
      return reply.status(409).send({ error: 'date_choice_not_offered' });
    }

    choices.set(roomId, choice);
    return reply.send({
      status: 'VERIFIED',
      reason: null,
      data: { ...result.data, status: 'confirmed', chosen: choice },
    } satisfies DateResolutionEnvelope);
  });
}
