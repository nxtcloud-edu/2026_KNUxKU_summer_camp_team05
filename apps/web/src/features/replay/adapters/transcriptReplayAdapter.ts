import type { TranscriptResponse, TranscriptRoundResponse } from '../../../api/backendContracts'
import type { MeetingReplayData, ReplayFact, ReplayMessage, ReplayRound, ReplaySide } from '../types'

/**
 * Backend transcript -> replay view model.
 *
 * The replay is the record of *why* a decision happened, so this adapter keeps
 * what the meeting actually produced and marks what it did not:
 *
 *   · persona utterances become the two sides of the argument,
 *   · referee utterances become the compromise track,
 *   · a round without a verdict says so instead of inventing a result.
 */
const categoryLabels: Record<string, string> = {
  supervisor: '회의 순서 정리',
  flight: '오는 길·가는 길',
  transport: '현지 이동',
  accommodation: '체류 거점·숙소',
  activity: '갈 곳·할 일',
  dining: '식사',
  scheduler: '날짜별 일정',
  budget: '최종 확인',
}

const roundCode = (roundId: string) => roundId.replace(/_/g, '').toUpperCase()

const evidenceIdsFrom = (refs: Record<string, unknown>): string[] => {
  const collected: string[] = []
  for (const value of Object.values(refs)) {
    if (typeof value === 'string') collected.push(value)
    else if (Array.isArray(value)) collected.push(...value.filter((entry): entry is string => typeof entry === 'string'))
  }
  return collected
}

function adaptRound(round: TranscriptRoundResponse): ReplayRound | null {
  const personaMessages = round.messages.filter((message) => message.speakerType === 'persona')
  const refereeMessages = round.messages.filter((message) => message.speakerType !== 'persona')
  if (personaMessages.length === 0 && refereeMessages.length === 0) return null

  // Two sides, assigned by first appearance. The backend does not label sides.
  const speakers = [...new Set(personaMessages.map((message) => message.speakerName))]
  const sideOf = (speakerName: string): ReplaySide =>
    speakers.indexOf(speakerName) % 2 === 0 ? 'red' : 'blue'

  const id = `round-${round.roundId.replace(/_/g, '')}`
  const messages: ReplayMessage[] = personaMessages.map((message) => ({
    id: `${id}-message-${message.seq}`,
    side: sideOf(message.speakerName),
    speakerLabel: message.speakerName,
    ...(message.speakerName.trim().charAt(0) ? { speakerInitial: message.speakerName.trim().charAt(0) } : {}),
    text: message.content,
  }))

  const redSpeakers = speakers.filter((_, index) => index % 2 === 0)
  const blueSpeakers = speakers.filter((_, index) => index % 2 === 1)

  const facts: ReplayFact[] = round.messages.flatMap((message) => {
    const evidenceIds = evidenceIdsFrom(message.refs)
    if (evidenceIds.length === 0) return []
    return evidenceIds.map((evidenceId, index) => ({
      id: `${id}-fact-${message.seq}-${index}`,
      label: message.content,
      evidenceId,
    }))
  })

  const winner = round.verdict?.winner.candidateIds ?? []
  const dissent = round.verdict?.dissent ?? []

  return {
    id,
    code: roundCode(round.roundId),
    categoryLabel: categoryLabels[round.category] ?? round.category,
    positions: {
      red: { label: redSpeakers.join(' · ') || '입장 기록 없음', participantIds: redSpeakers },
      blue: { label: blueSpeakers.join(' · ') || '입장 기록 없음', participantIds: blueSpeakers },
    },
    splitSummary: `발언 ${round.messages.length}건 · 소수 의견 ${dissent.length}건`,
    messages,
    factCheck: {
      title: facts.length > 0 ? '발언이 참조한 근거' : '이 라운드에 기록된 근거가 없어요',
      facts,
    },
    compromises: refereeMessages.map((message) => ({
      id: `${id}-compromise-${message.seq}`,
      side: 'blue' as ReplaySide,
      speakerLabel: message.speakerName,
      text: message.content,
    })),
    result: {
      title: winner.length > 0 ? winner.join(' · ') : round.phase === 'SETTLED' ? '채택된 후보 없음' : '판결 전',
      explanation: round.verdict === null
        ? '아직 판결이 기록되지 않았어요.'
        : typeof round.verdict.winner.rationale === 'string' && round.verdict.winner.rationale.length > 0
          ? round.verdict.winner.rationale
          : '판결 사유가 기록되지 않았어요.',
      ...(dissent[0]?.mitigation ? { concession: dissent[0].mitigation } : {}),
    },
  }
}

export function adaptTranscriptReplay(
  roomId: string,
  transcript: TranscriptResponse,
): MeetingReplayData {
  return {
    tripId: roomId,
    planVersionId: transcript.runId,
    source: 'backend',
    rounds: transcript.rounds.flatMap((round) => adaptRound(round) ?? []),
  }
}
