import type { FastifyInstance } from 'fastify';
import {
  objectionCaps,
  objectionRequestSchema,
  remainingObjections,
  type ObjectionRecord,
} from '@tm/contracts';
import { assessObjection, requiresFailClosedRecheck, screenObjection } from '@tm/core';
import { store } from '../store.js';
import type { Env } from '../env.js';

/**
 * 이의 제기 — 사용자가 회의록과 결과물을 보고 재토론을 요구하는 경로.
 * 정책: docs/objection-and-rerun.md
 *
 * 흐름: preview(영향 확인) → submit(접수) → 승인 필요 시 대기 → 워커가 재실행
 */
export async function registerObjectionRoutes(app: FastifyInstance, env: Env): Promise<void> {
  const caps = { perRoom: env.OBJECTION_CAP_PER_ROOM, perUser: env.OBJECTION_CAP_PER_USER };

  const buildContext = (roomId: string, userId: string) => {
    const room = store.getRoom(roomId);
    if (room === undefined) return undefined;
    return {
      room,
      context: {
        roomStatus: room.status,
        isMember: store.isMember(roomId, userId),
        used: store.usedObjections(roomId, userId),
        caps,
        bookedNodes: room.bookedNodes,
        existingTargets: store
          .countedObjections(roomId)
          .map((record) => ({
            userId: record.request.userId,
            targetRoundId: record.request.targetRoundId,
          })),
        completedRounds: room.completedRounds,
        ...(room.budgetBaselinePerPersonKrw === undefined
          ? {}
          : { budgetBaselinePerPersonKrw: room.budgetBaselinePerPersonKrw }),
      },
    };
  };

  /** 남은 이의 횟수와 접수 이력 */
  app.get('/api/rooms/:roomId/objections', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const userId = String(request.headers['x-user-id'] ?? 'anonymous');
    if (store.getRoom(roomId) === undefined) {
      return reply.status(404).send({ error: 'room_not_found' });
    }
    const used = store.usedObjections(roomId, userId);
    return reply.send({
      caps,
      used,
      remaining: remainingObjections(used, caps),
      objections: store.listObjections(roomId),
    });
  });

  /**
   * 재실행 전 영향 예측. 무엇이 다시 계산되고 무엇을 잃을 수 있는지 먼저 보여준다.
   * 이 단계를 건너뛰면 이의는 사용자에게 도박이 된다 (기획서 19.9).
   */
  app.post('/api/rooms/:roomId/objections/preview', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const parsed = objectionRequestSchema.safeParse({ ...(request.body as object), roomId });
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_payload', issues: parsed.error.issues });
    }
    const built = buildContext(roomId, parsed.data.userId);
    if (built === undefined) return reply.status(404).send({ error: 'room_not_found' });

    const rejectReason = screenObjection(parsed.data, built.context);
    if (rejectReason !== null) {
      return reply.status(409).send({ error: rejectReason });
    }
    return reply.send({
      impact: assessObjection(parsed.data, built.context),
      failClosedRecheck: requiresFailClosedRecheck(parsed.data),
    });
  });

  /** 이의 접수. 승인이 필요하면 needs_approval로 남고 자동 실행하지 않는다. */
  app.post('/api/rooms/:roomId/objections', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const parsed = objectionRequestSchema.safeParse({ ...(request.body as object), roomId });
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_payload', issues: parsed.error.issues });
    }
    const built = buildContext(roomId, parsed.data.userId);
    if (built === undefined) return reply.status(404).send({ error: 'room_not_found' });

    const rejectReason = screenObjection(parsed.data, built.context);
    if (rejectReason !== null) {
      return reply.status(409).send({ error: rejectReason });
    }

    const impact = assessObjection(parsed.data, built.context);
    const status: ObjectionRecord['status'] =
      impact.approvalRequired.length > 0 ? 'needs_approval' : 'accepted';

    const record = store.saveObjection(parsed.data, {
      request: parsed.data,
      status,
      rejectReason: null,
      impact,
      runId: null,
      submittedAt: new Date().toISOString(),
      resolvedAt: null,
      outcome: null,
    });

    // TODO(worker): status === 'accepted' 이면 재실행 잡을 큐에 넣고 status를 'queued'로 바꾼다.
    // 큐 페이로드는 apps/worker/src/queue.ts 의 RerunJobPayload 를 쓴다.
    app.log.info(
      { objectionId: record.objectionId, status, rerunRounds: impact.rerunRounds },
      'objection accepted',
    );

    return reply.status(201).send(record);
  });
}

export { objectionCaps };
