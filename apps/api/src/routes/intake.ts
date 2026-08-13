import type { FastifyInstance } from 'fastify';
import { roomSubmissionSchema, surveySubmissionSchema } from '@tm/contracts';
import { store } from '../store.js';

/**
 * 프론트엔드(`apps/web/src/formApi.ts`)가 이미 호출하는 두 엔드포인트.
 * 페이로드 검증은 @tm/contracts 스키마로만 한다 — 프론트와 서버가 어긋나지 않게 하는 유일한 방법이다.
 */
export async function registerIntakeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/trip-rooms', async (request, reply) => {
    const parsed = roomSubmissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_payload', issues: parsed.error.issues });
    }
    const room = store.createRoom(parsed.data.destinationId);
    return reply.status(201).send({ roomId: room.roomId, status: room.status });
  });

  app.post('/api/survey-responses', async (request, reply) => {
    const parsed = surveySubmissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_payload', issues: parsed.error.issues });
    }

    // TODO(auth): 카카오 OAuth 세션이 붙으면 userId를 세션에서 가져온다.
    // 그때까지는 헤더로 받되, 인증 없이 외부에 노출하지 않는다 (development-and-deployment.md 7.6).
    const userId = String(request.headers['x-user-id'] ?? 'anonymous');
    const roomId = String(request.headers['x-room-id'] ?? '');
    if (roomId.length === 0) {
      return reply.status(400).send({ error: 'missing_room_id' });
    }

    const saved = store.saveSurvey(roomId, userId, parsed.data);

    // 알레르기는 안전 축이라 접수 시점에 별도로 기록한다.
    // 이후 라운드에서 코드 레벨 실격과 fail-closed 검증의 입력이 된다.
    const { allergies } = parsed.data.hardConstraints;
    if (allergies.length > 0) {
      app.log.info({ surveyId: saved.surveyId, allergenCount: allergies.length }, 'allergens recorded');
    }

    return reply.status(201).send({ surveyId: saved.surveyId, schemaVersion: parsed.data.schemaVersion });
  });
}
