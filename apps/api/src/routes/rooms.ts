import type { FastifyInstance } from 'fastify';
import type {
  ApprovalView,
  MemberView,
  RoomDetailView,
  StartCheckView,
  StartRunView,
  StartTriggerId,
  TriggerDecisionView,
} from '@tm/contracts';
import {
  evaluateStartTrigger,
  startTriggers,
  triggerRejectionMessage,
  type StartTrigger,
  type TriggerMember,
} from '@tm/core';
import type { MemberRow, Repositories } from '@tm/db';
import type { QueuePort } from '../queue.js';
import { currentUserId } from './session.js';

/**
 * 방 조회·멤버·페르소나 확인 게이트·실행 트리거·승인 요청.
 *
 * 사용자가 서비스와 만나는 지점은 네 곳뿐이다: 방에 들어오고, 설문을 내고,
 * 페르소나를 확인하고, 결과를 본다. 그 사이는 전부 백그라운드다.
 * 그래서 **각 지점의 상태를 정확히 돌려주는 것**이 이 라우트의 전부다.
 *
 * 사용자 식별은 `session.ts`가 담당한다 (쿠키 > `x-user-id` 헤더).
 * 그것은 인증이 아니므로 인증이 붙기 전까지 외부에 노출하지 않는다.
 */

const toTriggerMember = (row: MemberRow): TriggerMember => ({
  userId: row.userId,
  role: row.role,
  surveySubmitted: row.surveySubmitted,
  personaConfirmed: row.personaConfirmedAt !== null,
});

export async function registerRoomRoutes(
  app: FastifyInstance,
  repos: Repositories,
  queue: QueuePort,
): Promise<void> {
  /** 방 상태 한 장. 프론트가 화면을 그리는 데 필요한 것만 담는다 */
  app.get('/api/rooms/:roomId', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const room = await repos.rooms.get(roomId);
    if (room === undefined) return reply.status(404).send({ error: 'room_not_found' });

    const members = await repos.members.list(roomId);
    const userId = currentUserId(request);
    const me = members.find((member) => member.userId === userId);

    return reply.send({
      roomId: room.roomId,
      packId: room.packId,
      status: room.status,
      deadlineAt: room.deadlineAt,
      completedRounds: room.completedRounds,
      bookedNodes: room.bookedNodes,
      memberCount: members.length,
      surveyDone: members.filter((member) => member.surveySubmitted).length,
      personaConfirmed: members.filter((member) => member.personaConfirmedAt !== null).length,
      // 내 진행 상태. 어느 화면을 보여줄지가 여기서 결정된다.
      me:
        me === undefined
          ? null
          : {
              userId: me.userId,
              role: me.role,
              surveySubmitted: me.surveySubmitted,
              personaConfirmedAt: me.personaConfirmedAt,
            },
      pendingApprovals: (await repos.approvals.pending(roomId)).length,
    } satisfies RoomDetailView);
  });

  app.get('/api/rooms/:roomId/members', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    if ((await repos.rooms.get(roomId)) === undefined) {
      return reply.status(404).send({ error: 'room_not_found' });
    }
    return reply.send({ members: await repos.members.list(roomId) } satisfies { members: MemberView[] });
  });

  /** 초대 링크로 입장. 같은 사용자가 다시 들어와도 행이 늘지 않는다 */
  app.post('/api/rooms/:roomId/members', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const room = await repos.rooms.get(roomId);
    if (room === undefined) return reply.status(404).send({ error: 'room_not_found' });
    if (room.status !== 'COLLECTING') {
      // 이미 회의가 시작된 방에 나중에 들어오면 설문이 반영되지 않는다.
      return reply.status(409).send({ error: 'room_closed', status: room.status });
    }

    const userId = currentUserId(request);
    const body = (request.body ?? {}) as { role?: string };
    const role = body.role === 'host' ? 'host' : 'member';

    return reply.status(201).send(await repos.members.join(roomId, userId, role));
  });

  /**
   * 페르소나 확인 게이트.
   *
   * 사용자가 개입할 수 있는 마지막 지점이다. 확인하지 않으면 회의에 대변인이
   * 서지 않는다 — 건너뛸 수 있는 게이트가 아니다 (team-assignments T1 3번).
   */
  app.post('/api/rooms/:roomId/persona/confirm', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    if ((await repos.rooms.get(roomId)) === undefined) {
      return reply.status(404).send({ error: 'room_not_found' });
    }

    const userId = currentUserId(request);
    const member = await repos.members.get(roomId, userId);
    if (member === undefined) return reply.status(404).send({ error: 'not_a_member' });
    if (!member.surveySubmitted) {
      // 설문 없이 확인할 페르소나가 없다.
      return reply.status(409).send({ error: 'survey_required' });
    }

    const confirmed = await repos.members.confirmPersona(roomId, userId);
    return reply.send(confirmed);
  });

  /** 시작 가능 여부를 미리 본다. 방장 화면의 버튼 활성 조건이다 */
  app.get('/api/rooms/:roomId/start-check', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const room = await repos.rooms.get(roomId);
    if (room === undefined) return reply.status(404).send({ error: 'room_not_found' });

    const members = (await repos.members.list(roomId)).map(toTriggerMember);
    const userId = currentUserId(request);
    const now = new Date().toISOString();

    return reply.send({
      triggers: Object.fromEntries(
        startTriggers.map((trigger) => [
          trigger,
          evaluateStartTrigger(trigger, {
            roomStatus: room.status,
            members,
            deadlineAt: room.deadlineAt,
            now,
            requesterId: userId,
          }) satisfies TriggerDecisionView,
        ]),
      ) as StartCheckView['triggers'],
    } satisfies StartCheckView);
  });

  /**
   * 회의 시작. 트리거 3종 — 전원완료 / 방장시작 / 마감기한.
   *
   * 판정은 코드가 한다 (@tm/core `evaluateStartTrigger`). 거부 사유는 그대로 돌려준다.
   */
  app.post('/api/rooms/:roomId/start', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const room = await repos.rooms.get(roomId);
    if (room === undefined) return reply.status(404).send({ error: 'room_not_found' });

    const body = (request.body ?? {}) as { trigger?: string };
    const trigger = body.trigger as StartTrigger | undefined;
    if (trigger === undefined || !startTriggers.includes(trigger)) {
      return reply
        .status(400)
        .send({ error: 'invalid_trigger', allowed: startTriggers });
    }

    const userId = currentUserId(request);
    const decision = evaluateStartTrigger(trigger, {
      roomStatus: room.status,
      members: (await repos.members.list(roomId)).map(toTriggerMember),
      deadlineAt: room.deadlineAt,
      now: new Date().toISOString(),
      requesterId: userId,
    });

    if (!decision.allowed) {
      return reply.status(409).send({
        error: decision.reason,
        message: decision.reason === null ? '' : triggerRejectionMessage[decision.reason],
        absentees: decision.absentees,
      });
    }

    const runId = `run_${roomId}_${Date.now().toString(36)}`;
    const { jobId, enqueued } = await queue.enqueueFullRun({ runId, roomId, trigger });

    // 큐에 실제로 들어갔을 때만 QUEUED로 올린다. 실행되지 않은 방을 대기 중으로
    // 표시하면 사용자는 오지 않을 결과를 기다린다.
    if (enqueued) await repos.rooms.updateStatus(roomId, 'QUEUED');

    app.log.info({ roomId, runId, jobId, enqueued, trigger }, enqueued ? 'run queued' : 'run not queued');

    return reply.status(enqueued ? 202 : 503).send({
      runId,
      jobId,
      enqueued,
      trigger: trigger satisfies StartTriggerId,
      attendees: decision.attendees,
      // 참석하지 못한 사람을 숨기지 않는다. 결과 화면에 그대로 표시된다.
      absentees: decision.absentees,
    } satisfies StartRunView);
  });

  /** 승인 요청 목록. 예약 완료 노드에 영향이 갈 때 여기로 올라온다 (INV-5) */
  app.get('/api/rooms/:roomId/approvals', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    if ((await repos.rooms.get(roomId)) === undefined) {
      return reply.status(404).send({ error: 'room_not_found' });
    }
    return reply.send({
      approvals: (await repos.approvals.pending(roomId)) satisfies ApprovalView[],
    });
  });

  app.post('/api/rooms/:roomId/approvals/:approvalId', async (request, reply) => {
    const { roomId, approvalId } = request.params as { roomId: string; approvalId: string };
    const userId = currentUserId(request);

    const member = await repos.members.get(roomId, userId);
    if (member === undefined || member.role !== 'host') {
      // 취소 수수료가 발생할 수 있는 결정이다. 방장만 응답한다.
      return reply.status(403).send({ error: 'host_only' });
    }

    const body = (request.body ?? {}) as { decision?: string; note?: string };
    if (body.decision !== 'approve' && body.decision !== 'reject') {
      return reply.status(400).send({ error: 'invalid_decision', allowed: ['approve', 'reject'] });
    }

    const responded = await repos.approvals.respond(approvalId, {
      decision: body.decision,
      note: body.note ?? null,
      respondedBy: userId,
    });
    if (responded === undefined) return reply.status(404).send({ error: 'approval_not_found' });

    return reply.send(responded);
  });
}
