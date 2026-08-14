import { useCallback, useEffect, useState } from 'react'
import type { DestinationPack } from '../../../product/types'
import { resultsRepository, type TripResultSnapshot } from '../api/resultsRepository'

/**
 * The trip result. Reloadable, because a rerun replaces it.
 */
export function useTripResult({
  roomId,
  destination,
  participantCount,
  active,
}: {
  roomId: string | null
  destination: DestinationPack
  participantCount: number
  active: boolean
}) {
  const [snapshot, setSnapshot] = useState<TripResultSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSnapshot(await resultsRepository.getResult({ roomId, destination, participantCount }))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '결과를 불러오지 못했어요.')
    } finally {
      setLoading(false)
    }
  }, [destination, participantCount, roomId])

  useEffect(() => {
    if (!active) return
    void load()
  }, [active, load])

  return { snapshot, loading, error, reload: load }
}
