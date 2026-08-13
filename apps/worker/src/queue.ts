import { z } from 'zod';
import { roundIds } from '@tm/contracts';

/** 큐 이름. 잡 ID는 멱등성을 위해 호출자가 결정한다 (기획서 10.2). */
export const QUEUE_NAME = 'debate';

export const jobKinds = ['full_run', 'rerun_from_objection'] as const;
export type JobKind = (typeof jobKinds)[number];

export const fullRunPayloadSchema = z.object({
  kind: z.literal('full_run'),
  roomId: z.string(),
  runId: z.string(),
  trigger: z.enum(['all_done', 'host', 'deadline']),
});

/**
 * 이의로 시작되는 재실행. 처음부터 다시 돌리지 않고
 * STALE 노드에 해당하는 라운드만 다시 실행한다.
 */
export const rerunPayloadSchema = z.object({
  kind: z.literal('rerun_from_objection'),
  roomId: z.string(),
  runId: z.string(),
  objectionId: z.string(),
  rerunRounds: z.array(z.enum(roundIds)).min(1),
  /** 심판에게 전달할 지시문. 사용자의 이의 사유가 그대로 인용된다 */
  instruction: z.string(),
  failClosedRecheck: z.boolean(),
});

export const jobPayloadSchema = z.discriminatedUnion('kind', [
  fullRunPayloadSchema,
  rerunPayloadSchema,
]);

export type JobPayload = z.infer<typeof jobPayloadSchema>;
export type RerunJobPayload = z.infer<typeof rerunPayloadSchema>;

/** 중복 실행되어도 결과가 1개만 발행되도록 잡 ID를 고정한다 */
export function jobIdFor(payload: JobPayload): string {
  return payload.kind === 'full_run'
    ? `run:${payload.runId}`
    : `rerun:${payload.objectionId}`;
}
