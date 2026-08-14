import { useCallback, useEffect, useRef, useState } from 'react'
import { writeRunId } from '../../../session/roomSession'
import { planningRepository, type PlanningSnapshot } from '../api/planningRepository'

/**
 * The planning screen's state.
 *
 * Two things this deliberately does:
 *   · it re-reads progress on mount, so leaving the page and coming back shows
 *     the run that is already going instead of starting a second one,
 *   · it stops polling when the run finishes or fails, and keeps the failure
 *     reason. A stalled run that looks like it is still working is the worst
 *     outcome of an async model.
 */
const POLL_MS = 2500

export type PlanningRunState = {
  snapshot: PlanningSnapshot | null
  loading: boolean
  error: string | null
}

const message = (error: unknown, fallback: string) =>
  error instanceof Error && error.message.length > 0 ? error.message : fallback

export function usePlanningRun(roomId: string | null, active: boolean) {
  const [state, setState] = useState<PlanningRunState>({ snapshot: null, loading: true, error: null })
  const startedRef = useRef<string | null>(null)

  const read = useCallback(async (id: string) => {
    try {
      const snapshot = await planningRepository.getProgress(id)
      setState({ snapshot, loading: false, error: null })
      writeRunId(snapshot?.runId ?? null)
      return snapshot
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: message(error, '진행 상태를 읽지 못했어요.') }))
      return null
    }
  }, [])

  const start = useCallback(async (id: string) => {
    try {
      const snapshot = await planningRepository.startRun(id)
      setState({ snapshot, loading: false, error: null })
      writeRunId(snapshot.runId)
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: message(error, '회의를 시작하지 못했어요.') }))
    }
  }, [])

  useEffect(() => {
    if (!active || !roomId) return
    let cancelled = false

    void (async () => {
      const existing = await read(roomId)
      if (cancelled) return
      // Start only when no run exists for this room yet.
      if (!existing?.runId && startedRef.current !== roomId) {
        startedRef.current = roomId
        await start(roomId)
      }
    })()

    return () => { cancelled = true }
  }, [active, read, roomId, start])

  useEffect(() => {
    if (!active || !roomId) return
    if (state.snapshot?.finished) return
    const timer = window.setInterval(() => { void read(roomId) }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [active, read, roomId, state.snapshot?.finished])

  return { ...state, retry: () => (roomId ? read(roomId) : Promise.resolve(null)) }
}
