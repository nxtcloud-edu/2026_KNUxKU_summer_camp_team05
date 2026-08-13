import { roundIdToCategory, type ObjectionRecord, type RoundId } from '@tm/contracts';
import type { Repositories } from '@tm/db';
import type { JobPayload, RerunJobPayload } from './queue.js';
import type { RunState } from './orchestrator/loop.js';

/**
 * 실행 결과를 DB에 기록한다. 워커가 무엇을 했는지 남기지 않으면
 * 이의는 queued에서 영원히 멈추고, 사용자는 기다리다 아무 결과도 받지 못한다.
 *
 * 침묵 금지 원칙(agent-architecture.md 11장): 실패도 성공과 같은 비중으로 기록한다.
 */

/** 이의가 이미 처리되었으면 다시 실행하지 않는다 (objection-and-rerun.md O12) */
export async function alreadyApplied(
  repos: Repositories,
  payload: JobPayload,
): Promise<ObjectionRecord | null> {
  if (payload.kind !== 'rerun_from_objection') return null;
  const records = await repos.objections.listByRoom(payload.roomId);
  const record = records.find((row) => row.objectionId === payload.objectionId);
  return record !== undefined && record.status === 'applied' ? record : null;
}

export async function startRun(repos: Repositories, payload: JobPayload): Promise<void> {
  await repos.runs.start({
    runId: payload.runId,
    roomId: payload.roomId,
    trigger: payload.kind === 'full_run' ? payload.trigger : 'objection',
    objectionId: payload.kind === 'rerun_from_objection' ? payload.objectionId : null,
  });
}

export async function recordRoundSettled(
  repos: Repositories,
  runId: string,
  roundId: RoundId,
  seq: number,
): Promise<void> {
  await repos.runs.recordRound({
    runId,
    roundId,
    category: roundIdToCategory[roundId],
    seq,
    phase: 'SETTLED',
  });
}

/**
 * 재실행 결과 기록.
 *
 * 심판이 아직 실제 후보를 조달하지 않으므로 `changed`는 false이고 사유를 남긴다.
 * "다시 돌렸지만 같은 결론"도 정당한 결과이며, 사용자에게 그대로 노출한다
 * (objection-and-rerun.md 10장 · O11).
 */
export async function applyRerunOutcome(
  repos: Repositories,
  payload: RerunJobPayload,
  state: RunState,
  unresolvedReason: string | null,
): Promise<void> {
  await repos.objections.update(payload.objectionId, {
    status: 'applied',
    runId: payload.runId,
    resolvedAt: new Date().toISOString(),
    outcome: {
      changed: false,
      minSatisfactionBefore: null,
      minSatisfactionAfter: null,
      // 예산 완화는 심판이 실제로 반영했을 때만 채운다. 지금은 0.
      budgetDeltaPerPersonKrw: 0,
      unresolvedReason,
    },
  });
  await repos.rooms.markCompleted(payload.roomId, state.completedRounds);
}

/**
 * 최종 실패. 이의를 applied로 올리지 않는다 — 반영되지 않은 이의를 처리 완료로
 * 표시하면 사용자는 바뀐 게 없는 결과를 "반영됨"으로 읽는다.
 * 상태는 queued에 두고 사유만 남겨, 운영 알림과 재시도 경로가 처리하게 한다.
 */
export async function recordFailure(
  repos: Repositories,
  payload: JobPayload,
  reason: string,
): Promise<void> {
  await repos.runs.finish(payload.runId, 'FAILED', reason);
  await repos.rooms.updateStatus(payload.roomId, 'COMPLETED');
  if (payload.kind !== 'rerun_from_objection') return;
  await repos.objections.update(payload.objectionId, {
    outcome: {
      changed: false,
      minSatisfactionBefore: null,
      minSatisfactionAfter: null,
      budgetDeltaPerPersonKrw: 0,
      unresolvedReason: `재실행이 실패했습니다: ${reason}`,
    },
  });
}
