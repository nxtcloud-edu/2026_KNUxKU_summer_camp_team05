import { Queue } from 'bullmq';
import type { ObjectionImpact, ObjectionRequest } from '@tm/contracts';
import { executeServerlessJob } from '@tm/worker/process-job';
import type { JobPayload } from '@tm/worker/queue';

/**
 * 재실행 잡 producer. 큐 이름과 페이로드는 apps/worker/src/queue.ts 와 같아야 한다.
 * TODO(shared): 큐 계약을 packages/contracts 로 옮겨 중복을 없앤다.
 */
export const QUEUE_NAME = 'debate';

export interface RerunEnqueueInput {
  runId: string;
  objectionId: string;
  request: ObjectionRequest;
  impact: ObjectionImpact;
  failClosedRecheck: boolean;
}

export interface EnqueueResult {
  jobId: string;
  /** 실제로 큐에 들어갔는가. false면 이의 상태를 queued로 올리지 않는다 */
  enqueued: boolean;
  completedInline?: boolean;
}

type ExecuteJob = (payload: JobPayload) => Promise<unknown>;

export interface FullRunEnqueueInput {
  runId: string;
  roomId: string;
  /** 트리거 3종. 워커의 `fullRunPayloadSchema`와 값이 같아야 한다 */
  trigger: 'all_done' | 'host' | 'deadline';
}

export interface QueuePort {
  enqueueRerun(input: RerunEnqueueInput): Promise<EnqueueResult>;
  enqueueFullRun(input: FullRunEnqueueInput): Promise<EnqueueResult>;
  close(): Promise<void>;
}

/**
 * 심판에게 전달할 지시문. 사용자의 이의 사유를 요약하지 않고 그대로 인용한다.
 * 사용자는 회의에 참석하지 못했으므로 이 문장이 그가 남긴 유일한 발언이다.
 */
export function buildInstruction(request: ObjectionRequest, failClosedRecheck: boolean): string {
  const parts = [`참여자 이의: "${request.reason}"`];

  if (request.anchor.claimIds.length > 0 || request.anchor.candidateIds.length > 0) {
    const anchors = [...request.anchor.claimIds, ...request.anchor.candidateIds].join(', ');
    parts.push(`지목된 근거(${anchors})를 팩트체크 단계에서 반드시 다시 검증하세요.`);
  }
  if (request.excludeCandidateIds.length > 0) {
    parts.push(`다음 후보를 제외하고 재조달하세요: ${request.excludeCandidateIds.join(', ')}.`);
  }
  if (request.lateConstraints.length > 0) {
    const tags = request.lateConstraints.map((c) => c.tag).join(', ');
    parts.push(`새로 등록된 제약을 반영하세요: ${tags}.`);
  }
  if (failClosedRecheck) {
    parts.push(
      '안전 관련 제약이 추가되었습니다. 대응을 확인하지 못한 후보는 최종안이 될 수 없습니다.',
    );
  }
  if (request.budgetDeltaPerPersonKrw > 0) {
    parts.push(`1인 예산 ${request.budgetDeltaPerPersonKrw.toLocaleString()}원 완화가 승인되었습니다.`);
  }

  return parts.join(' ');
}

export function createQueue(redisUrl: string): QueuePort {
  const queue = new Queue(QUEUE_NAME, { connection: { url: redisUrl } });

  return {
    async enqueueRerun(input) {
      // 중복 요청이 들어와도 결과가 1개만 발행되도록 잡 ID를 고정한다.
      const jobId = `rerun:${input.objectionId}`;
      await queue.add(
        'rerun_from_objection',
        {
          kind: 'rerun_from_objection',
          roomId: input.request.roomId,
          runId: input.runId,
          objectionId: input.objectionId,
          rerunRounds: input.impact.rerunRounds,
          instruction: buildInstruction(input.request, input.failClosedRecheck),
          failClosedRecheck: input.failClosedRecheck,
        },
        { jobId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
      return { jobId, enqueued: true };
    },
    async enqueueFullRun(input) {
      // 같은 run이 두 번 들어와도 결과는 1개다. 트리거가 중복 발화해도 안전하다.
      const jobId = `run:${input.runId}`;
      await queue.add(
        'full_run',
        {
          kind: 'full_run',
          roomId: input.roomId,
          runId: input.runId,
          trigger: input.trigger,
        },
        { jobId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
      return { jobId, enqueued: true };
    },
    async close() {
      await queue.close();
    },
  };
}

export function createInlineWorkerQueue(execute: ExecuteJob = executeServerlessJob): QueuePort {
  return {
    async enqueueRerun(input) {
      const jobId = `rerun:${input.objectionId}`;
      await execute({
        kind: 'rerun_from_objection',
        roomId: input.request.roomId,
        runId: input.runId,
        objectionId: input.objectionId,
        rerunRounds: input.impact.rerunRounds,
        instruction: buildInstruction(input.request, input.failClosedRecheck),
        failClosedRecheck: input.failClosedRecheck,
      });
      return { jobId, enqueued: true, completedInline: true };
    },
    async enqueueFullRun(input) {
      const jobId = `run:${input.runId}`;
      await execute({ kind: 'full_run', ...input });
      return { jobId, enqueued: true, completedInline: true };
    },
    async close() {
    },
  };
}

/**
 * Redis가 없을 때. 접수는 되지만 실행되지 않았음을 상태와 로그로 드러낸다.
 * 실행되지 않은 이의를 queued로 표시하면 사용자는 기다리다 아무 결과도 받지 못한다.
 */
export function createNoopQueue(onSkip: (jobId: string) => void): QueuePort {
  return {
    async enqueueRerun(input) {
      const jobId = `rerun:${input.objectionId}`;
      onSkip(jobId);
      return { jobId, enqueued: false };
    },
    async enqueueFullRun(input) {
      const jobId = `run:${input.runId}`;
      onSkip(jobId);
      return { jobId, enqueued: false };
    },
    async close() {
      /* no-op */
    },
  };
}
