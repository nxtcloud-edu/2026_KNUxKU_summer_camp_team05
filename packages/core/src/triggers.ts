/**
 * 실행 트리거 3종 — 언제 회의를 시작하는가.
 *
 * 사용자는 회의에 개입할 수 없다. 그래서 "누가 참석자인가"를 정하는 이 판정이
 * 결과의 공정성을 직접 결정한다. LLM이 아니라 코드가 판단해야 하는 이유다.
 *
 * 규칙의 핵심은 하나다: **페르소나 확인은 건너뛸 수 없는 게이트다.**
 * 설문만 내고 페르소나를 확인하지 않은 사람은 참석자가 아니다 — 확인하지 않은
 * 대리인이 그 사람을 대변하면, 그건 대리가 아니라 추측이다.
 *
 * 근거: travel-mediation-plan.md 7장 · team-assignments.md T4 트리거 3종
 */

export const startTriggers = ['all_done', 'host', 'deadline'] as const;
export type StartTrigger = (typeof startTriggers)[number];

export interface TriggerMember {
  userId: string;
  role: 'host' | 'member';
  surveySubmitted: boolean;
  /** 페르소나 카드를 확인했는가. 이 게이트를 통과해야 참석자가 된다 */
  personaConfirmed: boolean;
}

export interface TriggerContext {
  roomStatus: 'COLLECTING' | 'DATE_RESOLVING' | 'READY' | 'QUEUED' | 'RUNNING' | 'COMPLETED';
  members: readonly TriggerMember[];
  /** 마감 기한 트리거의 기준 시각 (ISO). 없으면 마감 트리거를 쓸 수 없다 */
  deadlineAt?: string | null;
  now: string;
  /** `host` 트리거를 요청한 사용자 */
  requesterId?: string;
}

export type TriggerRejection =
  | 'already_running'
  | 'not_enough_members'
  | 'survey_incomplete'
  | 'persona_unconfirmed'
  | 'not_host'
  | 'deadline_not_set'
  | 'deadline_not_reached'
  | 'not_enough_attendees';

export interface TriggerDecision {
  allowed: boolean;
  reason: TriggerRejection | null;
  /** 회의에 대변인을 세울 사람 */
  attendees: string[];
  /** 참석하지 못하는 사람. 결과 화면에 그대로 표시한다 (침묵 금지) */
  absentees: { userId: string; reason: 'no_survey' | 'no_persona_confirm' }[];
}

/** 최소 참석 인원. 2명이면 중재가 성립한다 (1명은 중재할 것이 없다) */
export const MIN_ATTENDEES = 2;

const RUNNING_STATUSES = new Set(['QUEUED', 'RUNNING', 'COMPLETED']);

function partition(members: readonly TriggerMember[]): {
  attendees: string[];
  absentees: TriggerDecision['absentees'];
} {
  const attendees: string[] = [];
  const absentees: TriggerDecision['absentees'] = [];

  for (const member of members) {
    if (!member.surveySubmitted) {
      absentees.push({ userId: member.userId, reason: 'no_survey' });
      continue;
    }
    if (!member.personaConfirmed) {
      // 설문은 냈지만 페르소나를 확인하지 않았다. 대변인을 세우지 않는다.
      absentees.push({ userId: member.userId, reason: 'no_persona_confirm' });
      continue;
    }
    attendees.push(member.userId);
  }

  return { attendees, absentees };
}

export function evaluateStartTrigger(
  trigger: StartTrigger,
  context: TriggerContext,
): TriggerDecision {
  const { attendees, absentees } = partition(context.members);
  const reject = (reason: TriggerRejection): TriggerDecision => ({
    allowed: false,
    reason,
    attendees,
    absentees,
  });

  // 이미 돌고 있거나 끝난 방을 다시 시작하지 않는다. 재실행은 이의 경로다.
  if (RUNNING_STATUSES.has(context.roomStatus)) return reject('already_running');
  if (context.members.length < MIN_ATTENDEES) return reject('not_enough_members');

  switch (trigger) {
    case 'all_done': {
      // 전원이 설문과 페르소나 확인을 마쳐야 한다. 기다릴 수 있으면 기다리는 게 낫다.
      const noSurvey = absentees.some((row) => row.reason === 'no_survey');
      if (noSurvey) return reject('survey_incomplete');
      if (absentees.length > 0) return reject('persona_unconfirmed');
      break;
    }

    case 'host': {
      // 방장이 "이제 시작"이라고 하면 미응답자를 두고 진행한다.
      const host = context.members.find((member) => member.role === 'host');
      if (
        context.requesterId === undefined ||
        host === undefined ||
        host.userId !== context.requesterId
      ) {
        return reject('not_host');
      }
      break;
    }

    case 'deadline': {
      if (context.deadlineAt === undefined || context.deadlineAt === null) {
        return reject('deadline_not_set');
      }
      if (Date.parse(context.now) < Date.parse(context.deadlineAt)) {
        return reject('deadline_not_reached');
      }
      break;
    }
  }

  // 미응답자를 빼고 나면 중재할 인원이 남지 않는 경우가 있다.
  if (attendees.length < MIN_ATTENDEES) return reject('not_enough_attendees');

  return { allowed: true, reason: null, attendees, absentees };
}

/** 사용자에게 그대로 보여줄 문구. 거부 사유를 숨기지 않는다 */
export const triggerRejectionMessage: Record<TriggerRejection, string> = {
  already_running: '이미 실행 중이거나 완료된 방입니다. 결과를 바꾸려면 이의를 제기하세요.',
  not_enough_members: `참여자가 ${MIN_ATTENDEES}명 이상이어야 합니다.`,
  survey_incomplete: '아직 설문을 제출하지 않은 참여자가 있습니다.',
  persona_unconfirmed: '페르소나 카드를 확인하지 않은 참여자가 있습니다.',
  not_host: '방장만 시작할 수 있습니다.',
  deadline_not_set: '마감 기한이 설정되어 있지 않습니다.',
  deadline_not_reached: '아직 마감 기한 전입니다.',
  not_enough_attendees: `대변인을 세울 수 있는 참여자가 ${MIN_ATTENDEES}명 미만입니다.`,
};
