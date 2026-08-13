import type {
  Confidence,
  NodeStatus,
  ObjectionRecord,
  ObjectionRequest,
  PlanningNodeId,
  RefereeCategory,
  RoundId,
  RoundPhase,
  SurveySubmission,
  Verdict,
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
  /** 마감 기한 트리거의 기준 시각. 없으면 마감 트리거를 쓸 수 없다 */
  deadlineAt: string | null;
  createdAt: string;
}

export interface MemberRow {
  roomId: string;
  userId: string;
  role: 'host' | 'member';
  /** 설문을 제출했는가 */
  surveySubmitted: boolean;
  /**
   * 페르소나 카드를 확인한 시각. null이면 아직 확인하지 않았다.
   * 이 확인은 **건너뛸 수 없는 게이트**다 — 사용자가 개입할 수 있는 마지막 지점이다.
   */
  personaConfirmedAt: string | null;
  joinedAt: string;
}

export interface MemberRepository {
  /** 초대 링크로 입장. 같은 사용자가 다시 들어와도 행이 늘지 않는다 */
  join(roomId: string, userId: string, role?: MemberRow['role']): Promise<MemberRow>;
  list(roomId: string): Promise<MemberRow[]>;
  get(roomId: string, userId: string): Promise<MemberRow | undefined>;
  /** 페르소나 확인 게이트 통과 */
  confirmPersona(roomId: string, userId: string): Promise<MemberRow | undefined>;
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

/**
 * 방 간 공유 캐시. 같은 Pack·같은 시기 조회를 재사용한다 (agent-architecture 6.4).
 * Data Agent만 이 저장소에 접근한다 — 심판은 캐시 DB를 직접 읽지 않는다.
 */
export interface CacheRecord {
  key: string;
  packId: string;
  queryClass: string;
  payload: unknown;
  source: string;
  confidence: Confidence;
  termsRef: string | null;
  /** 감사·재현용 원본 참조. LLM 컨텍스트에 절대 들어가지 않는다 */
  rawRef: string | null;
  retrievedAt: string;
  validUntil: string | null;
}

export interface DataRequestLog {
  runId: string | null;
  roundId: string | null;
  callerId: string;
  queryClass: string;
  purpose: string;
  canonicalHash: string;
  cacheHit: boolean;
  confidence: Confidence | null;
  degraded: boolean;
  fallbackReason?: string | null;
  provider?: string | null;
  latencyMs?: number | null;
  costUsd?: number | null;
  responseHash?: string | null;
}

export interface CacheRepository {
  get(key: string): Promise<CacheRecord | undefined>;
  put(record: CacheRecord): Promise<void>;
  /** 만료 레코드 정리. RAG 코퍼스에 만료 데이터가 남지 않게 한다 */
  purgeExpired(): Promise<number>;
  /** 캐시 적중률·폴백률·fail-closed 차단 추적 (agent-architecture 12.2) */
  logRequest(entry: DataRequestLog): Promise<void>;
}

/**
 * Planning Graph 노드. 상위가 바뀌면 하위는 삭제되지 않고 STALE + 새 버전으로 남는다.
 * 버전 이력을 보존하므로 "왜 이 결정이 뒤집혔는가"를 나중에 되짚을 수 있다.
 */
export interface PlanningNodeRow {
  runId: string;
  nodeId: PlanningNodeId;
  version: number;
  status: NodeStatus;
  confidence: Confidence;
  inputHash: string;
  dependencyVersions: Record<string, number>;
  evidenceRefs: string[];
  locked: boolean;
  updatedAt: string;
}

export interface PlanningNodeRepository {
  /** 노드별 최신 버전만 반환한다 */
  listLatest(runId: string): Promise<PlanningNodeRow[]>;
  /** 새 버전 행을 추가한다. 기존 행은 이력으로 남는다 */
  appendVersions(
    runId: string,
    nodes: readonly Omit<PlanningNodeRow, 'runId' | 'updatedAt'>[],
  ): Promise<void>;
  /** 특정 노드의 버전 이력 */
  history(runId: string, nodeId: PlanningNodeId): Promise<PlanningNodeRow[]>;
}

/**
 * 라운드 행 참조. `rounds.id`는 `${runId}:${roundId}`다.
 * 라운드에 매달린 저장소(후보·발화·판결·점수)는 전부 이 참조로 쓴다 —
 * 호출자가 행 id 조합 규칙을 알 필요가 없어야 규칙이 한 곳에만 남는다.
 *
 * **선행 조건**: 이 참조로 쓰기 전에 `RunRepository.recordRound`가 먼저 호출되어야 한다.
 * 라운드 행이 없으면 외래키가 거부한다 — 조용히 만들지 않는다.
 */
export interface RoundRef {
  runId: string;
  roundId: RoundId;
}

export function roundRowId(ref: RoundRef): string {
  return `${ref.runId}:${ref.roundId}`;
}

/**
 * 심판이 Data Agent로 조달한 정규화 후보.
 * 에이전트는 여기 없는 항목을 계획서에 올릴 수 없다 — Validation Pass의 external_id
 * 전수 검증이 이 테이블을 원본으로 삼는다 (validation.ts 1번 검증).
 */
export interface CandidateInput {
  /** 제공자가 부여한 후보 식별자. 계획서 항목이 이 값을 참조한다 */
  externalId: string;
  provider: string;
  /** 정규화된 Candidate. 제공자 원본 JSON은 절대 넣지 않는다 (6.6) */
  payload: unknown;
  disqualified?: boolean;
  disqualifyReason?: string | null;
}

export interface CandidateRow extends CandidateInput {
  /** 행 id. 라운드 스코프이며 `${roundRowId}:${externalId}`로 만든다 */
  candidateId: string;
  disqualified: boolean;
  disqualifyReason: string | null;
}

export interface CandidateRepository {
  /** 같은 external_id가 다시 들어오면 payload를 갱신한다 (잡 재시도 멱등) */
  saveMany(ref: RoundRef, rows: readonly CandidateInput[]): Promise<CandidateRow[]>;
  listByRound(ref: RoundRef): Promise<CandidateRow[]>;
  /** 실격은 삭제가 아니다. 왜 탈락했는지가 회의록에 남아야 한다 */
  disqualify(ref: RoundRef, externalId: string, reason: string): Promise<void>;
  /** run 전체에서 실제 조달된 external_id. Validation Pass 입력 */
  sourcedExternalIds(runId: string): Promise<string[]>;
}

export type SpeakerType = 'persona' | 'referee' | 'supervisor' | 'system';

export interface MessageInput {
  speakerType: SpeakerType;
  speakerId: string | null;
  content: string;
  /** 발화가 참조한 후보·근거 id. 팩트체크가 이 값을 검사한다 */
  refs?: Record<string, unknown>;
}

export interface MessageRow extends MessageInput {
  roundId: RoundId;
  seq: number;
  refs: Record<string, unknown>;
  createdAt: string;
}

/** 회의록. "왜 이 결정인가"가 남는 곳이며 사용자에게 전문이 공개된다 */
export interface MessageRepository {
  /** seq는 저장소가 채번한다. 병렬 발화에서도 순서가 하나로 결정되어야 한다 */
  append(ref: RoundRef, message: MessageInput): Promise<MessageRow>;
  listByRound(ref: RoundRef): Promise<MessageRow[]>;
  /** run 전체 회의록 (라운드 순서 → seq 순서) */
  transcript(runId: string): Promise<MessageRow[]>;
}

export interface VerdictReview {
  /** REVIEW 단계 판정 결과 (rerun / accept 등) */
  result: string | null;
  reasons: string[];
}

export interface VerdictRow {
  roundId: RoundId;
  verdict: Verdict;
  minSatisfaction: number | null;
  satisfactionGap: number | null;
  review: VerdictReview;
  createdAt: string;
}

export interface VerdictRepository {
  /** 라운드당 판결 1건. 재판결이면 덮어쓴다 */
  save(ref: RoundRef, verdict: Verdict, review?: VerdictReview): Promise<VerdictRow>;
  get(ref: RoundRef): Promise<VerdictRow | undefined>;
  listByRun(runId: string): Promise<VerdictRow[]>;
}

export interface ScoreRow {
  candidateId: string;
  userId: string;
  satisfaction: number;
  breakdown: Record<string, number>;
}

/**
 * Scoring Engine 산출값. 심판이 만드는 값이 아니라 코드가 만드는 값이다 (INV-2).
 */
export interface ScoreRepository {
  /** 라운드 단위 통째 교체. 점수는 한 번에 계산되므로 부분 갱신이 없다 */
  replaceRound(ref: RoundRef, rows: readonly ScoreRow[]): Promise<void>;
  listByRound(ref: RoundRef): Promise<ScoreRow[]>;
}

export interface ConcessionEntry {
  roomId: string;
  userId: string;
  roundId: RoundId | null;
  delta: number;
  /** 반영 후 잔액 */
  ccAfter: number;
}

/** 양보 크레딧 원장. 다음 라운드 발언 순서와 가중치가 여기서 나온다 */
export interface ConcessionRepository {
  /** 같은 (방·사용자·라운드)는 한 번만 기록한다. 재시도가 크레딧을 두 번 깎지 않는다 */
  append(entry: ConcessionEntry): Promise<void>;
  /** userId → 최신 잔액 */
  creditsByRoom(roomId: string): Promise<Record<string, number>>;
  history(roomId: string): Promise<ConcessionEntry[]>;
}

export interface DispatchDecisionEntry {
  runId: string;
  seq: number;
  legalMoves: unknown;
  proposal: unknown | null;
  validationResult: unknown | null;
  /** 거부된 검증 규칙 (V1~V10) */
  rejectedRules: string[];
  fallbackUsed: boolean;
  decidedBy: 'supervisor' | 'default';
  latencyMs?: number | null;
  costUsd?: number | null;
}

/** Supervisor 제안과 검증 결과. 폴백률이 프롬프트 회귀 지표다 (12.2) */
export interface DispatchDecisionRepository {
  /** 같은 (run, seq)는 한 번만 기록한다 */
  record(entry: DispatchDecisionEntry): Promise<void>;
  listByRun(runId: string): Promise<DispatchDecisionEntry[]>;
  fallbackRate(runId: string): Promise<{ decisions: number; fallbacks: number; rate: number }>;
}

export interface LlmUsageEntry {
  /** 멱등 키. 같은 requestId가 다시 들어오면 원가를 두 번 세지 않는다 */
  requestId: string;
  roomId: string | null;
  runId: string | null;
  roundId: string | null;
  purpose: string;
  model: string;
  promptVersion?: string | null;
  inputTokens: number;
  outputTokens: number;
  /** 캐시 읽기 토큰. 0이면 프롬프트 캐싱이 걸리지 않은 것이다 (llm-runtime-config 3.2) */
  cacheTokens: number;
  latencyMs?: number | null;
  costUsd: number;
  batch?: boolean;
  fallbackReason?: string | null;
}

export interface LlmUsageTotals {
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
}

/**
 * LLM 원가 원장. `RUN_COST_CAP_USD`가 지켜지는지는 실측으로만 알 수 있고
 * 실측의 원본이 이 테이블이다 (llm-runtime-config.md 3.3).
 */
export interface LlmUsageRepository {
  record(entry: LlmUsageEntry): Promise<void>;
  totals(runId: string): Promise<LlmUsageTotals>;
  byRoom(roomId: string): Promise<LlmUsageTotals>;
}

export interface ItineraryInput {
  roomId: string;
  runId: string;
  plan: unknown;
  budgetSummary?: unknown;
  /** Validation Pass 결과. PARTIAL 발행 사유가 여기 남는다 */
  validationReport?: unknown;
}

export interface ItineraryRow extends ItineraryInput {
  itineraryId: string;
  version: number;
  publishedAt: string | null;
}

export interface ItineraryRepository {
  /** 방마다 버전이 올라간다. 이전 계획서는 지우지 않는다 */
  save(input: ItineraryInput): Promise<ItineraryRow>;
  latest(roomId: string): Promise<ItineraryRow | undefined>;
  /** 발행. 검증을 통과하지 못한 계획서는 PARTIAL 배지로만 나간다 */
  publish(itineraryId: string): Promise<void>;
}

export interface ApprovalInput {
  roomId: string;
  /** 'booked_node_change' | 'late_hard_constraint' 등 */
  type: string;
  options: unknown[];
  objectionId?: string | null;
}

export interface ApprovalRow extends ApprovalInput {
  approvalId: string;
  objectionId: string | null;
  raisedAt: string;
  respondedAt: string | null;
  response: unknown | null;
}

/**
 * 승인 요청. 예약 완료 노드는 자동 STALE 대상이 아니라 승인 요청 대상이다 (INV-5).
 */
export interface ApprovalRepository {
  raise(input: ApprovalInput): Promise<ApprovalRow>;
  respond(approvalId: string, response: unknown): Promise<ApprovalRow | undefined>;
  pending(roomId: string): Promise<ApprovalRow[]>;
}

export interface Repositories {
  kind: 'postgres' | 'memory';
  rooms: RoomRepository;
  surveys: SurveyRepository;
  objections: ObjectionRepository;
  runs: RunRepository;
  cache: CacheRepository;
  planningNodes: PlanningNodeRepository;
  members: MemberRepository;
  candidates: CandidateRepository;
  messages: MessageRepository;
  verdicts: VerdictRepository;
  scores: ScoreRepository;
  concessions: ConcessionRepository;
  dispatchDecisions: DispatchDecisionRepository;
  llmUsage: LlmUsageRepository;
  itineraries: ItineraryRepository;
  approvals: ApprovalRepository;
  close(): Promise<void>;
}
