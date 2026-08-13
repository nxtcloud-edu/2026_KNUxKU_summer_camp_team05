import type {
  ObjectionRecord,
  ObjectionRequest,
  PlanningNodeId,
  RoundId,
  Verdict,
} from '@tm/contracts';
import { closePool, query, queryOne, withTransaction } from './client.js';
import { roundRowId } from './ports.js';
import type {
  ApprovalRepository,
  ApprovalRow,
  CacheRecord,
  CacheRepository,
  CandidateRepository,
  CandidateRow,
  ConcessionRepository,
  DispatchDecisionEntry,
  DispatchDecisionRepository,
  ItineraryRepository,
  ItineraryRow,
  LlmUsageRepository,
  LlmUsageTotals,
  MemberRepository,
  MemberRow,
  MessageRepository,
  MessageRow,
  ObjectionRepository,
  PlanningNodeRepository,
  PlanningNodeRow,
  Repositories,
  RoomRepository,
  RoomRow,
  RunRepository,
  RunRow,
  ScoreRepository,
  SurveyRepository,
  SurveyRow,
  VerdictRepository,
  VerdictRow,
} from './ports.js';

interface RoomDbRow {
  id: string;
  pack_id: string;
  status: string;
  setting: Record<string, unknown>;
  deadline_at: Date | null;
  created_at: Date;
}

interface ObjectionDbRow {
  id: string;
  request: ObjectionRequest;
  impact: ObjectionRecord['impact'];
  status: string;
  reject_reason: string | null;
  run_id: string | null;
  outcome: ObjectionRecord['outcome'];
  submitted_at: Date;
  resolved_at: Date | null;
}

let sequence = 0;
const nextId = (prefix: string): string => {
  sequence += 1;
  return `${prefix}_${Date.now().toString(36)}${sequence.toString(36)}`;
};

/**
 * 실행 결과에서 완료 라운드와 예약 잠금 노드를 읽는다.
 * 이의 심사가 필요한 최소 정보만 조회한다.
 */
async function loadRunFacts(
  roomId: string,
): Promise<{ completedRounds: RoundId[]; bookedNodes: PlanningNodeId[] }> {
  const rounds = await query<{ round_id: string }>(
    `SELECT DISTINCT r.round_id
       FROM rounds r
       JOIN runs ru ON ru.id = r.run_id
      WHERE ru.room_id = $1 AND r.phase = 'SETTLED'`,
    [roomId],
  );
  const nodes = await query<{ node_id: string }>(
    `SELECT DISTINCT p.node_id
       FROM planning_nodes p
       JOIN runs ru ON ru.id = p.run_id
      WHERE ru.room_id = $1 AND (p.status = 'BOOKED' OR p.locked = true)`,
    [roomId],
  );
  return {
    completedRounds: rounds.map((row) => row.round_id as RoundId),
    bookedNodes: nodes.map((row) => row.node_id as PlanningNodeId),
  };
}

export function createPostgresRepositories(): Repositories {
  const rooms: RoomRepository = {
    async create(packId, setting = {}) {
      const id = nextId('rm');
      const row = await queryOne<RoomDbRow>(
        `INSERT INTO rooms (id, pack_id, setting) VALUES ($1, $2, $3::jsonb)
         RETURNING id, pack_id, status, setting, deadline_at, created_at`,
        [id, packId, JSON.stringify(setting)],
      );
      if (row === undefined) throw new Error('방 생성 실패');
      return {
        roomId: row.id,
        packId: row.pack_id,
        status: row.status as RoomRow['status'],
        setting: row.setting,
        completedRounds: [],
        bookedNodes: [],
        deadlineAt: row.deadline_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
      };
    },

    async get(roomId) {
      const row = await queryOne<RoomDbRow & { budget_baseline: number | null }>(
        `SELECT id, pack_id, status, setting, deadline_at, created_at,
                (setting->>'budgetPerPersonKrw')::int AS budget_baseline
           FROM rooms WHERE id = $1`,
        [roomId],
      );
      if (row === undefined) return undefined;
      const facts = await loadRunFacts(roomId);
      return {
        roomId: row.id,
        packId: row.pack_id,
        status: row.status as RoomRow['status'],
        setting: row.setting,
        completedRounds: facts.completedRounds,
        bookedNodes: facts.bookedNodes,
        ...(row.budget_baseline === null
          ? {}
          : { budgetBaselinePerPersonKrw: row.budget_baseline }),
        deadlineAt: row.deadline_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
      };
    },

    async updateStatus(roomId, status) {
      await query('UPDATE rooms SET status = $2 WHERE id = $1', [roomId, status]);
    },

    async markCompleted(roomId, _completedRounds, budgetBaselinePerPersonKrw) {
      // 완료 라운드는 rounds 테이블이 원본이므로 여기서 덮어쓰지 않는다.
      await query(
        `UPDATE rooms
            SET status = 'COMPLETED',
                completed_at = now(),
                setting = CASE WHEN $2::int IS NULL THEN setting
                               ELSE jsonb_set(setting, '{budgetPerPersonKrw}', to_jsonb($2::int)) END
          WHERE id = $1`,
        [roomId, budgetBaselinePerPersonKrw ?? null],
      );
    },
  };

  const surveys: SurveyRepository = {
    async save(roomId, userId, submission) {
      const id = nextId('sv');
      const row = await queryOne<{
        id: string;
        schema_version: number;
        allergens: string[];
        submitted_at: Date;
      }>(
        `INSERT INTO surveys (id, room_id, user_id, schema_version, payload, allergens)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (room_id, user_id) DO UPDATE
           SET schema_version = EXCLUDED.schema_version,
               payload = EXCLUDED.payload,
               allergens = EXCLUDED.allergens,
               submitted_at = now()
         RETURNING id, schema_version, allergens, submitted_at`,
        [
          id,
          roomId,
          userId,
          submission.schemaVersion,
          JSON.stringify(submission),
          submission.hardConstraints.allergies,
        ],
      );
      if (row === undefined) throw new Error('설문 저장 실패');
      return {
        surveyId: row.id,
        roomId,
        userId,
        schemaVersion: row.schema_version,
        payload: submission,
        allergens: row.allergens,
        submittedAt: row.submitted_at.toISOString(),
      };
    },

    async listByRoom(roomId) {
      const rows = await query<{
        id: string;
        user_id: string;
        schema_version: number;
        payload: SurveyRow['payload'];
        allergens: string[];
        submitted_at: Date;
      }>(
        `SELECT id, user_id, schema_version, payload, allergens, submitted_at
           FROM surveys WHERE room_id = $1 ORDER BY submitted_at`,
        [roomId],
      );
      return rows.map((row) => ({
        surveyId: row.id,
        roomId,
        userId: row.user_id,
        schemaVersion: row.schema_version,
        payload: row.payload,
        allergens: row.allergens,
        submittedAt: row.submitted_at.toISOString(),
      }));
    },

    async isMember(roomId, userId) {
      const row = await queryOne<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM surveys WHERE room_id = $1 AND user_id = $2
           UNION SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2
         ) AS exists`,
        [roomId, userId],
      );
      return row?.exists ?? false;
    },
  };

  const toRecord = (row: ObjectionDbRow): ObjectionRecord => ({
    objectionId: row.id,
    request: row.request,
    status: row.status as ObjectionRecord['status'],
    rejectReason: row.reject_reason as ObjectionRecord['rejectReason'],
    impact: row.impact,
    runId: row.run_id,
    submittedAt: row.submitted_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    outcome: row.outcome,
  });

  const objections: ObjectionRepository = {
    async save(request, record) {
      const id = nextId('obj');
      const row = await queryOne<ObjectionDbRow>(
        `INSERT INTO objections
           (id, room_id, user_id, target_round_id, target_category, kind, reason,
            request, impact, status, reject_reason, run_id, outcome)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13::jsonb)
         RETURNING id, request, impact, status, reject_reason, run_id, outcome,
                   submitted_at, resolved_at`,
        [
          id,
          request.roomId,
          request.userId,
          request.targetRoundId,
          request.targetCategory,
          request.kind,
          request.reason,
          JSON.stringify(request),
          record.impact === null ? null : JSON.stringify(record.impact),
          record.status,
          record.rejectReason,
          record.runId,
          record.outcome === null ? null : JSON.stringify(record.outcome),
        ],
      );
      if (row === undefined) throw new Error('이의 저장 실패');
      return toRecord(row);
    },

    async update(objectionId, patch) {
      const row = await queryOne<ObjectionDbRow>(
        `UPDATE objections
            SET status = COALESCE($2, status),
                run_id = COALESCE($3, run_id),
                outcome = COALESCE($4::jsonb, outcome),
                resolved_at = CASE WHEN $5::boolean THEN now() ELSE resolved_at END
          WHERE id = $1
         RETURNING id, request, impact, status, reject_reason, run_id, outcome,
                   submitted_at, resolved_at`,
        [
          objectionId,
          patch.status ?? null,
          patch.runId ?? null,
          patch.outcome === undefined || patch.outcome === null ? null : JSON.stringify(patch.outcome),
          patch.resolvedAt !== undefined && patch.resolvedAt !== null,
        ],
      );
      return row === undefined ? undefined : toRecord(row);
    },

    async listByRoom(roomId) {
      const rows = await query<ObjectionDbRow>(
        `SELECT id, request, impact, status, reject_reason, run_id, outcome,
                submitted_at, resolved_at
           FROM objections WHERE room_id = $1 ORDER BY submitted_at`,
        [roomId],
      );
      return rows.map(toRecord);
    },

    async countedByRoom(roomId) {
      const rows = await query<ObjectionDbRow>(
        `SELECT id, request, impact, status, reject_reason, run_id, outcome,
                submitted_at, resolved_at
           FROM objections
          WHERE room_id = $1 AND status NOT IN ('rejected','expired')
          ORDER BY submitted_at`,
        [roomId],
      );
      return rows.map(toRecord);
    },

    async used(roomId, userId) {
      const row = await queryOne<{ room: string; user: string }>(
        `SELECT COUNT(*) AS room,
                COUNT(*) FILTER (WHERE user_id = $2) AS user
           FROM objections
          WHERE room_id = $1 AND status NOT IN ('rejected','expired')`,
        [roomId, userId],
      );
      return { room: Number(row?.room ?? 0), user: Number(row?.user ?? 0) };
    },
  };

  interface RunDbRow {
    id: string;
    room_id: string;
    seq: number;
    trigger: string;
    status: string;
    objection_id: string | null;
    started_at: Date | null;
    finished_at: Date | null;
  }

  const toRun = (row: RunDbRow): RunRow => ({
    runId: row.id,
    roomId: row.room_id,
    seq: row.seq,
    trigger: row.trigger,
    status: row.status as RunRow['status'],
    objectionId: row.objection_id,
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
  });

  const runs: RunRepository = {
    async start({ runId, roomId, trigger, objectionId = null }) {
      // 잡이 재시도되면 같은 runId로 다시 들어온다. seq를 새로 발급하지 않고 상태만 올린다.
      const row = await queryOne<RunDbRow & { inserted: boolean }>(
        `INSERT INTO runs (id, room_id, seq, trigger, status, objection_id, started_at)
         SELECT $1, $2, COALESCE(MAX(seq), 0) + 1, $3, 'RUNNING', $4, now()
           FROM runs WHERE room_id = $2
         ON CONFLICT (id) DO UPDATE
           SET status = 'RUNNING',
               started_at = COALESCE(runs.started_at, now()),
               finished_at = NULL,
               failure_reason = NULL
         RETURNING id, room_id, seq, trigger, status, objection_id, started_at, finished_at,
                   (xmax = 0) AS inserted`,
        [runId, roomId, trigger, objectionId],
      );
      if (row === undefined) throw new Error('run 생성 실패');
      // 재시도로 같은 run이 다시 들어온 경우 run_count를 올리지 않는다.
      await query(
        `UPDATE rooms SET status = 'RUNNING', run_count = run_count + $2 WHERE id = $1`,
        [roomId, row.inserted ? 1 : 0],
      );
      return toRun(row);
    },

    async recordRound({ runId, roundId, category, seq, phase, rerunCount = 0 }) {
      await query(
        `INSERT INTO rounds (id, run_id, round_id, category, seq, phase, rerun_count, started_at, ended_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now(), CASE WHEN $6 IN ('SETTLED','FAILED') THEN now() END)
         ON CONFLICT (id) DO UPDATE
           SET phase = EXCLUDED.phase,
               rerun_count = EXCLUDED.rerun_count,
               ended_at = CASE WHEN EXCLUDED.phase IN ('SETTLED','FAILED') THEN now() ELSE NULL END`,
        [`${runId}:${roundId}`, runId, roundId, category, seq, phase, rerunCount],
      );
    },

    async finish(runId, status, failureReason = null) {
      await query(
        `UPDATE runs SET status = $2, failure_reason = $3, finished_at = now() WHERE id = $1`,
        [runId, status, failureReason],
      );
    },

    async get(runId) {
      const row = await queryOne<RunDbRow>(
        `SELECT id, room_id, seq, trigger, status, objection_id, started_at, finished_at
           FROM runs WHERE id = $1`,
        [runId],
      );
      return row === undefined ? undefined : toRun(row);
    },
  };

  const cache: CacheRepository = {
    async get(key) {
      const row = await queryOne<{
        cache_key: string;
        pack_id: string;
        query_class: string;
        payload: unknown;
        source: string;
        confidence: string;
        terms_ref: string | null;
        raw_ref: string | null;
        retrieved_at: Date;
        valid_until: Date | null;
      }>(
        `SELECT cache_key, pack_id, query_class, payload, source, confidence,
                terms_ref, raw_ref, retrieved_at, valid_until
           FROM pack_cache WHERE cache_key = $1`,
        [key],
      );
      if (row === undefined) return undefined;
      return {
        key: row.cache_key,
        packId: row.pack_id,
        queryClass: row.query_class,
        payload: row.payload,
        source: row.source,
        confidence: row.confidence as CacheRecord['confidence'],
        termsRef: row.terms_ref,
        rawRef: row.raw_ref,
        retrievedAt: row.retrieved_at.toISOString(),
        validUntil: row.valid_until?.toISOString() ?? null,
      };
    },

    async put(record) {
      await query(
        `INSERT INTO pack_cache
           (cache_key, pack_id, query_class, payload, source, confidence, terms_ref, raw_ref, retrieved_at, valid_until)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (cache_key) DO UPDATE
           SET payload = EXCLUDED.payload,
               source = EXCLUDED.source,
               confidence = EXCLUDED.confidence,
               terms_ref = EXCLUDED.terms_ref,
               raw_ref = EXCLUDED.raw_ref,
               retrieved_at = EXCLUDED.retrieved_at,
               valid_until = EXCLUDED.valid_until`,
        [
          record.key,
          record.packId,
          record.queryClass,
          JSON.stringify(record.payload),
          record.source,
          record.confidence,
          record.termsRef,
          record.rawRef,
          record.retrievedAt,
          record.validUntil,
        ],
      );
    },

    async purgeExpired() {
      const rows = await query<{ cache_key: string }>(
        `DELETE FROM pack_cache WHERE valid_until IS NOT NULL AND valid_until <= now()
         RETURNING cache_key`,
      );
      return rows.length;
    },

    async logRequest(entry) {
      await query(
        `INSERT INTO data_requests
           (run_id, round_id, caller_id, query_class, purpose, canonical_hash,
            cache_hit, confidence, degraded, fallback_reason, provider, latency_ms, cost_usd, response_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          entry.runId,
          entry.roundId,
          entry.callerId,
          entry.queryClass,
          entry.purpose,
          entry.canonicalHash,
          entry.cacheHit,
          entry.confidence,
          entry.degraded,
          entry.fallbackReason ?? null,
          entry.provider ?? null,
          entry.latencyMs ?? null,
          entry.costUsd ?? null,
          entry.responseHash ?? null,
        ],
      );
    },
  };

  interface PlanningNodeDbRow {
    run_id: string;
    node_id: string;
    version: number;
    input_hash: string;
    dependency_versions: Record<string, number>;
    status: string;
    confidence: string;
    evidence_refs: string[];
    locked: boolean;
    updated_at: Date;
  }

  const toPlanningNode = (row: PlanningNodeDbRow): PlanningNodeRow => ({
    runId: row.run_id,
    nodeId: row.node_id as PlanningNodeRow['nodeId'],
    version: row.version,
    status: row.status as PlanningNodeRow['status'],
    confidence: row.confidence as PlanningNodeRow['confidence'],
    inputHash: row.input_hash,
    dependencyVersions: row.dependency_versions,
    evidenceRefs: row.evidence_refs,
    locked: row.locked,
    updatedAt: row.updated_at.toISOString(),
  });

  const planningNodes: PlanningNodeRepository = {
    async listLatest(runId) {
      // 노드별 최신 버전만. DISTINCT ON은 ORDER BY 첫 컬럼과 일치해야 한다.
      const rows = await query<PlanningNodeDbRow>(
        `SELECT DISTINCT ON (node_id)
                run_id, node_id, version, input_hash, dependency_versions,
                status, confidence, evidence_refs, locked, updated_at
           FROM planning_nodes
          WHERE run_id = $1
          ORDER BY node_id, version DESC`,
        [runId],
      );
      return rows.map(toPlanningNode);
    },

    async appendVersions(runId, nodes) {
      if (nodes.length === 0) return;
      // 같은 (run, node, version)이 다시 들어오면 덮어쓴다. 잡 재시도가 실패하지 않도록.
      await withTransaction(async (client) => {
        for (const node of nodes) {
          await client.query(
            `INSERT INTO planning_nodes
               (run_id, node_id, version, input_hash, dependency_versions,
                status, confidence, evidence_refs, locked, updated_at)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9, now())
             ON CONFLICT (run_id, node_id, version) DO UPDATE
               SET status = EXCLUDED.status,
                   confidence = EXCLUDED.confidence,
                   input_hash = EXCLUDED.input_hash,
                   dependency_versions = EXCLUDED.dependency_versions,
                   evidence_refs = EXCLUDED.evidence_refs,
                   locked = EXCLUDED.locked,
                   updated_at = now()`,
            [
              runId,
              node.nodeId,
              node.version,
              node.inputHash,
              JSON.stringify(node.dependencyVersions),
              node.status,
              node.confidence,
              JSON.stringify(node.evidenceRefs),
              node.locked,
            ],
          );
        }
      });
    },

    async history(runId, nodeId) {
      const rows = await query<PlanningNodeDbRow>(
        `SELECT run_id, node_id, version, input_hash, dependency_versions,
                status, confidence, evidence_refs, locked, updated_at
           FROM planning_nodes
          WHERE run_id = $1 AND node_id = $2
          ORDER BY version`,
        [runId, nodeId],
      );
      return rows.map(toPlanningNode);
    },
  };

  interface MemberDbRow {
    room_id: string;
    user_id: string;
    role: string;
    survey_status: string;
    persona_confirmed_at: Date | null;
    joined_at: Date;
  }

  const toMember = (row: MemberDbRow): MemberRow => ({
    roomId: row.room_id,
    userId: row.user_id,
    role: row.role as MemberRow['role'],
    surveySubmitted: row.survey_status === 'submitted',
    personaConfirmedAt: row.persona_confirmed_at?.toISOString() ?? null,
    joinedAt: row.joined_at.toISOString(),
  });

  const MEMBER_COLUMNS = 'room_id, user_id, role, survey_status, persona_confirmed_at, joined_at';

  const members: MemberRepository = {
    async join(roomId, userId, role = 'member') {
      await query(
        `INSERT INTO room_members (room_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (room_id, user_id) DO UPDATE SET role = room_members.role`,
        [roomId, userId, role],
      );
      // 설문 제출 여부는 surveys가 원본이다. RETURNING만으로는 알 수 없다.
      const saved = await this.get(roomId, userId);
      if (saved === undefined) throw new Error('멤버 등록 실패');
      return saved;
    },

    async list(roomId) {
      // 설문 제출 여부는 surveys가 원본이다. survey_status 컬럼과 어긋나도 원본을 따른다.
      const rows = await query<MemberDbRow & { submitted: boolean }>(
        `SELECT ${MEMBER_COLUMNS},
                EXISTS (SELECT 1 FROM surveys s WHERE s.room_id = m.room_id AND s.user_id = m.user_id) AS submitted
           FROM room_members m WHERE room_id = $1 ORDER BY joined_at`,
        [roomId],
      );
      return rows.map((row) => ({ ...toMember(row), surveySubmitted: row.submitted }));
    },

    async get(roomId, userId) {
      const row = await queryOne<MemberDbRow & { submitted: boolean }>(
        `SELECT ${MEMBER_COLUMNS},
                EXISTS (SELECT 1 FROM surveys s WHERE s.room_id = m.room_id AND s.user_id = m.user_id) AS submitted
           FROM room_members m WHERE room_id = $1 AND user_id = $2`,
        [roomId, userId],
      );
      return row === undefined ? undefined : { ...toMember(row), surveySubmitted: row.submitted };
    },

    async confirmPersona(roomId, userId) {
      const row = await queryOne<MemberDbRow>(
        `UPDATE room_members SET persona_confirmed_at = now()
          WHERE room_id = $1 AND user_id = $2
         RETURNING ${MEMBER_COLUMNS}`,
        [roomId, userId],
      );
      if (row === undefined) return undefined;
      return this.get(roomId, userId);
    },
  };

  // ── 라운드에 매달린 저장소들 ─────────────────────────────────────────────
  // 후보·발화·판결·점수는 rounds 행에 외래키로 붙는다. 라운드 행이 먼저 있어야 한다.

  const candidates: CandidateRepository = {
    async saveMany(ref, rows) {
      if (rows.length === 0) return [];
      const roundId = roundRowId(ref);
      const saved: CandidateRow[] = [];
      await withTransaction(async (client) => {
        for (const row of rows) {
          await client.query(
            `INSERT INTO candidates (id, round_id, external_id, provider, payload, disqualified, disqualify_reason)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
             ON CONFLICT (round_id, external_id) DO UPDATE
               SET provider = EXCLUDED.provider,
                   payload = EXCLUDED.payload,
                   disqualified = EXCLUDED.disqualified,
                   disqualify_reason = EXCLUDED.disqualify_reason`,
            [
              `${roundId}:${row.externalId}`,
              roundId,
              row.externalId,
              row.provider,
              JSON.stringify(row.payload),
              row.disqualified ?? false,
              row.disqualifyReason ?? null,
            ],
          );
          saved.push({
            candidateId: `${roundId}:${row.externalId}`,
            externalId: row.externalId,
            provider: row.provider,
            payload: row.payload,
            disqualified: row.disqualified ?? false,
            disqualifyReason: row.disqualifyReason ?? null,
          });
        }
      });
      return saved;
    },

    async listByRound(ref) {
      const rows = await query<{
        id: string;
        external_id: string;
        provider: string;
        payload: unknown;
        disqualified: boolean;
        disqualify_reason: string | null;
      }>(
        `SELECT id, external_id, provider, payload, disqualified, disqualify_reason
           FROM candidates WHERE round_id = $1 ORDER BY external_id`,
        [roundRowId(ref)],
      );
      return rows.map((row) => ({
        candidateId: row.id,
        externalId: row.external_id,
        provider: row.provider,
        payload: row.payload,
        disqualified: row.disqualified,
        disqualifyReason: row.disqualify_reason,
      }));
    },

    async disqualify(ref, externalId, reason) {
      await query(
        `UPDATE candidates SET disqualified = true, disqualify_reason = $3
          WHERE round_id = $1 AND external_id = $2`,
        [roundRowId(ref), externalId, reason],
      );
    },

    async sourcedExternalIds(runId) {
      // 실격 후보도 조달된 것이다. Validation Pass는 "조달 근거가 있는가"만 본다.
      const rows = await query<{ external_id: string }>(
        `SELECT DISTINCT c.external_id
           FROM candidates c JOIN rounds r ON r.id = c.round_id
          WHERE r.run_id = $1`,
        [runId],
      );
      return rows.map((row) => row.external_id);
    },
  };

  const toMessage = (
    roundId: RoundId,
    row: { seq: number; speaker_type: string; speaker_id: string | null; content: string; refs: Record<string, unknown>; created_at: Date },
  ): MessageRow => ({
    roundId,
    seq: row.seq,
    speakerType: row.speaker_type as MessageRow['speakerType'],
    speakerId: row.speaker_id,
    content: row.content,
    refs: row.refs,
    createdAt: row.created_at.toISOString(),
  });

  const messages: MessageRepository = {
    async append(ref, message) {
      const roundId = roundRowId(ref);
      // seq는 저장소가 채번한다. 페르소나가 병렬로 발화하면 같은 seq를 노려 충돌할 수
      // 있으므로 유니크 위반은 재시도한다 — 순서를 잃는 것보다 낫다.
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        try {
          const row = await queryOne<{
            seq: number;
            speaker_type: string;
            speaker_id: string | null;
            content: string;
            refs: Record<string, unknown>;
            created_at: Date;
          }>(
            `INSERT INTO messages (round_id, seq, speaker_type, speaker_id, content, refs)
             SELECT $1, COALESCE(MAX(seq), 0) + 1, $2, $3, $4, $5::jsonb
               FROM messages WHERE round_id = $1
             RETURNING seq, speaker_type, speaker_id, content, refs, created_at`,
            [
              roundId,
              message.speakerType,
              message.speakerId,
              message.content,
              JSON.stringify(message.refs ?? {}),
            ],
          );
          if (row === undefined) throw new Error('발화 저장 실패');
          return toMessage(ref.roundId, row);
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code !== '23505' || attempt === 5) throw error;
        }
      }
      throw new Error('발화 seq 채번 재시도 실패');
    },

    async listByRound(ref) {
      const rows = await query<{
        seq: number;
        speaker_type: string;
        speaker_id: string | null;
        content: string;
        refs: Record<string, unknown>;
        created_at: Date;
      }>(
        `SELECT seq, speaker_type, speaker_id, content, refs, created_at
           FROM messages WHERE round_id = $1 ORDER BY seq`,
        [roundRowId(ref)],
      );
      return rows.map((row) => toMessage(ref.roundId, row));
    },

    async transcript(runId) {
      const rows = await query<{
        round_id: string;
        seq: number;
        speaker_type: string;
        speaker_id: string | null;
        content: string;
        refs: Record<string, unknown>;
        created_at: Date;
      }>(
        `SELECT r.round_id, m.seq, m.speaker_type, m.speaker_id, m.content, m.refs, m.created_at
           FROM messages m JOIN rounds r ON r.id = m.round_id
          WHERE r.run_id = $1
          ORDER BY r.seq, m.seq`,
        [runId],
      );
      return rows.map((row) => toMessage(row.round_id as RoundId, row));
    },
  };

  interface VerdictDbRow {
    round_id: string;
    payload: Verdict;
    min_satisfaction: string | null;
    satisfaction_gap: string | null;
    review_result: string | null;
    review_reasons: string[];
    created_at: Date;
  }

  const toVerdict = (row: VerdictDbRow, roundId: RoundId): VerdictRow => ({
    roundId,
    verdict: row.payload,
    minSatisfaction: row.min_satisfaction === null ? null : Number(row.min_satisfaction),
    satisfactionGap: row.satisfaction_gap === null ? null : Number(row.satisfaction_gap),
    review: { result: row.review_result, reasons: row.review_reasons },
    createdAt: row.created_at.toISOString(),
  });

  const verdicts: VerdictRepository = {
    async save(ref, verdict, review) {
      const row = await queryOne<VerdictDbRow>(
        `INSERT INTO verdicts
           (id, round_id, payload, min_satisfaction, satisfaction_gap, review_result, review_reasons)
         VALUES ($1,$1,$2::jsonb,$3,$4,$5,$6::jsonb)
         ON CONFLICT (id) DO UPDATE
           SET payload = EXCLUDED.payload,
               min_satisfaction = EXCLUDED.min_satisfaction,
               satisfaction_gap = EXCLUDED.satisfaction_gap,
               review_result = EXCLUDED.review_result,
               review_reasons = EXCLUDED.review_reasons,
               created_at = now()
         RETURNING round_id, payload, min_satisfaction, satisfaction_gap,
                   review_result, review_reasons, created_at`,
        [
          roundRowId(ref),
          JSON.stringify(verdict),
          verdict.minSatisfaction,
          verdict.satisfactionGap,
          review?.result ?? null,
          JSON.stringify(review?.reasons ?? []),
        ],
      );
      if (row === undefined) throw new Error('판결 저장 실패');
      return toVerdict(row, ref.roundId);
    },

    async get(ref) {
      const row = await queryOne<VerdictDbRow>(
        `SELECT round_id, payload, min_satisfaction, satisfaction_gap,
                review_result, review_reasons, created_at
           FROM verdicts WHERE id = $1`,
        [roundRowId(ref)],
      );
      return row === undefined ? undefined : toVerdict(row, ref.roundId);
    },

    async listByRun(runId) {
      const rows = await query<VerdictDbRow & { rid: string }>(
        `SELECT v.round_id, v.payload, v.min_satisfaction, v.satisfaction_gap,
                v.review_result, v.review_reasons, v.created_at, r.round_id AS rid
           FROM verdicts v JOIN rounds r ON r.id = v.round_id
          WHERE r.run_id = $1
          ORDER BY r.seq`,
        [runId],
      );
      return rows.map((row) => toVerdict(row, row.rid as RoundId));
    },
  };

  const scores: ScoreRepository = {
    async replaceRound(ref, rows) {
      const roundId = roundRowId(ref);
      await withTransaction(async (client) => {
        await client.query('DELETE FROM scores WHERE round_id = $1', [roundId]);
        for (const row of rows) {
          await client.query(
            `INSERT INTO scores (round_id, candidate_id, user_id, satisfaction, breakdown)
             VALUES ($1,$2,$3,$4,$5::jsonb)`,
            [roundId, row.candidateId, row.userId, row.satisfaction, JSON.stringify(row.breakdown)],
          );
        }
      });
    },

    async listByRound(ref) {
      const rows = await query<{
        candidate_id: string;
        user_id: string;
        satisfaction: string;
        breakdown: Record<string, number>;
      }>(
        `SELECT candidate_id, user_id, satisfaction, breakdown
           FROM scores WHERE round_id = $1 ORDER BY candidate_id, user_id`,
        [roundRowId(ref)],
      );
      return rows.map((row) => ({
        candidateId: row.candidate_id,
        userId: row.user_id,
        satisfaction: Number(row.satisfaction),
        breakdown: row.breakdown,
      }));
    },
  };

  const concessions: ConcessionRepository = {
    async append(entry) {
      await query(
        `INSERT INTO concession_ledger (room_id, user_id, round_id, delta, cc_after)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (room_id, user_id, round_id) WHERE round_id IS NOT NULL DO NOTHING`,
        [entry.roomId, entry.userId, entry.roundId, entry.delta, entry.ccAfter],
      );
    },

    async creditsByRoom(roomId) {
      const rows = await query<{ user_id: string; cc_after: string }>(
        `SELECT DISTINCT ON (user_id) user_id, cc_after
           FROM concession_ledger WHERE room_id = $1
          ORDER BY user_id, id DESC`,
        [roomId],
      );
      return Object.fromEntries(rows.map((row) => [row.user_id, Number(row.cc_after)]));
    },

    async history(roomId) {
      const rows = await query<{
        user_id: string;
        round_id: string | null;
        delta: string;
        cc_after: string;
      }>(
        `SELECT user_id, round_id, delta, cc_after
           FROM concession_ledger WHERE room_id = $1 ORDER BY id`,
        [roomId],
      );
      return rows.map((row) => ({
        roomId,
        userId: row.user_id,
        roundId: row.round_id as RoundId | null,
        delta: Number(row.delta),
        ccAfter: Number(row.cc_after),
      }));
    },
  };

  const dispatchDecisions: DispatchDecisionRepository = {
    async record(entry) {
      await query(
        `INSERT INTO dispatch_decisions
           (run_id, seq, legal_moves, proposal, validation_result, rejected_rules,
            fallback_used, decided_by, latency_ms, cost_usd)
         VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10)
         ON CONFLICT (run_id, seq) DO NOTHING`,
        [
          entry.runId,
          entry.seq,
          JSON.stringify(entry.legalMoves),
          entry.proposal === null ? null : JSON.stringify(entry.proposal),
          entry.validationResult === null ? null : JSON.stringify(entry.validationResult),
          JSON.stringify(entry.rejectedRules),
          entry.fallbackUsed,
          entry.decidedBy,
          entry.latencyMs ?? null,
          entry.costUsd ?? null,
        ],
      );
    },

    async listByRun(runId) {
      const rows = await query<{
        seq: number;
        legal_moves: unknown;
        proposal: unknown | null;
        validation_result: unknown | null;
        rejected_rules: string[];
        fallback_used: boolean;
        decided_by: string;
        latency_ms: number | null;
        cost_usd: string | null;
      }>(
        `SELECT seq, legal_moves, proposal, validation_result, rejected_rules,
                fallback_used, decided_by, latency_ms, cost_usd
           FROM dispatch_decisions WHERE run_id = $1 ORDER BY seq`,
        [runId],
      );
      return rows.map((row) => ({
        runId,
        seq: row.seq,
        legalMoves: row.legal_moves,
        proposal: row.proposal,
        validationResult: row.validation_result,
        rejectedRules: row.rejected_rules,
        fallbackUsed: row.fallback_used,
        decidedBy: row.decided_by as DispatchDecisionEntry['decidedBy'],
        latencyMs: row.latency_ms,
        costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
      }));
    },

    async fallbackRate(runId) {
      const row = await queryOne<{ decisions: string; fallbacks: string }>(
        `SELECT COUNT(*) AS decisions,
                COUNT(*) FILTER (WHERE fallback_used) AS fallbacks
           FROM dispatch_decisions WHERE run_id = $1`,
        [runId],
      );
      const decisions = Number(row?.decisions ?? 0);
      const fallbacks = Number(row?.fallbacks ?? 0);
      return { decisions, fallbacks, rate: decisions === 0 ? 0 : fallbacks / decisions };
    },
  };

  const emptyTotals = (): LlmUsageTotals => ({
    calls: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
  });

  const totalsRow = (row: {
    calls: string;
    cost_usd: string | null;
    input_tokens: string | null;
    output_tokens: string | null;
    cache_tokens: string | null;
  }): LlmUsageTotals => ({
    calls: Number(row.calls),
    costUsd: Number(row.cost_usd ?? 0),
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    cacheTokens: Number(row.cache_tokens ?? 0),
  });

  const llmUsage: LlmUsageRepository = {
    async record(entry) {
      await query(
        `INSERT INTO llm_usage
           (request_id, room_id, run_id, round_id, purpose, model, prompt_version,
            input_tokens, output_tokens, cache_tokens, latency_ms, cost_usd, batch, fallback_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (request_id) WHERE request_id IS NOT NULL DO NOTHING`,
        [
          entry.requestId,
          entry.roomId,
          entry.runId,
          entry.roundId,
          entry.purpose,
          entry.model,
          entry.promptVersion ?? null,
          entry.inputTokens,
          entry.outputTokens,
          entry.cacheTokens,
          entry.latencyMs ?? null,
          entry.costUsd,
          entry.batch ?? false,
          entry.fallbackReason ?? null,
        ],
      );
    },

    async totals(runId) {
      const row = await queryOne<Parameters<typeof totalsRow>[0]>(
        `SELECT COUNT(*) AS calls, SUM(cost_usd) AS cost_usd,
                SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
                SUM(cache_tokens) AS cache_tokens
           FROM llm_usage WHERE run_id = $1`,
        [runId],
      );
      return row === undefined ? emptyTotals() : totalsRow(row);
    },

    async byRoom(roomId) {
      const row = await queryOne<Parameters<typeof totalsRow>[0]>(
        `SELECT COUNT(*) AS calls, SUM(cost_usd) AS cost_usd,
                SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
                SUM(cache_tokens) AS cache_tokens
           FROM llm_usage WHERE room_id = $1`,
        [roomId],
      );
      return row === undefined ? emptyTotals() : totalsRow(row);
    },
  };

  interface ItineraryDbRow {
    id: string;
    room_id: string;
    run_id: string;
    version: number;
    plan: unknown;
    budget_summary: unknown | null;
    validation_report: unknown | null;
    published_at: Date | null;
  }

  const toItinerary = (row: ItineraryDbRow): ItineraryRow => ({
    itineraryId: row.id,
    roomId: row.room_id,
    runId: row.run_id,
    version: row.version,
    plan: row.plan,
    budgetSummary: row.budget_summary,
    validationReport: row.validation_report,
    publishedAt: row.published_at?.toISOString() ?? null,
  });

  const itineraries: ItineraryRepository = {
    async save(input) {
      const row = await queryOne<ItineraryDbRow>(
        `INSERT INTO itineraries (id, room_id, run_id, version, plan, budget_summary, validation_report)
         SELECT $1, $2, $3, COALESCE(MAX(version), 0) + 1, $4::jsonb, $5::jsonb, $6::jsonb
           FROM itineraries WHERE room_id = $2
         RETURNING id, room_id, run_id, version, plan, budget_summary, validation_report, published_at`,
        [
          nextId('itn'),
          input.roomId,
          input.runId,
          JSON.stringify(input.plan),
          input.budgetSummary === undefined ? null : JSON.stringify(input.budgetSummary),
          input.validationReport === undefined ? null : JSON.stringify(input.validationReport),
        ],
      );
      if (row === undefined) throw new Error('계획서 저장 실패');
      return toItinerary(row);
    },

    async latest(roomId) {
      const row = await queryOne<ItineraryDbRow>(
        `SELECT id, room_id, run_id, version, plan, budget_summary, validation_report, published_at
           FROM itineraries WHERE room_id = $1 ORDER BY version DESC LIMIT 1`,
        [roomId],
      );
      return row === undefined ? undefined : toItinerary(row);
    },

    async publish(itineraryId) {
      await query('UPDATE itineraries SET published_at = now() WHERE id = $1', [itineraryId]);
    },
  };

  interface ApprovalDbRow {
    id: string;
    room_id: string;
    type: string;
    options: unknown[];
    objection_id: string | null;
    raised_at: Date;
    responded_at: Date | null;
    response: unknown | null;
  }

  const toApproval = (row: ApprovalDbRow): ApprovalRow => ({
    approvalId: row.id,
    roomId: row.room_id,
    type: row.type,
    options: row.options,
    objectionId: row.objection_id,
    raisedAt: row.raised_at.toISOString(),
    respondedAt: row.responded_at?.toISOString() ?? null,
    response: row.response,
  });

  const approvals: ApprovalRepository = {
    async raise(input) {
      const row = await queryOne<ApprovalDbRow>(
        `INSERT INTO approval_requests (id, room_id, type, options, objection_id)
         VALUES ($1,$2,$3,$4::jsonb,$5)
         RETURNING id, room_id, type, options, objection_id, raised_at, responded_at, response`,
        [nextId('apr'), input.roomId, input.type, JSON.stringify(input.options), input.objectionId ?? null],
      );
      if (row === undefined) throw new Error('승인 요청 저장 실패');
      return toApproval(row);
    },

    async respond(approvalId, response) {
      const row = await queryOne<ApprovalDbRow>(
        `UPDATE approval_requests SET response = $2::jsonb, responded_at = now()
          WHERE id = $1
         RETURNING id, room_id, type, options, objection_id, raised_at, responded_at, response`,
        [approvalId, JSON.stringify(response)],
      );
      return row === undefined ? undefined : toApproval(row);
    },

    async pending(roomId) {
      const rows = await query<ApprovalDbRow>(
        `SELECT id, room_id, type, options, objection_id, raised_at, responded_at, response
           FROM approval_requests WHERE room_id = $1 AND responded_at IS NULL ORDER BY raised_at`,
        [roomId],
      );
      return rows.map(toApproval);
    },
  };

  return {
    kind: 'postgres',
    rooms,
    surveys,
    objections,
    runs,
    cache,
    planningNodes,
    members,
    candidates,
    messages,
    verdicts,
    scores,
    concessions,
    dispatchDecisions,
    llmUsage,
    itineraries,
    approvals,
    close: closePool,
  };
}
