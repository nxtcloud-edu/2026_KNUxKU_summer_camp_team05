export type ReplaySide = 'red' | 'blue'

export type ReplayRequest = {
  tripId: string
  planVersionId: string
  decisionId?: string
}

export type ReplayPosition = {
  label: string
  participantIds: string[]
}

export type ReplayMessage = {
  id: string
  side: ReplaySide
  speakerLabel: string
  speakerInitial?: string
  text: string
}

export type ReplayFact = {
  id: string
  label: string
  evidenceId?: string
}

export type ReplayRound = {
  id: string
  code: string
  categoryLabel: string
  positions: Record<ReplaySide, ReplayPosition>
  splitSummary: string
  messages: ReplayMessage[]
  factCheck: {
    title: string
    facts: ReplayFact[]
  }
  compromises: ReplayMessage[]
  result: {
    title: string
    explanation: string
    concession?: string
  }
}

export type MeetingReplayData = {
  tripId: string
  planVersionId: string
  generatedAt?: string
  source: 'mock' | 'backend'
  rounds: ReplayRound[]
}

export type ReplayRepository = {
  getReplay: (
    request: ReplayRequest,
    options?: { signal?: AbortSignal },
  ) => Promise<MeetingReplayData | null>
}
