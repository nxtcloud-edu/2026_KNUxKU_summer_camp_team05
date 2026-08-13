import { z } from 'zod';
import { planningNodeIds, type PlanningNodeId } from './planning.js';
import type { RefereeCategory, RoundId, RoundPhase } from './rounds.js';
import type { ObjectionRecord } from './objection.js';
import type { Verdict } from './verdict.js';

/**
 * 결과 조회 계약 — 프론트엔드가 화면을 그리는 데 필요한 읽기 전용 응답.
 *
 * 이 파일이 존재하는 이유는 하나다: **프론트엔드가 타입을 다시 정의하지 않게 하는 것.**
 * 계약이 두 벌이 되는 순간 화면과 서버는 조용히 어긋난다.
 *
 * 설계 원칙 — 없는 것을 있는 것처럼 만들지 않는다.
 *   · 아직 만들어지지 않은 결과는 `availability`로 구분해 돌려준다. 빈 객체로 위장하지 않는다.
 *   · 확인하지 못한 항목은 `uncertainties`·`blockers`에 그대로 남는다.
 *   · 배지는 코드가 판정한 값이며, `PARTIAL`은 예약 행동을 유도하지 않는다.
 *
 * 근거: docs/travel-mediation-plan.md 19.6 · README 신뢰할 수 있는 대리인 원칙
 */

/** 방 상태. `@tm/db`의 RoomRow.status와 같은 집합이다 */
export const roomStatuses = [
  'COLLECTING',
  'DATE_RESOLVING',
  'READY',
  'QUEUED',
  'RUNNING',
  'COMPLETED',
] as const;
export type RoomStatus = (typeof roomStatuses)[number];

export const runStatuses = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'] as const;
export type RunStatusView = (typeof runStatuses)[number];

/**
 * 결과가 지금 어떤 상태인가.
 *
 * `pending`  아직 회의가 시작되지 않았다
 * `running`  진행 중이라 결과가 없다
 * `partial`  결과는 있으나 검증을 통과하지 못했다 (발행되지 않음)
 * `ready`    검증을 통과해 발행되었다
 * `failed`   실행이 실패했다. 사유를 함께 돌려준다
 */
export const resultAvailabilities = ['pending', 'running', 'partial', 'ready', 'failed'] as const;
export type ResultAvailability = (typeof resultAvailabilities)[number];

/**
 * 모든 결과 응답의 공통 봉투.
 * `data`가 null이어도 `availability`와 `reason`으로 화면이 정확한 빈 상태를 그릴 수 있다.
 */
export interface ResultEnvelope<T> {
  availability: ResultAvailability;
  /** 왜 아직 없는가 / 왜 부분인가. 사용자에게 그대로 보여줄 수 있는 문장 */
  reason: string | null;
  data: T | null;
}

/* ------------------------------------------------------------------ 세션·방 */

/**
 * `GET /api/session`.
 *
 * `authenticated`가 항상 false인 것은 버그가 아니라 사실이다 — 쿠키는 서명되지
 * 않았고 위조할 수 있다. 프론트는 이 값을 **권한 판단에 쓰면 안 된다.**
 */
export interface SessionView {
  userId: string;
  authenticated: false;
}

export const memberRoles = ['host', 'member'] as const;
export type MemberRole = (typeof memberRoles)[number];

/** 참여자 1명. `@tm/db`의 MemberRow를 프론트가 쓸 수 있게 계약으로 올린 것 */
export interface MemberView {
  roomId: string;
  userId: string;
  role: MemberRole;
  surveySubmitted: boolean;
  /** 페르소나 카드를 확인한 시각. null이면 건너뛸 수 없는 게이트 앞에 서 있다 */
  personaConfirmedAt: string | null;
  joinedAt: string;
}

/** `GET /api/rooms/:roomId` — 어느 화면을 보여줄지가 `me`에서 결정된다 */
export interface RoomDetailView {
  roomId: string;
  packId: string;
  status: RoomStatus;
  deadlineAt: string | null;
  completedRounds: RoundId[];
  bookedNodes: PlanningNodeId[];
  memberCount: number;
  surveyDone: number;
  personaConfirmed: number;
  me: {
    userId: string;
    role: MemberRole;
    surveySubmitted: boolean;
    personaConfirmedAt: string | null;
  } | null;
  pendingApprovals: number;
}

/**
 * 회의 시작 트리거 3종.
 *
 * 값이 `host`이지 `host_start`가 아니다 — `@tm/core`의 `startTriggers`가 원본이며
 * 이 배열은 그것을 프론트가 쓸 수 있게 옮긴 것이다. 둘이 어긋나면 400이 난다.
 */
export const startTriggerIds = ['all_done', 'host', 'deadline'] as const;
export type StartTriggerId = (typeof startTriggerIds)[number];

export const triggerRejectionReasons = [
  'already_running',
  'not_enough_members',
  'survey_incomplete',
  'persona_unconfirmed',
  'not_host',
  'deadline_not_set',
  'deadline_not_reached',
  'not_enough_attendees',
] as const;
export type TriggerRejectionReason = (typeof triggerRejectionReasons)[number];

/** 참석하지 못하는 사람. 결과 화면에 그대로 표시한다 — 침묵 금지 */
export interface AbsenteeView {
  userId: string;
  reason: 'no_survey' | 'no_persona_confirm';
}

export interface TriggerDecisionView {
  allowed: boolean;
  reason: TriggerRejectionReason | null;
  /** 회의에 대변인을 세울 사람 */
  attendees: string[];
  absentees: AbsenteeView[];
}

/** `GET /api/rooms/:roomId/start-check` — 방장 화면 버튼의 활성 조건 */
export interface StartCheckView {
  triggers: Record<StartTriggerId, TriggerDecisionView>;
}

/** `POST /api/rooms/:roomId/start` — 202면 큐에 들어갔다 */
export interface StartRunView {
  runId: string;
  jobId: string | null;
  /** false면 큐에 들어가지 않았다. 이때 방을 대기 중으로 표시하면 안 된다 */
  enqueued: boolean;
  trigger: StartTriggerId;
  attendees: string[];
  absentees: AbsenteeView[];
}

/**
 * 승인 요청. 예약 완료 노드에 영향이 갈 때 올라온다 (INV-5).
 * 취소 수수료가 발생할 수 있어 방장만 응답한다.
 */
export interface ApprovalView {
  approvalId: string;
  roomId: string;
  /** 'booked_node_change' | 'late_hard_constraint' 등 */
  type: string;
  options: unknown[];
  objectionId: string | null;
  raisedAt: string;
  respondedAt: string | null;
  response: unknown | null;
}

/* ------------------------------------------------------------------ 진행 상태 */

export interface RoundProgress {
  roundId: RoundId;
  category: RefereeCategory | 'supervisor';
  phase: RoundPhase | 'FAILED';
  seq: number;
  rerunCount: number;
  /** SETTLED만 완료로 센다. 판결 전 단계는 완료가 아니다 */
  settled: boolean;
}

/**
 * 회의 진행 화면의 유일한 입력. 폴링 대상이다.
 *
 * 조용한 실패가 이 서비스의 최대 리스크이므로 `failureReason`·`stopReason`을 숨기지 않는다.
 * 부분 결과를 완주로 보이게 하지 않는다.
 */
export interface RoomProgress {
  roomId: string;
  packId: string;
  roomStatus: RoomStatus;
  runId: string | null;
  runStatus: RunStatusView | null;
  rounds: RoundProgress[];
  completedRounds: RoundId[];
  /** 이번 run이 돌기로 한 라운드 수. 이의 재실행이면 전체가 아니다 */
  totalRounds: number;
  /** 0~100. 완료 라운드 / 전체 라운드 */
  percent: number;
  startedAt: string | null;
  finishedAt: string | null;
  /** 실행이 중간에 멈춘 사유. 정상 완료면 null */
  failureReason: string | null;
  /** 응답을 기다리는 승인 요청 수. 있으면 진행이 멈춰 있다 (INV-5) */
  pendingApprovals: number;
}

/* ------------------------------------------------------------------ 계획서 */

/**
 * 항목·계획서 배지. 코드가 판정하며 에이전트가 주장할 수 없다.
 * `PARTIAL`은 검증을 통과하지 못한 상태이므로 예약 행동을 유도하지 않는다.
 */
export const resultBadges = [
  'NONE',
  'DRAFT',
  'PARTIAL',
  'VERIFIED',
  'BOOKABLE',
  'BOOKED',
] as const;
export type ResultBadge = (typeof resultBadges)[number];

/**
 * Validation Pass가 남긴 차단·경고를 화면용으로 투영한 것.
 * `@tm/core`의 `ValidationBlocker`가 원본이며, contracts는 core에 의존할 수 없어 별도로 둔다.
 */
export interface PlanBlockerView {
  kind: string;
  detail: string;
  itemId: string | null;
  nodeId: PlanningNodeId | null;
  roundId: RoundId | null;
}

export interface PlanItemView {
  itemId: string;
  nodeId: PlanningNodeId;
  /** 조달된 후보의 external_id. null이면 계획서에 실릴 수 없다 (Validation Pass 1번) */
  externalId: string | null;
  title: string;
  /** 화면 보조 설명. 없으면 빈 문자열 */
  detail: string;
  startAt: string | null;
  endAt: string | null;
  costPerPersonKrw: number;
  badge: ResultBadge;
  bookingUrl: string | null;
  /** 직전 항목에서의 이동시간(분). 미측정이면 null — 0으로 위장하지 않는다 */
  travelMinutesFromPrev: number | null;
  /** 확인하지 못한 것. 있으면 화면에 그대로 노출한다 */
  caution: string | null;
}

export interface PlanDayView {
  day: number;
  date: string | null;
  title: string;
  items: PlanItemView[];
  totals: {
    costPerPersonKrw: number;
    travelMinutes: number | null;
    walkMeters: number | null;
  };
}

export interface PlanBudgetView {
  declaredTotalPerPersonKrw: number;
  /** 그룹 상한 = 최저 예산 참여자의 상한 (기획서 8.4) */
  groupCapPerPersonKrw: number;
  /** 노드별 1인 비용. 합계는 declaredTotal과 일치해야 한다 */
  byNode: Partial<Record<PlanningNodeId, number>>;
}

/**
 * 최종 계획서. `DocumentPort.draft()`가 만드는 형태와 같아야 한다 —
 * 문서 에이전트는 이 shape를 채우고, 검증과 배지 판정은 코드가 한다.
 */
export interface PlanResult {
  roomId: string;
  runId: string;
  itineraryId: string;
  version: number;
  publishedAt: string | null;
  badge: ResultBadge;
  /** DateResolver가 확정한 여행 구간 */
  dateRange: { start: string; end: string } | null;
  headline: string;
  days: PlanDayView[];
  budget: PlanBudgetView;
  /** 계획서를 발행하지 못하게 만든 것들 */
  blockers: PlanBlockerView[];
  /** 차단은 아니지만 표기해야 하는 것들 */
  warnings: PlanBlockerView[];
  /** 확인하지 못한 것. 숨기면 사용자가 잘못된 예약을 한다 */
  uncertainties: string[];
}

/**
 * 문서 에이전트가 만드는 계획서 본문.
 *
 * `PlanResult`에서 **코드가 소유하는 필드를 뺀 나머지**다 — 배지·차단·경고·발행 시각은
 * 에이전트가 주장할 수 없고 Validation Pass의 결과로만 정해진다 (INV-2, agent-architecture 9.1).
 *
 * `itineraries.plan`은 `unknown`으로 저장되므로 읽는 쪽에서 반드시 이 스키마로 파싱한다.
 * 파싱에 실패하면 계획서를 없는 것으로 취급하고 사유를 남긴다 — 깨진 값을 화면에 흘리지 않는다.
 */
export const planDocumentSchema = z.object({
  headline: z.string().default(''),
  dateRange: z.object({ start: z.string(), end: z.string() }).nullable().default(null),
  days: z
    .array(
      z.object({
        day: z.number().int().positive(),
        date: z.string().nullable().default(null),
        title: z.string().default(''),
        items: z
          .array(
            z.object({
              itemId: z.string(),
              nodeId: z.enum(planningNodeIds),
              externalId: z.string().nullable().default(null),
              title: z.string(),
              detail: z.string().default(''),
              startAt: z.string().nullable().default(null),
              endAt: z.string().nullable().default(null),
              costPerPersonKrw: z.number().default(0),
              bookingUrl: z.string().nullable().default(null),
              travelMinutesFromPrev: z.number().nullable().default(null),
              caution: z.string().nullable().default(null),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  budget: z
    .object({
      declaredTotalPerPersonKrw: z.number().default(0),
      groupCapPerPersonKrw: z.number().default(0),
      byNode: z.record(z.string(), z.number()).default({}),
    })
    .default({ declaredTotalPerPersonKrw: 0, groupCapPerPersonKrw: 0, byNode: {} }),
  uncertainties: z.array(z.string()).default([]),
});

export type PlanDocument = z.infer<typeof planDocumentSchema>;

/* ------------------------------------------------------------------ 회의록 */

export interface TranscriptMessageView {
  roundId: RoundId;
  seq: number;
  speakerType: 'persona' | 'referee' | 'supervisor' | 'system';
  speakerId: string | null;
  /** 화면에 표시할 이름. 페르소나는 참여자 이름, 심판은 카테고리 */
  speakerName: string;
  content: string;
  /** 발화가 참조한 후보·근거 id. 이의 제기 앵커의 재료다 */
  refs: Record<string, unknown>;
  createdAt: string;
}

export interface TranscriptRoundView {
  roundId: RoundId;
  category: RefereeCategory | 'supervisor';
  phase: RoundPhase | 'FAILED';
  messages: TranscriptMessageView[];
  /** 판결. 아직 나지 않았으면 null */
  verdict: Verdict | null;
  /** Scoring Engine 산출값. 심판이 만든 값이 아니다 (INV-2) */
  scores: { candidateId: string; userId: string; satisfaction: number }[];
}

/**
 * 회의록 전문. "왜 이 결정인가"가 남는 곳이며 사용자에게 전부 공개된다.
 * 이의 제기는 여기의 `seq`·판결·후보 id를 앵커로 지목한다.
 */
export interface TranscriptView {
  roomId: string;
  runId: string;
  rounds: TranscriptRoundView[];
  /** Supervisor 제안이 거부되어 기본 순서로 폴백한 비율. 프롬프트 회귀 지표다 (12.2) */
  fallbackRate: number;
}

/* ------------------------------------------------------------------ 공정성 */

export interface MemberFairnessView {
  userId: string;
  displayName: string;
  /** 라운드 평균 만족도. 점수가 없으면 null — 0으로 위장하지 않는다 */
  satisfaction: number | null;
  perRound: Partial<Record<RoundId, number>>;
  /** 양보 크레딧 잔액. 다음 라운드 발언 순서와 가중치의 근거 */
  concessionCredit: number;
  concessions: { roundId: RoundId | null; delta: number }[];
}

/**
 * 만족도·양보·소수 의견. 평등주의 합의(Maximin)가 실제로 작동했는지 보여주는 화면이다.
 */
export interface FairnessView {
  roomId: string;
  runId: string;
  members: MemberFairnessView[];
  /** 총합이 아니라 최솟값이 기준이다 */
  minSatisfaction: number | null;
  satisfactionGap: number | null;
  /** 선택되지 않았지만 기록된 의견. 소수 의견도 남긴다 */
  dissents: {
    roundId: RoundId;
    userId: string;
    reason: string;
    mitigation: string | null;
  }[];
}

/* ------------------------------------------------------------------ 이의 제기 */

/** 이의 잔여 횟수와 이력. 제출 전 preview는 별도 엔드포인트다 */
export interface ObjectionQuotaView {
  caps: { perRoom: number; perUser: number };
  used: { room: number; user: number };
  remaining: { room: number; user: number; canSubmit: boolean };
  objections: ObjectionRecord[];
}
