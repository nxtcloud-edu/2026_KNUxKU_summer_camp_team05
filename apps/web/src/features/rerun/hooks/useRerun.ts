import { useCallback, useEffect, useState } from 'react'
import { planningRepository, type PlanningSnapshot } from '../../planning/api/planningRepository'
import {
  rerunRepository,
  type ObjectionInput,
  type RerunImpactSnapshot,
  type RerunQuota,
  type RerunSubmission,
} from '../api/rerunRepository'

/**
 * Re-discussion, end to end:
 *
 *   preview impact -> submit objection -> poll progress -> caller reloads result
 *
 * Progress polling reuses the planning repository because a rerun *is* a run;
 * duplicating that logic would let the two screens disagree about what "done"
 * means.
 */
const POLL_MS = 2500

const message = (error: unknown, fallback: string) =>
  error instanceof Error && error.message.length > 0 ? error.message : fallback

export function useRerun(roomId: string | null, userId: string | null) {
  const [quota, setQuota] = useState<RerunQuota | null>(null)
  const [impact, setImpact] = useState<RerunImpactSnapshot | null>(null)
  const [submission, setSubmission] = useState<RerunSubmission | null>(null)
  const [progress, setProgress] = useState<PlanningSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!roomId || !userId) return
    let cancelled = false
    void rerunRepository.getQuota(roomId, userId)
      .then((next) => { if (!cancelled) setQuota(next) })
      .catch(() => { /* quota is informational; the submit call is authoritative */ })
    return () => { cancelled = true }
  }, [roomId, userId])

  const buildInput = useCallback((
    partial: Omit<ObjectionInput, 'roomId' | 'userId'>,
  ): ObjectionInput | null => {
    if (!roomId || !userId) return null
    return { ...partial, roomId, userId }
  }, [roomId, userId])

  const preview = useCallback(async (partial: Omit<ObjectionInput, 'roomId' | 'userId'>) => {
    const input = buildInput(partial)
    if (!input) {
      setError('여행 방 정보가 없어 영향 범위를 확인할 수 없어요.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      setImpact(await rerunRepository.preview(input))
    } catch (previewError) {
      setError(message(previewError, '영향 범위를 확인하지 못했어요.'))
    } finally {
      setBusy(false)
    }
  }, [buildInput])

  const submit = useCallback(async (partial: Omit<ObjectionInput, 'roomId' | 'userId'>) => {
    const input = buildInput(partial)
    if (!input) {
      setError('여행 방 정보가 없어 다시 논의를 요청할 수 없어요.')
      return false
    }
    setBusy(true)
    setError(null)
    try {
      const result = await rerunRepository.submit(input)
      setSubmission(result)
      if (result.rejectedReason) setError(result.rejectedReason)
      return result.rejectedReason === null
    } catch (submitError) {
      setError(message(submitError, '다시 논의를 요청하지 못했어요.'))
      return false
    } finally {
      setBusy(false)
    }
  }, [buildInput])

  /** Poll while the rerun is in flight. Approval-blocked reruns never start. */
  useEffect(() => {
    if (!roomId || !submission || submission.needsApproval) return
    if (progress?.finished) return

    let cancelled = false
    const read = async () => {
      try {
        const next = await planningRepository.getProgress(roomId)
        if (!cancelled) setProgress(next)
      } catch (pollError) {
        if (!cancelled) setError(message(pollError, '재실행 진행 상태를 읽지 못했어요.'))
      }
    }
    void read()
    const timer = window.setInterval(() => { void read() }, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [progress?.finished, roomId, submission])

  const reset = useCallback(() => {
    setImpact(null)
    setSubmission(null)
    setProgress(null)
    setError(null)
  }, [])

  return { quota, impact, submission, progress, busy, error, preview, submit, reset }
}
