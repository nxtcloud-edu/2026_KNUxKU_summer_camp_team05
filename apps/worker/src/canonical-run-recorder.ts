import type { Repositories } from '@tm/db';
import type {
  CanonicalLiveRunInput,
  CanonicalLiveRunResult,
  CanonicalPersistedRun,
  CanonicalRunPersistencePort,
} from './canonical-live-run.js';

const RECORD_KIND = 'canonical-worker-run-v1';

interface StoredCanonicalResult {
  kind: typeof RECORD_KIND;
  result: CanonicalLiveRunResult;
}

function storedResult(value: unknown): CanonicalLiveRunResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Partial<StoredCanonicalResult>;
  if (record.kind !== RECORD_KIND || typeof record.result !== 'object' || record.result === null) {
    return null;
  }
  return record.result;
}

/**
 * Adapter for the existing repository contract. QUEUED is owned by the queue
 * producer; this adapter observes it and calls runs.start only at RUNNING.
 * Canonical artifacts are stored as a versioned itinerary JSON document so no
 * database schema change is required on the B5 branch.
 */
export function createCanonicalRunPersistence(
  repos: Repositories,
): CanonicalRunPersistencePort {
  const queuedInputs = new Map<string, CanonicalLiveRunInput>();

  return {
    async load(runId): Promise<CanonicalPersistedRun | null> {
      const run = await repos.runs.get(runId);
      if (run === undefined) return null;

      let result: CanonicalLiveRunResult | null = null;
      if (run.status === 'COMPLETED') {
        const itinerary = await repos.itineraries.latest(run.roomId);
        if (itinerary?.runId === runId) result = storedResult(itinerary.plan);
      }
      return { runId, executionStatus: run.status, result };
    },

    async markQueued(input): Promise<void> {
      queuedInputs.set(input.runId, input);
      const existing = await repos.runs.get(input.runId);
      if (existing?.status === 'RUNNING') {
        throw new Error(`Canonical run ${input.runId} is already RUNNING.`);
      }
    },

    async markRunning(runId): Promise<void> {
      const input = queuedInputs.get(runId);
      if (input === undefined) throw new Error(`Missing queued input for ${runId}.`);
      await repos.runs.start({
        runId,
        roomId: input.room.roomId,
        trigger: 'canonical_worker',
      });
    },

    async complete(result): Promise<void> {
      const input = queuedInputs.get(result.runId);
      const run = await repos.runs.get(result.runId);
      const roomId = input?.room.roomId ?? run?.roomId;
      if (roomId === undefined) throw new Error(`Missing room for ${result.runId}.`);

      const itinerary = await repos.itineraries.save({
        roomId,
        runId: result.runId,
        plan: { kind: RECORD_KIND, result } satisfies StoredCanonicalResult,
        validationReport: {
          canonicalResultStatus: result.resultStatus,
          failure: result.failure,
        },
      });
      if (result.resultStatus === 'VERIFIED') {
        await repos.itineraries.publish(itinerary.itineraryId);
      }
      await repos.runs.finish(result.runId, 'COMPLETED');
      await repos.rooms.updateStatus(roomId, 'COMPLETED');
      queuedInputs.delete(result.runId);
    },

    async fail(result): Promise<void> {
      await repos.runs.finish(result.runId, 'FAILED', result.failure?.message ?? 'Canonical run failed.');
      const input = queuedInputs.get(result.runId);
      const run = await repos.runs.get(result.runId);
      const roomId = input?.room.roomId ?? run?.roomId;
      if (roomId !== undefined) await repos.rooms.updateStatus(roomId, 'COMPLETED');
      queuedInputs.delete(result.runId);
    },
  };
}
