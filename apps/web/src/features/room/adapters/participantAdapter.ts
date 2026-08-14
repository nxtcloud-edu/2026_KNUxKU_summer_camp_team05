import type { Participant, ParticipantState } from '../../../product/types'
import type { MemberSnapshot } from '../api/roomRepository'

/**
 * Member row -> lobby participant.
 *
 * The backend has no display-name column yet (`TODO(members)` in
 * `apps/api/src/routes/results.ts`), so a live room shows a short form of the
 * user id rather than a made-up name.
 */
const shortName = (userId: string): string => {
  const tail = userId.split(/[:_]/).pop() ?? userId
  return tail.slice(0, 6)
}

const stateOf = (member: MemberSnapshot): ParticipantState => {
  if (member.surveySubmitted && member.personaConfirmedAt !== null) return 'complete'
  if (member.surveySubmitted) return 'in-progress'
  return 'incomplete'
}

const stateLabels: Record<ParticipantState, string> = {
  complete: '입력 완료',
  'in-progress': '기준 확인 대기',
  waiting: '입력 대기 중',
  incomplete: '입력 미완료',
}

export function toParticipant(member: MemberSnapshot): Participant {
  const name = member.displayName ?? shortName(member.userId)
  const state = stateOf(member)
  return {
    id: member.userId,
    name,
    initial: name.trim().charAt(0).toUpperCase() || '?',
    ...(member.role === 'host' ? { isHost: true } : {}),
    state,
    stateLabel: stateLabels[state],
    availabilityConfirmed: member.surveySubmitted,
    preferencesRepresented: member.personaConfirmedAt !== null,
  }
}
