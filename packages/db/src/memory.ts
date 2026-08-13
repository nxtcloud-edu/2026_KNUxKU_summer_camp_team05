import type { ObjectionRecord, ObjectionRequest, RoundId, SurveySubmission } from '@tm/contracts';
import type {
  ObjectionRepository,
  Repositories,
  RoomRepository,
  RoomRow,
  SurveyRepository,
  SurveyRow,
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

  const rooms = new Map<string, RoomRow>();
  const surveys = new Map<string, SurveyRow>();
  const objections = new Map<string, ObjectionRecord>();

  const roomRepo: RoomRepository = {
    async create(packId, setting = {}) {
      const room: RoomRow = {
        roomId: nextId('rm'),
        packId,
        status: 'COLLECTING',
        setting,
        completedRounds: [],
        bookedNodes: [],
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

  return {
    kind: 'memory',
    rooms: roomRepo,
    surveys: surveyRepo,
    objections: objectionRepo,
    async close() {
      rooms.clear();
      surveys.clear();
      objections.clear();
    },
  };
}

export type { RoundId };
