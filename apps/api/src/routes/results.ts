import type { FastifyInstance } from 'fastify';
import {
  planDocumentSchema,
  roundIdToCategory,
  type FairnessView,
  type MemberFairnessView,
  type PlanBlockerView,
  type PlanDayView,
  type PlanItemView,
  type PlanResult,
  type ResultAvailability,
  type ResultBadge,
  type ResultEnvelope,
  type RoomProgress,
  type RoundProgress,
  type RoundId,
  type TranscriptRoundView,
  type TranscriptView,
  type Verdict,
} from '@tm/contracts';
import { defaultRoundOrder } from '@tm/core';
import type { Repositories, RoomRow, RunRow } from '@tm/db';

/**
 * 결과 조회 — 사용자가 서비스와 만나는 네 지점 중 마지막.
 *
 * 이 라우트가 지키는 원칙은 하나다: **없는 것을 있는 것처럼 만들지 않는다.**
 * 에이전트 계층이 아직 결과를 만들지 않는 단계에서도 200을 돌려주되,
 * `availability`와 `reason`으로 왜 비어 있는지를 정확히 말한다. 목 데이터로 채우면
 * 프론트엔드는 영원히 자기가 진짜 데이터를 받고 있는지 알 수 없게 된다.
 *
 * 계약: packages/contracts/src/result.ts
 */

/** 아직 결과가 없을 때의 상태와 사유. run 상태 하나에서 전부 유도된다 */
function availabilityOf(
  room: RoomRow,
  run: RunRow | undefined,
  failureReason: string | null,
): { availability: ResultAvailability; reason: string } {
  if (run === undefined) {
    return room.status === 'COLLECTING'
      ? { availability: 'pending', reason: '아직 설문을 모으는 중입니다. 회의가 시작되지 않았습니다.' }
      : { availability: 'pending', reason: '회의가 아직 시작되지 않았습니다.' };
  }
  if (run.status === 'QUEUED') {
    return { availability: 'pending', reason: '회의가 대기열에 있습니다.' };
  }
  if (run.status === 'RUNNING') {
    return { availability: 'running', reason: '회의가 진행 중입니다.' };
  }
  if (run.status === 'FAILED') {
    return {
      availability: 'failed',
      reason: failureReason ?? '회의가 실패했습니다. 사유가 기록되지 않았습니다.',
    };
  }
  return { availability: 'partial', reason: '회의는 끝났지만 계획서가 아직 만들어지지 않았습니다.' };
}

const empty = <T>(availability: ResultAvailability, reason: string): ResultEnvelope<T> => ({
  availability,
  reason,
  data: null,
});

/** Validation Pass 결과(`unknown`으로 저장됨)에서 차단·경고만 안전하게 꺼낸다 */
function readBlockers(report: unknown, key: 'blockers' | 'warnings'): PlanBlockerView[] {
  if (typeof report !== 'object' || report === null) return [];
  const list = (report as Record<string, unknown>)[key];
  if (!Array.isArray(list)) return [];

  return list.flatMap((entry): PlanBlockerView[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row['kind'] !== 'string') return [];
    return [
      {
        kind: row['kind'],
        detail: typeof row['detail'] === 'string' ? row['detail'] : '',
        itemId: typeof row['itemId'] === 'string' ? row['itemId'] : null,
        nodeId: (typeof row['nodeId'] === 'string' ? row['nodeId'] : null) as PlanBlockerView['nodeId'],
        roundId: (typeof row['roundId'] === 'string' ? row['roundId'] : null) as PlanBlockerView['roundId'],
      },
    ];
  });
}

function readEvidenceStatus(report: unknown): 'PROVISIONAL' | 'VERIFIED' | null {
  if (typeof report !== 'object' || report === null) return null;
  const evidenceState = (report as Record<string, unknown>)['evidenceState'];
  if (typeof evidenceState !== 'object' || evidenceState === null) return null;
  const status = (evidenceState as Record<string, unknown>)['status'];
  return status === 'PROVISIONAL' || status === 'VERIFIED' ? status : null;
}

export async function registerResultRoutes(
  app: FastifyInstance,
  repos: Repositories,
): Promise<void> {
  /** 방 + 최신 run. 모든 결과 조회의 공통 진입점 */
  const load = async (roomId: string) => {
    const room = await repos.rooms.get(roomId);
    if (room === undefined) return undefined;
    const run = await repos.runs.latestByRoom(roomId);
    const failureReason = run === undefined ? null : await repos.runs.failureReason(run.runId);
    return { room, run, failureReason, ...availabilityOf(room, run, failureReason) };
  };

  /**
   * 진행 상태. 회의 진행 화면이 폴링한다.
   *
   * 조용한 실패가 비동기 모델의 최대 리스크다 — 멈춘 이유를 가공하지 않고 그대로 싣는다.
   */
  app.get('/api/rooms/:roomId/progress', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const loaded = await load(roomId);
    if (loaded === undefined) return reply.status(404).send({ error: 'room_not_found' });
    const { room, run, failureReason } = loaded;

    const records = run === undefined ? [] : await repos.runs.listRounds(run.runId);
    const rounds: RoundProgress[] = records.map((record) => ({
      roundId: record.roundId,
      category: record.category,
      phase: record.phase,
      seq: record.seq,
      rerunCount: record.rerunCount ?? 0,
      settled: record.phase === 'SETTLED',
    }));

    // 이의 재실행은 전체 라운드를 돌지 않는다. 분모를 전체로 잡으면 영원히 100%가 안 된다.
    const isRerun = run !== undefined && run.objectionId !== null;
    const totalRounds = isRerun
      ? Math.max(rounds.length, 1)
      : defaultRoundOrder.length;
    const settled = rounds.filter((round) => round.settled).length;

    const progress: RoomProgress = {
      roomId: room.roomId,
      packId: room.packId,
      roomStatus: room.status,
      runId: run?.runId ?? null,
      runStatus: run?.status ?? null,
      rounds,
      completedRounds: room.completedRounds,
      totalRounds,
      percent: totalRounds === 0 ? 0 : Math.round((settled / totalRounds) * 100),
      startedAt: run?.startedAt ?? null,
      finishedAt: run?.finishedAt ?? null,
      failureReason,
      pendingApprovals: (await repos.approvals.pending(roomId)).length,
    };
    return reply.send(progress);
  });

  /**
   * 최종 계획서.
   *
   * 배지는 코드가 판정한다. 발행되지 않은 계획서는 근거 상태에 따라 `PROVISIONAL` 또는
   * `PARTIAL`이며 예약 행동을 유도하지 않는다.
   */
  app.get('/api/rooms/:roomId/plan', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const loaded = await load(roomId);
    if (loaded === undefined) return reply.status(404).send({ error: 'room_not_found' });
    const { room, availability, reason } = loaded;

    const itinerary = await repos.itineraries.latest(roomId);
    if (itinerary === undefined) {
      return reply.send(empty<PlanResult>(availability, reason));
    }

    // 저장된 본문은 `unknown`이다. 계약과 다르면 화면에 흘리지 않고 사유를 남긴다.
    const parsed = planDocumentSchema.safeParse(itinerary.plan);
    if (!parsed.success) {
      return reply.send(
        empty<PlanResult>(
          'partial',
          `계획서 본문이 계약과 다릅니다 — ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
        ),
      );
    }

    const blockers = readBlockers(itinerary.validationReport, 'blockers');
    const warnings = readBlockers(itinerary.validationReport, 'warnings');
    const blockedItemIds = new Set(
      blockers.map((blocker) => blocker.itemId).filter((id): id is string => id !== null),
    );
    const published = itinerary.publishedAt !== null;
    const evidenceStatus = readEvidenceStatus(itinerary.validationReport);
    const unpublishedBadge: ResultBadge = evidenceStatus === 'PROVISIONAL' ? 'PROVISIONAL' : 'PARTIAL';
    const bookedNodes = new Set(room.bookedNodes);

    /**
     * 항목 배지.
     * BOOKABLE은 만들지 않는다 — 가격·재고·시간 슬롯 확인이 붙기 전에는 주장할 수 없다.
     */
    const badgeOf = (item: { itemId: string; nodeId: PlanItemView['nodeId'] }): ResultBadge => {
      if (bookedNodes.has(item.nodeId)) return 'BOOKED';
      if (blockedItemIds.has(item.itemId)) return 'DRAFT';
      return published ? 'VERIFIED' : unpublishedBadge;
    };

    const days: PlanDayView[] = parsed.data.days.map((day) => {
      const items: PlanItemView[] = day.items.map((item) => ({
        ...item,
        badge: badgeOf(item),
      }));
      const travelMinutes = items.reduce<number | null>((sum, item) => {
        if (item.travelMinutesFromPrev === null) return sum;
        return (sum ?? 0) + item.travelMinutesFromPrev;
      }, null);

      return {
        day: day.day,
        date: day.date,
        title: day.title,
        items,
        totals: {
          costPerPersonKrw: items.reduce((sum, item) => sum + item.costPerPersonKrw, 0),
          travelMinutes,
          // 도보 거리는 아직 조달하지 않는다. 0으로 위장하지 않고 미측정으로 둔다.
          walkMeters: null,
        },
      };
    });

    const plan: PlanResult = {
      roomId,
      runId: itinerary.runId,
      itineraryId: itinerary.itineraryId,
      version: itinerary.version,
      publishedAt: itinerary.publishedAt,
      badge: published ? 'VERIFIED' : unpublishedBadge,
      dateRange: parsed.data.dateRange,
      headline: parsed.data.headline,
      days,
      budget: parsed.data.budget,
      blockers,
      warnings,
      uncertainties: parsed.data.uncertainties,
    };

    return reply.send({
      availability: published ? 'ready' : 'partial',
      reason: published
        ? null
        : evidenceStatus === 'PROVISIONAL'
          ? '문서 검증은 통과했지만 LIVE 검증 영수증이 없어 잠정 결과로 표시합니다.'
          : (blockers[0]?.detail ?? '검증을 통과하지 못해 부분 계획서로 표시합니다.'),
      data: plan,
    } satisfies ResultEnvelope<PlanResult>);
  });

  /**
   * 회의록 전문. "왜 이 결정인가"가 남는 곳이며 이의 제기 앵커의 재료다.
   * 아직 판결이 없는 라운드도 숨기지 않는다 — 어디까지 진행됐는지가 보여야 한다.
   */
  app.get('/api/rooms/:roomId/transcript', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const loaded = await load(roomId);
    if (loaded === undefined) return reply.status(404).send({ error: 'room_not_found' });
    const { run, availability, reason } = loaded;
    if (run === undefined) return reply.send(empty<TranscriptView>(availability, reason));

    const [messages, verdicts, records, fallback] = await Promise.all([
      repos.messages.transcript(run.runId),
      repos.verdicts.listByRun(run.runId),
      repos.runs.listRounds(run.runId),
      repos.dispatchDecisions.fallbackRate(run.runId),
    ]);

    const verdictByRound = new Map(verdicts.map((row) => [row.roundId, row.verdict as Verdict]));
    // 라운드 행이 없어도 발화가 있으면 회의록에 나와야 한다.
    const roundIds: RoundId[] = [
      ...new Set([...records.map((record) => record.roundId), ...messages.map((row) => row.roundId)]),
    ].sort((a, b) => defaultRoundOrder.indexOf(a) - defaultRoundOrder.indexOf(b));

    const rounds: TranscriptRoundView[] = await Promise.all(
      roundIds.map(async (roundId): Promise<TranscriptRoundView> => {
        const record = records.find((row) => row.roundId === roundId);
        const scores = await repos.scores.listByRound({ runId: run.runId, roundId });
        return {
          roundId,
          category: record?.category ?? roundIdToCategory[roundId],
          phase: record?.phase ?? 'PENDING',
          messages: messages
            .filter((row) => row.roundId === roundId)
            .map((row) => ({
              roundId: row.roundId,
              seq: row.seq,
              speakerType: row.speakerType,
              speakerId: row.speakerId,
              // TODO(members): 참여자 표시 이름이 스키마에 없다. 붙으면 여기서 매핑한다.
              speakerName: row.speakerId ?? row.speakerType,
              content: row.content,
              refs: row.refs,
              createdAt: row.createdAt,
            })),
          verdict: verdictByRound.get(roundId) ?? null,
          scores: scores.map((score) => ({
            candidateId: score.candidateId,
            userId: score.userId,
            satisfaction: score.satisfaction,
          })),
        };
      }),
    );

    const transcript: TranscriptView = {
      roomId,
      runId: run.runId,
      rounds,
      fallbackRate: fallback.rate,
    };

    return reply.send({
      // 발화가 하나도 없으면 회의록이 있다고 말하지 않는다.
      availability: messages.length === 0 ? availability : 'ready',
      reason: messages.length === 0 ? reason : null,
      data: transcript,
    } satisfies ResultEnvelope<TranscriptView>);
  });

  /**
   * 만족도·양보·소수 의견.
   *
   * 만족도는 **채택된 후보에 대한 값**이다. 총합이 아니라 최솟값이 기준이며(Maximin),
   * 선택되지 않은 의견도 기록에 남는다.
   */
  app.get('/api/rooms/:roomId/fairness', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const loaded = await load(roomId);
    if (loaded === undefined) return reply.status(404).send({ error: 'room_not_found' });
    const { run, availability, reason } = loaded;
    if (run === undefined) return reply.send(empty<FairnessView>(availability, reason));

    const [members, verdicts, credits, history] = await Promise.all([
      repos.members.list(roomId),
      repos.verdicts.listByRun(run.runId),
      repos.concessions.creditsByRoom(roomId),
      repos.concessions.history(roomId),
    ]);

    /** userId → roundId → 채택 후보에 대한 만족도 */
    const byUser = new Map<string, Partial<Record<RoundId, number>>>();
    for (const row of verdicts) {
      const winners = new Set(row.verdict.winner.candidateIds);
      if (winners.size === 0) continue;
      const scores = await repos.scores.listByRound({ runId: run.runId, roundId: row.roundId });
      for (const score of scores) {
        if (!winners.has(score.candidateId)) continue;
        const bucket = byUser.get(score.userId) ?? {};
        bucket[row.roundId] = score.satisfaction;
        byUser.set(score.userId, bucket);
      }
    }

    const memberViews: MemberFairnessView[] = members.map((member): MemberFairnessView => {
      const perRound = byUser.get(member.userId) ?? {};
      const values = Object.values(perRound).filter((value): value is number => value !== undefined);
      return {
        userId: member.userId,
        // TODO(members): 표시 이름 컬럼이 없다. 붙기 전까지 식별자를 그대로 쓴다.
        displayName: member.userId,
        satisfaction:
          values.length === 0
            ? null
            : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10,
        perRound,
        concessionCredit: credits[member.userId] ?? 0,
        concessions: history
          .filter((entry) => entry.userId === member.userId)
          .map((entry) => ({ roundId: entry.roundId, delta: entry.delta })),
      };
    });

    const satisfactions = memberViews
      .map((member) => member.satisfaction)
      .filter((value): value is number => value !== null);

    const fairness: FairnessView = {
      roomId,
      runId: run.runId,
      members: memberViews,
      minSatisfaction: satisfactions.length === 0 ? null : Math.min(...satisfactions),
      satisfactionGap:
        satisfactions.length === 0 ? null : Math.max(...satisfactions) - Math.min(...satisfactions),
      dissents: verdicts.flatMap((row) =>
        row.verdict.dissent.map((entry) => ({
          roundId: row.roundId,
          userId: entry.userId,
          reason: entry.reason,
          mitigation: entry.mitigation,
        })),
      ),
    };

    return reply.send({
      availability: satisfactions.length === 0 ? availability : 'ready',
      reason: satisfactions.length === 0 ? reason : null,
      data: fairness,
    } satisfies ResultEnvelope<FairnessView>);
  });
}
