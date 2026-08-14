import type { ResultEnvelope, TranscriptResponse } from '../../../api/backendContracts'
import { resolveDataMode } from '../../../api/dataMode'
import { isNotFound, requestJson } from '../../../api/httpClient'
import { adaptTranscriptReplay } from '../adapters/transcriptReplayAdapter'
import type { ReplayRepository } from '../types'
import { mockReplayRepository } from './mockReplayRepository'

/**
 * Live replay. Implements the exact interface `MockReplayRepository` does, so
 * `MeetingReplayPage` cannot tell the two apart.
 *
 * `null` means "no meeting to show yet" — the page renders its own empty state
 * for that, which is different from an error.
 *
 * Backend: GET /api/rooms/:roomId/transcript (apps/api/src/routes/results.ts)
 */
export const apiReplayRepository: ReplayRepository = {
  async getReplay(request, { signal } = {}) {
    const roomId = request.tripId
    if (!roomId) return null

    try {
      const envelope = await requestJson<ResultEnvelope<TranscriptResponse>>(
        `/api/rooms/${encodeURIComponent(roomId)}/transcript`,
        signal ? { signal } : {},
      )
      if (!envelope.data) return null
      const replay = adaptTranscriptReplay(roomId, envelope.data)
      return replay.rounds.length > 0 ? replay : null
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  },
}

export const createReplayRepository = (): ReplayRepository =>
  resolveDataMode() === 'mock' ? mockReplayRepository : apiReplayRepository

export const replayRepository = createReplayRepository()
