import type { ObjectionRecord, ObjectionRequest, PlanningNodeId, RoundId } from '@tm/contracts';
import { closePool, query, queryOne, withTransaction } from './client.js';
import type {
  CacheRecord,
  CacheRepository,
  ObjectionRepository,
  PlanningNodeRepository,
  PlanningNodeRow,
  Repositories,
  RoomRepository,
  RoomRow,
  RunRepository,
  RunRow,
  SurveyRepository,
  SurveyRow,
} from './ports.js';

interface RoomDbRow {
  id: string;
  pack_id: string;
  status: string;
  setting: Record<string, unknown>;
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
         RETURNING id, pack_id, status, setting, created_at`,
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
        createdAt: row.created_at.toISOString(),
      };
    },

    async get(roomId) {
      const row = await queryOne<RoomDbRow & { budget_baseline: number | null }>(
        `SELECT id, pack_id, status, setting, created_at,
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

  return {
    kind: 'postgres',
    rooms,
    surveys,
    objections,
    runs,
    cache,
    planningNodes,
    close: closePool,
  };
}
