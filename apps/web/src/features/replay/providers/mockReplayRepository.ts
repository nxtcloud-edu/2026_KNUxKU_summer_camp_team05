import { meetingRounds, replayEpisodes } from '../../../data'
import { adaptLegacyReplay } from '../adapters/legacyReplayAdapter'
import type { ReplayRepository } from '../types'

export const DEMO_REPLAY_REQUEST = {
  tripId: 'osaka-2410',
  planVersionId: 'demo-plan-v1',
} as const

const abortError = () => new DOMException('Replay request aborted.', 'AbortError')

export const mockReplayRepository: ReplayRepository = {
  async getReplay(request, { signal } = {}) {
    if (signal?.aborted) throw abortError()
    await Promise.resolve()
    if (signal?.aborted) throw abortError()
    if (request.tripId !== DEMO_REPLAY_REQUEST.tripId || request.planVersionId !== DEMO_REPLAY_REQUEST.planVersionId) return null

    return adaptLegacyReplay(request.tripId, request.planVersionId, meetingRounds, replayEpisodes)
  },
}
