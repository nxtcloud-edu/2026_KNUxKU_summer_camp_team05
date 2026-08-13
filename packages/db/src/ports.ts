import type {
  ObjectionRecord,
  ObjectionRequest,
  PlanningNodeId,
  RefereeCategory,
  RoundId,
  RoundPhase,
  SurveySubmission,
} from '@tm/contracts';

/**
 * 저장소 포트. PostgreSQL 구현과 인메모리 구현이 같은 계약을 만족한다.
 * DATABASE_URL이 없으면 인메모리로 폴백해, DB 없이도 프론트 연동을 확인할 수 있다.
 */

export interface RoomRow {
  roomId: string;
  packId: string;
  status: 'COLLECTING' | 'DATE_RESOLVING' | 'READY' | 'QUEUED' | 'RUNNING' | 'COMPLETED';
  setting: Record<string, unknown>;
  completedRounds: RoundId[];
  bookedNodes: PlanningNodeId[];
  budgetBaselinePerPersonKrw?: number;
  createdAt: string;
}

export interface SurveyRow {
  surveyId: string;
  roomId: string;
  userId: string;
  schemaVersion: number;
  payload: SurveySubmission;
  allergens: string[];
  submittedAt: string;
}

export interface RoomRepository {
  create(packId: string, setting?: Record<string, unknown>): Promise<RoomRow>;
  get(roomId: string): Promise<RoomRow | undefined>;
  updateStatus(roomId: string, status: RoomRow['status']): Promise<void>;
  /** 회의가 끝난 방의 실행 결과를 기록한다. 이의 심사에 필요한 최소 정보 */
  markCompleted(
    roomId: string,
    completedRounds: RoundId[],
    budgetBaselinePerPersonKrw?: number,
  ): Promise<void>;
}

export interface SurveyRepository {
  save(roomId: string, userId: string, submission: SurveySubmission): Promise<SurveyRow>;
  listByRoom(roomId: string): Promise<SurveyRow[]>;
  isMember(roomId: string, userId: string): Promise<boolean>;
}

export interface ObjectionRepository {
  save(request: ObjectionRequest, record: Omit<ObjectionRecord, 'objectionId'>): Promise<ObjectionRecord>;
  update(objectionId: string, patch: Partial<ObjectionRecord>): Promise<ObjectionRecord | undefined>;
  listByRoom(roomId: string): Promise<ObjectionRecord[]>;
  /** 상한 계산 대상. 거부·만료된 이의는 제외한다 */
  countedByRoom(roomId: string): Promise<ObjectionRecord[]>;
  used(roomId: string, userId: string): Promise<{ room: number; user: number }>;
}

export type RunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface RunRow {
  runId: string;
  roomId: string;
  seq: number;
  trigger: string;
  status: RunStatus;
  objectionId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RoundRecord {
  runId: string;
  roundId: RoundId;
  category: RefereeCategory | 'supervisor';
  seq: number;
  /** SETTLED만 완료로 집계된다. 판결 전 단계는 이의 심사 대상이 아니다 */
  phase: RoundPhase | 'FAILED';
  rerunCount?: number;
}

/**
 * 실행 기록. 워커가 쓰고 이의 심사가 읽는다.
 * runId는 호출자가 정한다 — 잡이 재시도되어도 run 행은 하나여야 한다 (멱등).
 */
export interface RunRepository {
  start(input: {
    runId: string;
    roomId: string;
    trigger: string;
    objectionId?: string | null;
  }): Promise<RunRow>;
  /** 라운드 진행 상태를 기록한다. 같은 run·라운드면 덮어쓴다 */
  recordRound(record: RoundRecord): Promise<void>;
  finish(
    runId: string,
    status: Extract<RunStatus, 'COMPLETED' | 'FAILED'>,
    failureReason?: string | null,
  ): Promise<void>;
  get(runId: string): Promise<RunRow | undefined>;
}

export interface Repositories {
  kind: 'postgres' | 'memory';
  rooms: RoomRepository;
  surveys: SurveyRepository;
  objections: ObjectionRepository;
  runs: RunRepository;
  close(): Promise<void>;
}
