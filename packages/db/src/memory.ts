import { randomBytes } from 'node:crypto';
import type { ObjectionRecord, ObjectionRequest, RoundId, SurveySubmission } from '@tm/contracts';
import { roundRowId } from './ports.js';
import type {
  ApprovalRepository,
  ApprovalRow,
  CacheRecord,
  CacheRepository,
  CandidateRepository,
  CandidateRow,
  ConcessionEntry,
  ConcessionRepository,
  DataRequestLog,
  DispatchDecisionEntry,
  DispatchDecisionRepository,
  ItineraryRepository,
  ItineraryRow,
  LlmUsageEntry,
  LlmUsageRepository,
  LlmUsageTotals,
  MemberRepository,
  MemberRow,
  PackRepository,
  PackRow,
  PersonaRepository,
  PersonaRow,
  MessageRepository,
  MessageRow,
  ObjectionRepository,
  PlanningNodeRepository,
  PlanningNodeRow,
  Repositories,
  RoomRepository,
  RoomRow,
  RoundRecord,
  RunRepository,
  RunRow,
  ScoreRepository,
  ScoreRow,
  SurveyRepository,
  SurveyRow,
  VerdictRepository,
  VerdictRow,
} from './ports.js';

/**
 * 인메모리 구현. DATABASE_URL이 없을 때 쓴다.
 * 프로세스가 죽으면 사라진다 — 로컬 프론트 연동 확인 전용이며 운영에서 쓰지 않는다.
 */
export function createMemoryRepositories(): Repositories {
  let sequence = 0;
  const nextId = (prefix: string): string => {
    sequence += 1;
    return `${prefix}_${Date.now().toString(36)}${sequence.toString(36)}`;
  };
  const nextRoomId = (): string => `rm_${randomBytes(18).toString('base64url')}`;

  const rooms = new Map<string, RoomRow>();
  const surveys = new Map<string, SurveyRow>();
  const objections = new Map<string, ObjectionRecord>();

  const roomRepo: RoomRepository = {
    async create(packId, setting = {}) {
      const room: RoomRow = {
        roomId: nextRoomId(),
        packId,
        status: 'COLLECTING',
        setting,
        completedRounds: [],
        bookedNodes: [],
        deadlineAt: null,
        createdAt: new Date().toISOString(),
      };
      rooms.set(room.roomId, room);
      return room;
    },
    async get(roomId) {
      return rooms.get(roomId);
    },
    async updateStatus(roomId, status) {
      const room = rooms.get(roomId);
      if (room !== undefined) rooms.set(roomId, { ...room, status });
    },
    async updateSetting(roomId, patch) {
      const room = rooms.get(roomId);
      if (room !== undefined) rooms.set(roomId, { ...room, setting: { ...room.setting, ...patch } });
    },
    async markCompleted(roomId, completedRounds, budgetBaselinePerPersonKrw) {
      const room = rooms.get(roomId);
      if (room === undefined) return;
      rooms.set(roomId, {
        ...room,
        status: 'COMPLETED',
        completedRounds,
        ...(budgetBaselinePerPersonKrw === undefined ? {} : { budgetBaselinePerPersonKrw }),
      });
    },
  };

  /** (roomId, userId) → revision 오름차순 카드 목록. 덮어쓰지 않고 쌓는다 */
  const personaRows = new Map<string, PersonaRow[]>();
  const personaKey = (roomId: string, userId: string): string => `${roomId}:${userId}`;

  const personaRepo: PersonaRepository = {
    async save({ roomId, userId, card }) {
      const key = personaKey(roomId, userId);
      const history = personaRows.get(key) ?? [];
      const row: PersonaRow = {
        personaId: nextId('ps'),
        roomId,
        userId,
        card,
        style: card.voice.style,
        revision: history.length + 1,
        confirmedAt: null,
      };
      personaRows.set(key, [...history, row]);
      return row;
    },
    async latest(roomId, userId) {
      const history = personaRows.get(personaKey(roomId, userId)) ?? [];
      return history[history.length - 1];
    },
    async listByRoom(roomId) {
      return [...personaRows.entries()]
        .filter(([key]) => key.startsWith(`${roomId}:`))
        .flatMap(([, history]) => (history.length === 0 ? [] : [history[history.length - 1] as PersonaRow]));
    },
    async confirm(roomId, userId) {
      const key = personaKey(roomId, userId);
      const history = personaRows.get(key) ?? [];
      const last = history[history.length - 1];
      if (last === undefined) return undefined;
      const updated: PersonaRow = { ...last, confirmedAt: new Date().toISOString() };
      personaRows.set(key, [...history.slice(0, -1), updated]);
      return updated;
    },
  };

  const surveyRepo: SurveyRepository = {
    async save(roomId, userId, submission: SurveySubmission) {
      const existing = [...surveys.values()].find(
        (row) => row.roomId === roomId && row.userId === userId,
      );
      const row: SurveyRow = {
        surveyId: existing?.surveyId ?? nextId('sv'),
        roomId,
        userId,
        schemaVersion: submission.schemaVersion,
        payload: submission,
        allergens: submission.hardConstraints.allergies,
        submittedAt: new Date().toISOString(),
      };
      surveys.set(row.surveyId, row);
      return row;
    },
    async listByRoom(roomId) {
      return [...surveys.values()].filter((row) => row.roomId === roomId);
    },
    async isMember(roomId, userId) {
      return [...surveys.values()].some((row) => row.roomId === roomId && row.userId === userId);
    },
  };

  const objectionRepo: ObjectionRepository = {
    async save(request: ObjectionRequest, record) {
      const saved: ObjectionRecord = { ...record, objectionId: nextId('obj'), request };
      objections.set(saved.objectionId, saved);
      return saved;
    },
    async update(objectionId, patch) {
      const current = objections.get(objectionId);
      if (current === undefined) return undefined;
      const updated = { ...current, ...patch };
      objections.set(objectionId, updated);
      return updated;
    },
    async listByRoom(roomId) {
      return [...objections.values()].filter((record) => record.request.roomId === roomId);
    },
    async countedByRoom(roomId) {
      return (await this.listByRoom(roomId)).filter(
        (record) => record.status !== 'rejected' && record.status !== 'expired',
      );
    },
    async used(roomId, userId) {
      const counted = await this.countedByRoom(roomId);
      return {
        room: counted.length,
        user: counted.filter((record) => record.request.userId === userId).length,
      };
    },
  };

  const runs = new Map<string, RunRow>();
  /** runId → 실패 사유. 정상 완료면 기록하지 않는다 */
  const runFailures = new Map<string, string>();
  /** runId → roundId → 진행 기록 전체. 진행률 화면이 category·seq까지 읽는다 */
  const roundsByRun = new Map<string, Map<RoundId, RoundRecord>>();

  const syncCompletedRounds = (roomId: string): void => {
    const room = rooms.get(roomId);
    if (room === undefined) return;
    const settled = new Set<RoundId>();
    for (const run of runs.values()) {
      if (run.roomId !== roomId) continue;
      for (const [roundId, record] of roundsByRun.get(run.runId) ?? []) {
        if (record.phase === 'SETTLED') settled.add(roundId);
      }
    }
    rooms.set(roomId, { ...room, completedRounds: [...settled] });
  };

  const runRepo: RunRepository = {
    async start({ runId, roomId, trigger, objectionId = null }) {
      const existing = runs.get(runId);
      const run: RunRow = existing ?? {
        runId,
        roomId,
        seq: [...runs.values()].filter((row) => row.roomId === roomId).length + 1,
        trigger,
        status: 'RUNNING',
        objectionId,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      };
      runs.set(runId, { ...run, status: 'RUNNING', finishedAt: null });
      await roomRepo.updateStatus(roomId, 'RUNNING');
      return runs.get(runId) as RunRow;
    },
    async recordRound(record) {
      const bucket = roundsByRun.get(record.runId) ?? new Map<RoundId, RoundRecord>();
      bucket.set(record.roundId, { ...record, rerunCount: record.rerunCount ?? 0 });
      roundsByRun.set(record.runId, bucket);
      const run = runs.get(record.runId);
      if (run !== undefined) syncCompletedRounds(run.roomId);
    },
    async finish(runId, status, failureReason = null) {
      const run = runs.get(runId);
      if (run === undefined) return;
      runs.set(runId, { ...run, status, finishedAt: new Date().toISOString() });
      if (failureReason !== null) runFailures.set(runId, failureReason);
    },
    async get(runId) {
      return runs.get(runId);
    },
    async latestByRoom(roomId) {
      // seq는 방 안에서 단조 증가한다. 시각이 아니라 seq가 기준이다.
      return [...runs.values()]
        .filter((run) => run.roomId === roomId)
        .sort((a, b) => b.seq - a.seq)[0];
    },
    async listRounds(runId) {
      return [...(roundsByRun.get(runId) ?? new Map()).values()].sort((a, b) => a.seq - b.seq);
    },
    async failureReason(runId) {
      return runFailures.get(runId) ?? null;
    },
  };

  const cacheRecords = new Map<string, CacheRecord>();
  /** 테스트와 로컬 확인에서 호출 이력을 들여다볼 수 있게 남긴다 */
  const requestLog: DataRequestLog[] = [];

  const cacheRepo: CacheRepository & { entries(): DataRequestLog[] } = {
    async get(key) {
      return cacheRecords.get(key);
    },
    async put(record) {
      cacheRecords.set(record.key, record);
    },
    async purgeExpired() {
      const now = Date.now();
      let removed = 0;
      for (const [key, record] of cacheRecords) {
        if (record.validUntil !== null && Date.parse(record.validUntil) <= now) {
          cacheRecords.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
    async logRequest(entry) {
      requestLog.push(entry);
    },
    entries() {
      return requestLog;
    },
  };

  /** runId → nodeId → 버전 오름차순 이력 */
  const nodeHistory = new Map<string, Map<string, PlanningNodeRow[]>>();

  const planningNodeRepo: PlanningNodeRepository = {
    async listLatest(runId) {
      const byNode = nodeHistory.get(runId);
      if (byNode === undefined) return [];
      return [...byNode.values()]
        .map((versions) => versions[versions.length - 1])
        .filter((row): row is PlanningNodeRow => row !== undefined);
    },
    async appendVersions(runId, nodes) {
      const byNode = nodeHistory.get(runId) ?? new Map<string, PlanningNodeRow[]>();
      for (const node of nodes) {
        const versions = byNode.get(node.nodeId) ?? [];
        const existing = versions.findIndex((row) => row.version === node.version);
        const row: PlanningNodeRow = { ...node, runId, updatedAt: new Date().toISOString() };
        if (existing >= 0) versions[existing] = row;
        else versions.push(row);
        versions.sort((a, b) => a.version - b.version);
        byNode.set(node.nodeId, versions);
      }
      nodeHistory.set(runId, byNode);
    },
    async history(runId, nodeId) {
      return [...(nodeHistory.get(runId)?.get(nodeId) ?? [])];
    },
  };

  const packRows = new Map<string, PackRow>();

  const packRepo: PackRepository = {
    async upsert(pack) {
      const row: PackRow = {
        packId: pack.packId,
        coverage: pack.coverage,
        active: pack.active,
        pack,
        syncedAt: new Date().toISOString(),
      };
      packRows.set(pack.packId, row);
      return row;
    },
    async get(packId) {
      return packRows.get(packId);
    },
    async listActive() {
      return [...packRows.values()].filter((row) => row.active);
    },
    async providerPriority(packId) {
      return packRows.get(packId)?.pack.providers ?? {};
    },
  };

  const memberRows = new Map<string, MemberRow>();
  const memberKey = (roomId: string, userId: string): string => `${roomId}::${userId}`;

  /** 설문 제출 여부는 surveys가 원본이다 */
  const withSurvey = (row: MemberRow): MemberRow => ({
    ...row,
    surveySubmitted: [...surveys.values()].some(
      (survey) => survey.roomId === row.roomId && survey.userId === row.userId,
    ),
  });

  const memberRepo: MemberRepository = {
    async join(roomId, userId, role = 'member') {
      const key = memberKey(roomId, userId);
      const existing = memberRows.get(key);
      if (existing !== undefined) return withSurvey(existing);

      const row: MemberRow = {
        roomId,
        userId,
        role,
        surveySubmitted: false,
        personaConfirmedAt: null,
        joinedAt: new Date().toISOString(),
      };
      memberRows.set(key, row);
      return withSurvey(row);
    },
    async list(roomId) {
      return [...memberRows.values()]
        .filter((row) => row.roomId === roomId)
        .map(withSurvey)
        .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
    },
    async get(roomId, userId) {
      const row = memberRows.get(memberKey(roomId, userId));
      return row === undefined ? undefined : withSurvey(row);
    },
    async confirmPersona(roomId, userId) {
      const key = memberKey(roomId, userId);
      const row = memberRows.get(key);
      if (row === undefined) return undefined;
      const updated: MemberRow = { ...row, personaConfirmedAt: new Date().toISOString() };
      memberRows.set(key, updated);
      return withSurvey(updated);
    },
  };

  // ── 라운드에 매달린 저장소들 ─────────────────────────────────────────────
  // PostgreSQL 구현과 같은 계약을 만족해야 한다. 외래키가 없으므로 라운드 행 존재는
  // 검사하지 않지만, 키 조합 규칙(roundRowId)은 동일하게 쓴다.

  const candidateRows = new Map<string, Map<string, CandidateRow>>();

  const candidateRepo: CandidateRepository = {
    async saveMany(ref, rows) {
      const key = roundRowId(ref);
      const bucket = candidateRows.get(key) ?? new Map<string, CandidateRow>();
      const saved: CandidateRow[] = [];
      for (const row of rows) {
        const record: CandidateRow = {
          candidateId: `${key}:${row.externalId}`,
          externalId: row.externalId,
          provider: row.provider,
          payload: row.payload,
          disqualified: row.disqualified ?? false,
          disqualifyReason: row.disqualifyReason ?? null,
        };
        bucket.set(row.externalId, record);
        saved.push(record);
      }
      candidateRows.set(key, bucket);
      return saved;
    },
    async listByRound(ref) {
      return [...(candidateRows.get(roundRowId(ref))?.values() ?? [])].sort((a, b) =>
        a.externalId.localeCompare(b.externalId),
      );
    },
    async disqualify(ref, externalId, reason) {
      const row = candidateRows.get(roundRowId(ref))?.get(externalId);
      if (row === undefined) return;
      row.disqualified = true;
      row.disqualifyReason = reason;
    },
    async sourcedExternalIds(runId) {
      const ids = new Set<string>();
      for (const [key, bucket] of candidateRows) {
        if (!key.startsWith(`${runId}:`)) continue;
        for (const row of bucket.values()) ids.add(row.externalId);
      }
      return [...ids];
    },
  };

  const messageRows = new Map<string, MessageRow[]>();

  const messageRepo: MessageRepository = {
    async append(ref, message) {
      const key = roundRowId(ref);
      const bucket = messageRows.get(key) ?? [];
      const row: MessageRow = {
        roundId: ref.roundId,
        seq: bucket.length + 1,
        speakerType: message.speakerType,
        speakerId: message.speakerId,
        content: message.content,
        refs: message.refs ?? {},
        createdAt: new Date().toISOString(),
      };
      bucket.push(row);
      messageRows.set(key, bucket);
      return row;
    },
    async listByRound(ref) {
      return [...(messageRows.get(roundRowId(ref)) ?? [])];
    },
    async transcript(runId) {
      return [...messageRows.entries()]
        .filter(([key]) => key.startsWith(`${runId}:`))
        .flatMap(([, rows]) => rows)
        .sort((a, b) => (a.roundId === b.roundId ? a.seq - b.seq : a.roundId.localeCompare(b.roundId)));
    },
  };

  const verdictRows = new Map<string, VerdictRow>();

  const verdictRepo: VerdictRepository = {
    async save(ref, verdict, review) {
      const row: VerdictRow = {
        roundId: ref.roundId,
        verdict,
        minSatisfaction: verdict.minSatisfaction,
        satisfactionGap: verdict.satisfactionGap,
        review: review ?? { result: null, reasons: [] },
        createdAt: new Date().toISOString(),
      };
      verdictRows.set(roundRowId(ref), row);
      return row;
    },
    async get(ref) {
      return verdictRows.get(roundRowId(ref));
    },
    async listByRun(runId) {
      return [...verdictRows.entries()]
        .filter(([key]) => key.startsWith(`${runId}:`))
        .map(([, row]) => row)
        .sort((a, b) => a.roundId.localeCompare(b.roundId));
    },
  };

  const scoreRows = new Map<string, ScoreRow[]>();

  const scoreRepo: ScoreRepository = {
    async replaceRound(ref, rows) {
      scoreRows.set(roundRowId(ref), [...rows]);
    },
    async listByRound(ref) {
      return [...(scoreRows.get(roundRowId(ref)) ?? [])];
    },
  };

  const concessionRows: ConcessionEntry[] = [];

  const concessionRepo: ConcessionRepository = {
    async append(entry) {
      const duplicate = concessionRows.some(
        (row) =>
          row.roundId !== null &&
          row.roomId === entry.roomId &&
          row.userId === entry.userId &&
          row.roundId === entry.roundId,
      );
      if (duplicate) return;
      concessionRows.push(entry);
    },
    async creditsByRoom(roomId) {
      const credits: Record<string, number> = {};
      for (const row of concessionRows) {
        if (row.roomId === roomId) credits[row.userId] = row.ccAfter;
      }
      return credits;
    },
    async history(roomId) {
      return concessionRows.filter((row) => row.roomId === roomId);
    },
  };

  const dispatchRows: DispatchDecisionEntry[] = [];

  const dispatchRepo: DispatchDecisionRepository = {
    async record(entry) {
      const exists = dispatchRows.some((row) => row.runId === entry.runId && row.seq === entry.seq);
      if (exists) return;
      dispatchRows.push(entry);
    },
    async listByRun(runId) {
      return dispatchRows.filter((row) => row.runId === runId).sort((a, b) => a.seq - b.seq);
    },
    async fallbackRate(runId) {
      const rows = dispatchRows.filter((row) => row.runId === runId);
      const fallbacks = rows.filter((row) => row.fallbackUsed).length;
      return {
        decisions: rows.length,
        fallbacks,
        rate: rows.length === 0 ? 0 : fallbacks / rows.length,
      };
    },
  };

  const usageRows = new Map<string, LlmUsageEntry>();

  const sumUsage = (rows: LlmUsageEntry[]): LlmUsageTotals =>
    rows.reduce<LlmUsageTotals>(
      (totals, row) => ({
        calls: totals.calls + 1,
        costUsd: totals.costUsd + row.costUsd,
        inputTokens: totals.inputTokens + row.inputTokens,
        outputTokens: totals.outputTokens + row.outputTokens,
        cacheTokens: totals.cacheTokens + row.cacheTokens,
      }),
      { calls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0 },
    );

  const llmUsageRepo: LlmUsageRepository = {
    async record(entry) {
      // requestId가 멱등 키다. 재시도가 원가를 두 번 세면 상한 판단이 틀어진다.
      if (usageRows.has(entry.requestId)) return;
      usageRows.set(entry.requestId, entry);
    },
    async totals(runId) {
      return sumUsage([...usageRows.values()].filter((row) => row.runId === runId));
    },
    async byRoom(roomId) {
      return sumUsage([...usageRows.values()].filter((row) => row.roomId === roomId));
    },
  };

  const itineraryRows = new Map<string, ItineraryRow>();

  const itineraryRepo: ItineraryRepository = {
    async save(input) {
      const versions = [...itineraryRows.values()].filter((row) => row.roomId === input.roomId);
      const row: ItineraryRow = {
        ...input,
        itineraryId: nextId('itn'),
        version: versions.length + 1,
        publishedAt: null,
      };
      itineraryRows.set(row.itineraryId, row);
      return row;
    },
    async latest(roomId) {
      return [...itineraryRows.values()]
        .filter((row) => row.roomId === roomId)
        .sort((a, b) => b.version - a.version)[0];
    },
    async publish(itineraryId) {
      const row = itineraryRows.get(itineraryId);
      if (row !== undefined) row.publishedAt = new Date().toISOString();
    },
  };

  const approvalRows = new Map<string, ApprovalRow>();

  const approvalRepo: ApprovalRepository = {
    async raise(input) {
      const row: ApprovalRow = {
        ...input,
        approvalId: nextId('apr'),
        objectionId: input.objectionId ?? null,
        raisedAt: new Date().toISOString(),
        respondedAt: null,
        response: null,
      };
      approvalRows.set(row.approvalId, row);
      return row;
    },
    async respond(approvalId, response) {
      const row = approvalRows.get(approvalId);
      if (row === undefined) return undefined;
      const updated: ApprovalRow = {
        ...row,
        response,
        respondedAt: new Date().toISOString(),
      };
      approvalRows.set(approvalId, updated);
      return updated;
    },
    async pending(roomId) {
      return [...approvalRows.values()].filter(
        (row) => row.roomId === roomId && row.respondedAt === null,
      );
    },
  };

  return {
    kind: 'memory',
    rooms: roomRepo,
    surveys: surveyRepo,
    personas: personaRepo,
    objections: objectionRepo,
    runs: runRepo,
    cache: cacheRepo,
    planningNodes: planningNodeRepo,
    packs: packRepo,
    members: memberRepo,
    candidates: candidateRepo,
    messages: messageRepo,
    verdicts: verdictRepo,
    scores: scoreRepo,
    concessions: concessionRepo,
    dispatchDecisions: dispatchRepo,
    llmUsage: llmUsageRepo,
    itineraries: itineraryRepo,
    approvals: approvalRepo,
    async close() {
      nodeHistory.clear();
      rooms.clear();
      surveys.clear();
      objections.clear();
      runs.clear();
      roundsByRun.clear();
      cacheRecords.clear();
      requestLog.length = 0;
      packRows.clear();
      memberRows.clear();
      candidateRows.clear();
      messageRows.clear();
      verdictRows.clear();
      scoreRows.clear();
      concessionRows.length = 0;
      dispatchRows.length = 0;
      usageRows.clear();
      itineraryRows.clear();
      approvalRows.clear();
    },
  };
}

export type { RoundId };
