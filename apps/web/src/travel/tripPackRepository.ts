import { adaptProviderTripPack } from './adapters/tripPackAdapter'
import { mockTravelProvider } from './providers/mockTravelProvider'
import type { TripPack } from './models'

type TripPackRequestOptions = {
  signal?: AbortSignal
}

const abortError = () => new DOMException('The trip request was aborted.', 'AbortError')

export async function getTripPack(
  tripId: string,
  { signal }: TripPackRequestOptions = {},
): Promise<TripPack> {
  if (signal?.aborted) throw abortError()

  // Keep the consumer asynchronous so replacing this provider with an API does
  // not require another Results component rewrite.
  await Promise.resolve()
  if (signal?.aborted) throw abortError()

  const providerTrip = mockTravelProvider.getTripPack(tripId)
  if (!providerTrip) throw new Error(`Trip not found: ${tripId}`)

  return adaptProviderTripPack(providerTrip)
}
