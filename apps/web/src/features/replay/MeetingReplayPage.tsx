import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowClockwise, FilmStrip, SpinnerGap, WarningCircle } from '@phosphor-icons/react'
import { MeetingReplay } from '../../components/MeetingReplay'
import { Page } from '../../components/ui'
import { mockReplayRepository } from './providers/mockReplayRepository'
import type { MeetingReplayData, ReplayRepository, ReplayRequest } from './types'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: MeetingReplayData }
  | { status: 'unavailable' }
  | { status: 'error' }

type MeetingReplayPageProps = {
  request: ReplayRequest
  initialRoundId?: string
  repository?: ReplayRepository
  back: () => void
  roundChanged?: (roundId: string) => void
}

export function MeetingReplayPage({
  request,
  initialRoundId,
  repository = mockReplayRepository,
  back,
  roundChanged,
}: MeetingReplayPageProps) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const { tripId, planVersionId, decisionId } = request

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })

    repository.getReplay({ tripId, planVersionId, decisionId }, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return
        if (!data || data.rounds.length === 0) setState({ status: 'unavailable' })
        else setState({ status: 'ready', data })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
        setState({ status: 'error' })
      })

    return () => controller.abort()
  }, [attempt, decisionId, planVersionId, repository, tripId])

  if (state.status === 'ready') {
    return (
      <MeetingReplay
        key={`${state.data.tripId}:${state.data.planVersionId}`}
        data={state.data}
        initialRoundId={initialRoundId}
        back={back}
        roundChanged={roundChanged}
      />
    )
  }

  const isLoading = state.status === 'loading'
  const isUnavailable = state.status === 'unavailable'

  return (
    <Page narrow>
      <main className="moa-replay-resource-state" aria-busy={isLoading}>
        <button className="moa-scene-back" onClick={back} aria-label="우리 여행으로 돌아가기"><ArrowLeft /></button>
        {isLoading ? <SpinnerGap className="loading" aria-hidden="true" /> : isUnavailable ? <FilmStrip aria-hidden="true" /> : <WarningCircle aria-hidden="true" />}
        <span>MEETING REPLAY</span>
        <h1>{isLoading ? '회의 기록을 불러오는 중' : isUnavailable ? '아직 볼 수 있는 회의가 없어요' : '회의 기록을 불러오지 못했어요'}</h1>
        <p>{isLoading ? '여행의 결정 과정을 준비하고 있어요.' : isUnavailable ? '계획이 만들어지면 결정 과정을 여기에서 다시 볼 수 있어요.' : '잠시 후 다시 시도하거나 우리 여행으로 돌아가 주세요.'}</p>
        {!isLoading && (
          <button className="moa-button" onClick={() => setAttempt((current) => current + 1)}>
            <ArrowClockwise /> 다시 시도
          </button>
        )}
      </main>
    </Page>
  )
}
