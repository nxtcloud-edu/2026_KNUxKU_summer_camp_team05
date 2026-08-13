import type { FastifyInstance } from 'fastify';
import {
  objectionRequestSchema,
  remainingObjections,
  type ObjectionRecord,
} from '@tm/contracts';
import { assessObjection, requiresFailClosedRecheck, screenObjection } from '@tm/core';
import type { Repositories } from '@tm/db';
import type { Env } from '../env.js';
import type { QueuePort } from '../queue.js';

/**
 * 이의 제기 — 사용자가 회의록과 결과물을 보고 재토론을 요구하는 경로.
 * 정책: docs/objection-and-rerun.md
 *
 * 흐름: preview(영향 확인) → submit(접수) → 승인 필요 시 대기 → 큐 등록 → 워커 재실행
 */
export async function registerObjectionRoutes(
  app: FastifyInstance,
  env: Env,
  repos: Repositories,
  queue: QueuePort,
): Promise<void> {
  const caps = { perRoom: env.OBJECTION_CAP_PER_ROOM, perUser: env.OBJECTION_CAP_PER_USER };

  const buildContext = async (roomId: string, userId: string) => {
    const room = await repos.rooms.get(roomId);
    if (room === undefined) return undefined;
    const counted = await repos.objections.countedByRoom(roomId);
    return {
      room,
      context: {
        roomStatus: room.status,
        isMember: await repos.surveys.isMember(roomId, userId),
        used: await repos.objections.used(roomId, userId),
        caps,
        bookedNodes: room.bookedNodes,
        existingTargets: counted.map((record) => ({
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
    if ((await repos.rooms.get(roomId)) === undefined) {
      return reply.status(404).send({ error: 'room_not_found' });
    }
    const used = await repos.objections.used(roomId, userId);
    return reply.send({
      caps,
      used,
      remaining: remainingObjections(used, caps),
      objections: await repos.objections.listByRoom(roomId),
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
    const built = await buildContext(roomId, parsed.data.userId);
    if (built === undefined) return reply.status(404).send({ error: 'room_not_found' });

    const rejectReason = screenObjection(parsed.data, built.context);
    if (rejectReason !== null) return reply.status(409).send({ error: rejectReason });

    return reply.send({
      impact: assessObjection(parsed.data, built.context),
      failClosedRecheck: requiresFailClosedRecheck(parsed.data),
    });
  });

  /** 이의 접수. 승인이 필요하면 needs_approval로 남고 큐에 넣지 않는다. */
  app.post('/api/rooms/:roomId/objections', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const parsed = objectionRequestSchema.safeParse({ ...(request.body as object), roomId });
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_payload', issues: parsed.error.issues });
    }
    const built = await buildContext(roomId, parsed.data.userId);
    if (built === undefined) return reply.status(404).send({ error: 'room_not_found' });

    const rejectReason = screenObjection(parsed.data, built.context);
    if (rejectReason !== null) return reply.status(409).send({ error: rejectReason });

    const impact = assessObjection(parsed.data, built.context);
    const failClosedRecheck = requiresFailClosedRecheck(parsed.data);
    const needsApproval = impact.approvalRequired.length > 0;

    let record = await repos.objections.save(parsed.data, {
      request: parsed.data,
      status: needsApproval ? 'needs_approval' : 'accepted',
      rejectReason: null,
      impact,
      runId: null,
      submittedAt: new Date().toISOString(),
      resolvedAt: null,
      outcome: null,
    });

    if (!needsApproval) {
      const runId = `run_${record.objectionId}`;
      const { jobId, enqueued } = await queue.enqueueRerun({
        runId,
        objectionId: record.objectionId,
        request: parsed.data,
        impact,
        failClosedRecheck,
      });
      // 큐에 실제로 들어간 경우에만 queued로 올린다. 실행되지 않은 이의를
      // queued로 표시하면 사용자는 기다리다 아무 결과도 받지 못한다.
      if (enqueued) {
        const updated = await repos.objections.update(record.objectionId, {
          status: 'queued' satisfies ObjectionRecord['status'],
          runId,
        });
        if (updated !== undefined) record = updated;
      }
      app.log.info(
        { objectionId: record.objectionId, jobId, enqueued, rerunRounds: impact.rerunRounds },
        enqueued ? 'rerun queued' : 'rerun not queued',
      );
    } else {
      app.log.info(
        { objectionId: record.objectionId, approvalRequired: impact.approvalRequired },
        'objection needs approval',
      );
    }

    return reply.status(201).send({ ...record, failClosedRecheck });
  });
}
