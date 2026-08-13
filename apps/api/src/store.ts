import type {
  ObjectionRecord,
  ObjectionRequest,
  PlanningNodeId,
  RoundId,
  SurveySubmission,
} from '@tm/contracts';

/**
 * 인메모리 저장소. `packages/db` 착수 시 PostgreSQL 리포지토리로 교체한다.
 * 스키마는 travel-mediation-plan.md 11.1 · agent-architecture.md 12.1을 따른다.
 */

export interface RoomRecord {
  roomId: string;
  destinationId: string;
  status: 'COLLECTING' | 'DATE_RESOLVING' | 'READY' | 'QUEUED' | 'RUNNING' | 'COMPLETED';
  createdAt: string;
  completedRounds: RoundId[];
  bookedNodes: PlanningNodeId[];
  budgetBaselinePerPersonKrw?: number;
}

export interface SurveyRecord {
  surveyId: string;
  roomId: string;
  userId: string;
  submission: SurveySubmission;
  submittedAt: string;
}

let sequence = 0;
const nextId = (prefix: string): string => {
  sequence += 1;
  return `${prefix}_${Date.now().toString(36)}${sequence.toString(36)}`;
};

const rooms = new Map<string, RoomRecord>();
const surveys = new Map<string, SurveyRecord>();
const objections = new Map<string, ObjectionRecord>();

export const store = {
  createRoom(destinationId: string): RoomRecord {
    const room: RoomRecord = {
      roomId: nextId('rm'),
      destinationId,
      status: 'COLLECTING',
      createdAt: new Date().toISOString(),
      completedRounds: [],
      bookedNodes: [],
    };
    rooms.set(room.roomId, room);
    return room;
  },

  getRoom(roomId: string): RoomRecord | undefined {
    return rooms.get(roomId);
  },

  saveSurvey(roomId: string, userId: string, submission: SurveySubmission): SurveyRecord {
    const record: SurveyRecord = {
      surveyId: nextId('sv'),
      roomId,
      userId,
      submission,
      submittedAt: new Date().toISOString(),
    };
    surveys.set(record.surveyId, record);
    return record;
  },

  listSurveys(roomId: string): SurveyRecord[] {
    return [...surveys.values()].filter((survey) => survey.roomId === roomId);
  },

  /** 참여자 여부. 인증이 붙기 전까지는 설문 제출 이력으로 판단한다 */
  isMember(roomId: string, userId: string): boolean {
    return this.listSurveys(roomId).some((survey) => survey.userId === userId);
  },

  listObjections(roomId: string): ObjectionRecord[] {
    return [...objections.values()].filter((record) => record.request.roomId === roomId);
  },

  /** 상한 산정에는 거부·만료된 이의를 포함하지 않는다 */
  countedObjections(roomId: string): ObjectionRecord[] {
    return this.listObjections(roomId).filter(
      (record) => record.status !== 'rejected' && record.status !== 'expired',
    );
  },

  usedObjections(roomId: string, userId: string): { room: number; user: number } {
    const counted = this.countedObjections(roomId);
    return {
      room: counted.length,
      user: counted.filter((record) => record.request.userId === userId).length,
    };
  },

  saveObjection(request: ObjectionRequest, record: Omit<ObjectionRecord, 'objectionId'>): ObjectionRecord {
    const saved: ObjectionRecord = { ...record, objectionId: nextId('obj'), request };
    objections.set(saved.objectionId, saved);
    return saved;
  },

  updateObjection(objectionId: string, patch: Partial<ObjectionRecord>): ObjectionRecord | undefined {
    const current = objections.get(objectionId);
    if (current === undefined) return undefined;
    const updated = { ...current, ...patch };
    objections.set(objectionId, updated);
    return updated;
  },

  /** 테스트용 초기화 */
  reset(): void {
    rooms.clear();
    surveys.clear();
    objections.clear();
  },
};
