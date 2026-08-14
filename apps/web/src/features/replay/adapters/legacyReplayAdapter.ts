import type { MeetingReplayData, ReplayMessage, ReplayRound, ReplaySide } from '../types'

type LegacyRound = { code: string; name: string }
type LegacyMessage = { side: ReplaySide; speaker: string; text: string }
type LegacyEpisode = {
  redCorner: string
  blueCorner: string
  conversation: readonly LegacyMessage[]
  score: string
  factTitle: string
  facts: readonly string[]
  compromise: readonly string[]
  resultTitle: string
  resultCopy: string
  concession: string
}

const requiredText = (value: string, field: string) => {
  const text = value.trim()
  if (!text) throw new Error(`Replay field is empty: ${field}`)
  return text
}

const initialFromSpeaker = (speaker: string) => speaker.trim().charAt(0) || undefined

export function adaptLegacyReplay(
  tripId: string,
  planVersionId: string,
  rounds: readonly LegacyRound[],
  episodes: readonly LegacyEpisode[],
): MeetingReplayData {
  if (!rounds.length || rounds.length !== episodes.length) {
    throw new Error('Replay rounds and episodes must have the same non-zero length.')
  }

  const adaptedRounds: ReplayRound[] = rounds.map((round, roundIndex) => {
    const episode = episodes[roundIndex]
    const roundId = `round-${round.code.toLowerCase()}`
    const messages: ReplayMessage[] = episode.conversation.map((message, messageIndex) => ({
      id: `${roundId}-message-${messageIndex + 1}`,
      side: message.side,
      speakerLabel: requiredText(message.speaker, `${roundId}.messages.speaker`),
      speakerInitial: initialFromSpeaker(message.speaker),
      text: requiredText(message.text, `${roundId}.messages.text`),
    }))
    const speakerFor = (side: ReplaySide) => messages.find((message) => message.side === side)?.speakerLabel ?? `${side === 'red' ? '빨간' : '파란'} 입장 대리인`

    return {
      id: roundId,
      code: requiredText(round.code, `${roundId}.code`),
      categoryLabel: requiredText(round.name, `${roundId}.categoryLabel`),
      positions: {
        red: { label: requiredText(episode.redCorner, `${roundId}.redPosition`), participantIds: messages.filter((message) => message.side === 'red').map((message) => message.id) },
        blue: { label: requiredText(episode.blueCorner, `${roundId}.bluePosition`), participantIds: messages.filter((message) => message.side === 'blue').map((message) => message.id) },
      },
      splitSummary: requiredText(episode.score, `${roundId}.splitSummary`),
      messages,
      factCheck: {
        title: requiredText(episode.factTitle, `${roundId}.factTitle`),
        facts: episode.facts.map((fact, factIndex) => ({ id: `${roundId}-fact-${factIndex + 1}`, label: requiredText(fact, `${roundId}.facts`) })),
      },
      compromises: episode.compromise.map((text, index) => ({
        id: `${roundId}-compromise-${index + 1}`,
        side: index % 2 === 0 ? 'red' : 'blue',
        speakerLabel: speakerFor(index % 2 === 0 ? 'red' : 'blue'),
        speakerInitial: initialFromSpeaker(speakerFor(index % 2 === 0 ? 'red' : 'blue')),
        text: requiredText(text, `${roundId}.compromise`),
      })),
      result: {
        title: requiredText(episode.resultTitle, `${roundId}.resultTitle`),
        explanation: requiredText(episode.resultCopy, `${roundId}.resultCopy`),
        concession: episode.concession.trim() || undefined,
      },
    }
  })

  return { tripId, planVersionId, source: 'mock', rounds: adaptedRounds }
}
