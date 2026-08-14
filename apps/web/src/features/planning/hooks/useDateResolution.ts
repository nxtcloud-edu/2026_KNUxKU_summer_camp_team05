import { useEffect, useState } from 'react'
import { planningRepository, type DateResolutionOption, type DateResolutionSnapshot } from '../api/planningRepository'

/**
 * The trip dates. In `api` mode these are whatever the DateResolver committed
 * to — the screen no longer hardcodes October.
 */
export function useDateResolution(roomId: string | null, active: boolean) {
  const [snapshot, setSnapshot] = useState<DateResolutionSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const next = await planningRepository.getDateResolution(roomId ?? '')
        if (!cancelled) setSnapshot(next)
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : '날짜 정보를 불러오지 못했어요.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [active, roomId])

  const chooseDate = async (option: DateResolutionOption) => {
    if (!roomId) return
    setLoading(true)
    setError(null)
    try {
      setSnapshot(await planningRepository.chooseDate(roomId, option))
    } catch (chooseError) {
      setError(chooseError instanceof Error ? chooseError.message : '날짜를 확정하지 못했어요.')
    } finally {
      setLoading(false)
    }
  }

  return { snapshot, loading, error, chooseDate }
}
