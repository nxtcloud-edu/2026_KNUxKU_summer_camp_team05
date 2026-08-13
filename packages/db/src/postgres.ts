import type { ObjectionRecord, ObjectionRequest, PlanningNodeId, RoundId } from '@tm/contracts';
import { closePool, query, queryOne } from './client.js';
import type {
  ObjectionRepository,
  Repositories,
  RoomRepository,
  RoomRow,
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

  return { kind: 'postgres', rooms, surveys, objections, close: closePool };
}
