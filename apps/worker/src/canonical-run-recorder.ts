import { planDocumentSchema, type PlanDocument } from '@tm/contracts';
import type { Repositories } from '@tm/db';
import type {
  CanonicalLiveRunInput,
  CanonicalLiveRunResult,
  CanonicalPersistedRun,
  CanonicalRunPersistencePort,
} from './canonical-live-run.js';

const RECORD_KIND = 'canonical-worker-run-v1';

export interface StoredCanonicalResult {
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

function canonicalResultFromReport(value: unknown): CanonicalLiveRunResult | null {
  if (typeof value !== 'object' || value === null) return null;
  return storedResult((value as Record<string, unknown>)['canonical']);
}

function planDocumentOf(result: CanonicalLiveRunResult): PlanDocument {
  const artifacts = result.artifacts;
  if (artifacts === null) {
    return planDocumentSchema.parse({
      headline: result.failure?.message ?? '안전하게 확정할 수 있는 숙소 결과가 없습니다.',
      dateRange: null,
      days: [],
      budget: {
        declaredTotalPerPersonKrw: 0,
        groupCapPerPersonKrw: 0,
        byNode: {},
      },
      uncertainties: [result.failure?.code ?? 'CANONICAL_RESULT_BLOCKED'],
    });
  }
  const selected = artifacts.proposalSet.proposals.find(
    (proposal) => proposal.proposalId === artifacts.selection.selectedProposalId,
  );
  const participantCosts = selected === undefined ? [] : Object.values(selected.costByParticipantKrw);
  const perParticipant = participantCosts.length === 0
    ? 0
    : Math.round(participantCosts.reduce((sum, cost) => sum + cost, 0) / participantCosts.length);
  const groupCap = Math.min(...Object.values(artifacts.charter.budgetMaxByParticipantKrw));
  return planDocumentSchema.parse({
    headline: artifacts.finalPlan.summary,
    dateRange: { start: artifacts.charter.startDate, end: artifacts.charter.endDate },
    days: selected === undefined ? [] : [{
      day: 1,
      date: artifacts.charter.startDate,
      title: '숙소 결정',
      items: [{
        itemId: selected.proposalId,
        nodeId: 'accommodation',
        externalId: null,
        title: selected.summary,
        detail: `${artifacts.charter.partySize}명 · 총 ${selected.totalCostKrw.toLocaleString('ko-KR')}원`,
        startAt: null,
        endAt: null,
        costPerPersonKrw: perParticipant,
        bookingUrl: null,
        travelMinutesFromPrev: selected.travelBurdenMinutes,
        caution: artifacts.finalPlan.status === 'VERIFIED' ? null : '예약 전 가격·재고를 다시 확인하세요.',
      }],
    }],
    budget: {
      declaredTotalPerPersonKrw: perParticipant,
      groupCapPerPersonKrw: Number.isFinite(groupCap) ? groupCap : 0,
      byNode: { accommodation: perParticipant },
    },
    uncertainties: artifacts.finalPlan.unresolvedIssues,
  });
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
        if (itinerary?.runId === runId) {
          result = canonicalResultFromReport(itinerary.validationReport) ?? storedResult(itinerary.plan);
        }
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

      await repos.runs.recordRound({
        runId: result.runId,
        roundId: 'r_2',
        category: 'accommodation',
        seq: 2,
        phase: result.artifacts === null ? 'FAILED' : 'SETTLED',
      });
      await repos.messages.append(
        { runId: result.runId, roundId: 'r_2' },
        {
          speakerType: 'system',
          speakerId: 'canonical-worker',
          content: result.artifacts === null
            ? `숙소 canonical 경로가 결과를 확정하지 못했습니다: ${result.failure?.message ?? '차단 사유 없음'}`
            : `숙소 canonical 경로가 ${result.artifacts.selection.selectedProposalId} 제안을 선택했습니다. 결과 상태는 ${result.resultStatus}입니다.`,
          refs: result.artifacts === null
            ? { failureCode: result.failure?.code ?? null }
            : {
                proposalSetVersion: result.artifacts.proposalSet.proposalSetVersion,
                selectedProposalId: result.artifacts.selection.selectedProposalId,
                resultStatus: result.resultStatus,
              },
        },
      );

      const itinerary = await repos.itineraries.save({
        roomId,
        runId: result.runId,
        plan: planDocumentOf(result),
        validationReport: {
          canonical: { kind: RECORD_KIND, result } satisfies StoredCanonicalResult,
          canonicalResultStatus: result.resultStatus,
          evidenceState: {
            status: result.resultStatus === 'VERIFIED' ? 'VERIFIED' : 'PROVISIONAL',
          },
          blockers: result.failure === null ? [] : [{
            kind: result.failure.code,
            detail: result.failure.message,
            itemId: null,
            nodeId: null,
            roundId: null,
          }],
          warnings: [],
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
