import type { FastifyInstance, FastifyRequest } from 'fastify';
import { roomSubmissionSchema, surveySubmissionSchema, type SurveySubmission } from '@tm/contracts';
import type { Repositories } from '@tm/db';
import {
  createSurveyProgressStore,
  destinationFromPlanId,
  surveyPlanFor,
  surveySubmissionV4Schema,
  toCanonicalSurvey,
  validateV4AgainstPlan,
  type SurveyProgressStore,
  type SurveySubmissionV4,
} from '../survey-v4.js';
import { currentUserId } from './session.js';

export interface IntakeRouteDeps {
  surveyProgress?: SurveyProgressStore;
}

const canonicalPackIds: Readonly<Record<string, string>> = {
  osaka: 'jp-osaka',
  'JP-OSA': 'jp-osaka',
};

async function persistSurvey(
  app: FastifyInstance,
  repos: Repositories,
  request: FastifyRequest,
  roomId: string,
  submission: SurveySubmission,
) {
  if (roomId.length === 0) return { error: 'missing_room_id' as const };
  if ((await repos.rooms.get(roomId)) === undefined) return { error: 'room_not_found' as const };

  const userId = currentUserId(request);
  await repos.members.join(roomId, userId);
  const saved = await repos.surveys.save(roomId, userId, submission);
  if (saved.allergens.length > 0) {
    app.log.info(
      { surveyId: saved.surveyId, allergenCount: saved.allergens.length },
      'allergens recorded',
    );
  }
  return { saved };
}

/**
 * Canonical survey intake plus the thin Survey v4 compatibility surface used by Felicia.
 * Final v4 submissions intentionally converge on POST /api/survey-responses instead of
 * creating a second final-submission endpoint.
 */
export async function registerIntakeRoutes(
  app: FastifyInstance,
  repos: Repositories,
  deps: IntakeRouteDeps = {},
): Promise<void> {
  const progress = deps.surveyProgress ?? createSurveyProgressStore();

  app.post('/api/trip-rooms', async (request, reply) => {
    const parsed = roomSubmissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_payload', issues: parsed.error.issues });
    }
    const packId = canonicalPackIds[parsed.data.destinationId] ?? parsed.data.destinationId;
    const room = await repos.rooms.create(packId);
    await repos.members.join(room.roomId, currentUserId(request), 'host');
    return reply.status(201).send({ roomId: room.roomId, status: room.status });
  });

  app.get('/api/survey-plans/:destinationId', async (request, reply) => {
    const { destinationId } = request.params as { destinationId: string };
    if (destinationId.trim().length === 0) {
      return reply.status(400).send({ error: 'invalid_destination_id' });
    }
    return reply.send(surveyPlanFor(destinationId));
  });

  app.get('/api/survey-progress/:planId', async (request, reply) => {
    const { planId } = request.params as { planId: string };
    if (destinationFromPlanId(planId) === null) {
      return reply.status(404).send({ error: 'survey_plan_not_found' });
    }
    return reply.send(progress.get(planId, currentUserId(request)) ?? null);
  });

  app.post('/api/survey-progress/:planId', async (request, reply) => {
    const { planId } = request.params as { planId: string };
    const parsed = surveySubmissionV4Schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_payload', issues: parsed.error.issues });
    }
    if (parsed.data.planId !== planId) {
      return reply.status(409).send({ error: 'plan_id_mismatch' });
    }
    if (parsed.data.status !== 'draft') {
      return reply.status(409).send({ error: 'final_submission_required' });
    }
    const issues = validateV4AgainstPlan(parsed.data);
    if (issues.length > 0) return reply.status(400).send({ error: 'invalid_survey_v4', issues });
    if (parsed.data.tripRoomId !== null && (await repos.rooms.get(parsed.data.tripRoomId)) === undefined) {
      return reply.status(404).send({ error: 'room_not_found' });
    }

    progress.set(planId, currentUserId(request), parsed.data);
    return reply.send({});
  });

  app.post('/api/survey-responses', async (request, reply) => {
    const version = typeof request.body === 'object' && request.body !== null
      ? (request.body as Record<string, unknown>).schemaVersion
      : undefined;

    if (version === 4) {
      const parsed = surveySubmissionV4Schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'invalid_payload', issues: parsed.error.issues });
      }
      const submission: SurveySubmissionV4 = parsed.data;
      const issues = validateV4AgainstPlan(submission);
      if (issues.length > 0) return reply.status(400).send({ error: 'invalid_survey_v4', issues });
      if (submission.status !== 'complete') {
        return reply.status(409).send({ error: 'survey_not_complete' });
      }

      const roomId = submission.tripRoomId ?? String(request.headers['x-room-id'] ?? '');
      const canonical = surveySubmissionSchema.safeParse(toCanonicalSurvey(submission));
      if (!canonical.success) {
        return reply.status(400).send({ error: 'invalid_survey_v4', issues: canonical.error.issues });
      }
      const persisted = await persistSurvey(app, repos, request, roomId, canonical.data);
      if ('error' in persisted) {
        return reply.status(persisted.error === 'room_not_found' ? 404 : 400).send({ error: persisted.error });
      }
      progress.set(submission.planId, currentUserId(request), submission);
      return reply.status(201).send({
        surveyId: persisted.saved.surveyId,
        submissionId: persisted.saved.surveyId,
        schemaVersion: 4,
      });
    }

    const parsed = surveySubmissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_payload', issues: parsed.error.issues });
    }
    const roomId = String(request.headers['x-room-id'] ?? '');
    const persisted = await persistSurvey(app, repos, request, roomId, parsed.data);
    if ('error' in persisted) {
      return reply.status(persisted.error === 'room_not_found' ? 404 : 400).send({ error: persisted.error });
    }
    return reply.status(201).send({
      surveyId: persisted.saved.surveyId,
      schemaVersion: parsed.data.schemaVersion,
    });
  });
}
