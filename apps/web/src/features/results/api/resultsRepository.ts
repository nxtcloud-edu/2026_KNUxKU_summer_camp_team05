import type {
  FairnessResponse,
  PlanResultResponse,
  ResultAvailability,
  ResultEnvelope,
} from '../../../api/backendContracts'
import { resolveDataMode } from '../../../api/dataMode'
import { requestJson } from '../../../api/httpClient'
import { demoResultForDestination } from '../../../product/mockData'
import type { DestinationPack, ProductResult } from '../../../product/types'
import { adaptPlanResult } from '../adapters/planResultAdapter'

/**
 * The result screen's only data source.
 *
 * `availability`/`reason` travel with the payload so an empty result can explain
 * itself: "the meeting has not started" and "the plan failed validation" are
 * different states and the UI must not blur them into one blank page.
 *
 * Backend: apps/api/src/routes/results.ts
 */
export type TripResultSnapshot = {
  availability: ResultAvailability
  reason: string | null
  result: ProductResult | null
}

export type ResultsQuery = {
  roomId: string | null
  destination: DestinationPack
  participantCount: number
}

export interface ResultsRepository {
  getResult(query: ResultsQuery): Promise<TripResultSnapshot>
}

export class MockResultsRepository implements ResultsRepository {
  async getResult({ destination }: ResultsQuery): Promise<TripResultSnapshot> {
    return {
      availability: 'ready',
      reason: null,
      result: demoResultForDestination(destination),
    }
  }
}

export class ApiResultsRepository implements ResultsRepository {
  async getResult({ roomId, destination, participantCount }: ResultsQuery): Promise<TripResultSnapshot> {
    if (!roomId) {
      return { availability: 'pending', reason: '아직 참여한 여행 방이 없어요.', result: null }
    }

    const [planEnvelope, fairnessEnvelope] = await Promise.all([
      requestJson<ResultEnvelope<PlanResultResponse>>(`/api/rooms/${encodeURIComponent(roomId)}/plan`),
      requestJson<ResultEnvelope<FairnessResponse>>(`/api/rooms/${encodeURIComponent(roomId)}/fairness`)
        .catch(() => ({ availability: 'pending' as ResultAvailability, reason: null, data: null })),
    ])

    if (!planEnvelope.data) {
      return { availability: planEnvelope.availability, reason: planEnvelope.reason, result: null }
    }

    return {
      availability: planEnvelope.availability,
      reason: planEnvelope.reason,
      result: adaptPlanResult({
        plan: planEnvelope.data,
        fairness: fairnessEnvelope.data,
        destination,
        participantCount,
      }),
    }
  }
}

export const createResultsRepository = (): ResultsRepository =>
  resolveDataMode() === 'mock' ? new MockResultsRepository() : new ApiResultsRepository()

export const resultsRepository = createResultsRepository()
