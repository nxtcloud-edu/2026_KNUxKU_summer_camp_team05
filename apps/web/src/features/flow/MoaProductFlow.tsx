import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle, SpinnerGap } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'framer-motion'
import { resolveDataMode } from '../../api/dataMode'
import { clearAuthUser, readAuthUser, type AuthUser } from '../../authApi'
import { DestinationPicker } from '../../components/DestinationPicker'
import { Header } from '../../components/Header'
import { Landing } from '../../components/Landing'
import { DestinationRequestModal, LoginModal, MarketingModal, ProfileModal } from '../../components/PrototypeModals'
import { copyText, shareTrip } from '../../exportUtils'
import { changedRerunDiff, featuredDestinations, tripPaces, unchangedRerunDiff } from '../../product/mockData'
import type { ProductResult, RerunDiff } from '../../product/types'
import type { LandingModal, ResultMode, Stage } from '../../types'
import {
  buildInviteUrl,
  canReturnToStage,
  readDecisionIdFromUrl,
  readInitialResultMode,
  readInitialStage,
  readReplayNavigationState,
  readResultModeFromUrl,
  readRoomIdFromUrl,
  readStageFromUrl,
  writeNavigationState,
  type ReplayNavigationState,
} from '../../utils/navigation'
import { readStoredRunId } from '../../session/roomSession'
import { writeStorage } from '../../utils/storage'
import { PersonaConfirmScreen } from '../persona/PersonaConfirmScreen'
import { DateResolutionScreen, PlanningScreen } from '../planning/PlanningScreens'
import { useDateResolution } from '../planning/hooks/useDateResolution'
import { usePlanningRun } from '../planning/hooks/usePlanningRun'
import { MeetingReplayPage } from '../replay/MeetingReplayPage'
import { DEMO_REPLAY_REQUEST } from '../replay/providers/mockReplayRepository'
import { replayRepository } from '../replay/providers/apiReplayRepository'
import { DecisionDetail, ProductResults } from '../results/ProductResults'
import { useTripResult } from '../results/hooks/useTripResult'
import { InviteRoom, ProductLobby } from '../room/RoomScreens'
import { recordMockSurveySubmission } from '../room/api/roomRepository'
import { useTripRoom } from '../room/hooks/useTripRoom'
import { ReopenFlow, RerunProcessing, RerunResult } from '../rerun/RerunScreens'
import { useRerun } from '../rerun/hooks/useRerun'
import { buildRerunDiff } from '../rerun/adapters/rerunDiffAdapter'
import { TripBuilderSurvey } from '../survey/TripBuilderSurvey'
import { useProductFlow } from './useProductFlow'

function MissingDecisionState({ back }: { back: () => void }) {
  return <section className="moa-missing-decision moa-results-theme" role="status"><div className="moa-result-empty"><strong>아직 확정된 결정이 없어요.</strong><span>여행 조건을 확인한 뒤 결과를 다시 불러와 주세요.</span><button type="button" onClick={back}>결과로 돌아가기</button></div></section>
}

function ResultLoadingState() {
  return <section className="moa-missing-decision moa-results-theme" role="status"><div className="moa-result-empty"><strong><SpinnerGap /> 우리 여행 결과를 불러오고 있어요.</strong></div></section>
}

/** An empty result explains itself: pending, running, partial and failed differ. */
function ResultEmptyState({ reason, back, retry }: { reason: string | null; back: () => void; retry: () => void }) {
  return <section className="moa-missing-decision moa-results-theme" role="status"><div className="moa-result-empty">
    <strong>아직 보여드릴 계획이 없어요.</strong>
    <span>{reason ?? '회의가 끝나면 결과를 여기에서 볼 수 있어요.'}</span>
    <button type="button" onClick={retry}>다시 불러오기</button>
    <button type="button" onClick={back}>여행 방으로</button>
  </div></section>
}

const resultStages: Stage[] = ['result', 'decision', 'reopen', 'updated-result']

export function MoaProductFlow() {
  const [stage, setStage] = useState<Stage>(readInitialStage)
  const [mode, setMode] = useState<ResultMode>(readInitialResultMode)
  const [landingModal, setLandingModal] = useState<LandingModal>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const [authUser, setAuthUser] = useState<AuthUser | null>(readAuthUser)
  const [toast, setToast] = useState('')
  const [personaCriteria, setPersonaCriteria] = useState<string[]>([])
  const [personaBusy, setPersonaBusy] = useState(false)
  const [personaError, setPersonaError] = useState<string | null>(null)
  const [rerunDiff, setRerunDiff] = useState<RerunDiff | null>(null)
  const navigationInitialized = useRef(false)
  const initialDecisionId = useRef(readDecisionIdFromUrl())
  const resultsUnderlayRef = useRef<HTMLDivElement>(null)
  const resultBeforeRerun = useRef<ProductResult | null>(null)
  const { state, dispatch } = useProductFlow(initialDecisionId.current)
  const dataMode = resolveDataMode()

  /* ---------------------------------------------------------------- data */

  const room = useTripRoom(stage === 'lobby' || stage === 'invite')
  const participantCount = room.room?.memberCount ?? room.participants.length
  const dateResolution = useDateResolution(room.roomId, stage === 'date-resolution')
  const planning = usePlanningRun(room.roomId, stage === 'planning')
  const tripResult = useTripResult({
    roomId: room.roomId,
    destination: state.destination,
    participantCount: participantCount > 0 ? participantCount : 1,
    active: resultStages.includes(stage) || stage === 'replay',
  })
  const rerun = useRerun(room.roomId, room.userId)

  const productResult = tripResult.snapshot?.result ?? null
  const pace = productResult?.pace ?? tripPaces[1]
  const decisions = useMemo(() => productResult?.decisions ?? [], [productResult])
  const selectedDecision = decisions.find((item) => item.id === state.selectedDecisionId) ?? decisions[0]
  const selectedDecisionIndex = selectedDecision
    ? Math.max(decisions.findIndex((item) => item.id === selectedDecision.id), 0)
    : 0

  /* ------------------------------------------------------------ navigation */

  useEffect(() => { writeStorage('local', 'moa-stage', stage) }, [stage])
  useEffect(() => {
    if (navigationInitialized.current) return
    writeNavigationState(stage, mode, 'replace', readReplayNavigationState() ?? undefined, state.selectedDecisionId)
    navigationInitialized.current = true
  }, [mode, stage, state.selectedDecisionId])
  useEffect(() => {
    const onPop = () => {
      const nextDecisionId = readDecisionIdFromUrl()
      if (nextDecisionId) dispatch({ type: 'decision', id: nextDecisionId })
      setStage(readStageFromUrl() ?? 'landing')
      setMode(readResultModeFromUrl() ?? 'overview')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [dispatch])
  useEffect(() => { if (resultsUnderlayRef.current) resultsUnderlayRef.current.inert = stage === 'decision' }, [stage])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const openPhoneDemo = useCallback(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('presentation', 'phone')
    url.searchParams.delete('embedded')
    url.searchParams.set('stage', 'landing')
    url.searchParams.delete('mode')
    url.searchParams.delete('decisionId')
    window.location.assign(url)
  }, [])

  const go = useCallback((next: Stage, replay?: ReplayNavigationState) => {
    if (next === 'reopen') dispatch({ type: 'reset-reopen' })
    writeNavigationState(next, mode, 'push', replay, state.selectedDecisionId)
    setStage(next)
    if (next !== 'decision') window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [dispatch, mode, state.selectedDecisionId])

  const changeMode = useCallback((next: ResultMode) => {
    setMode(next)
    writeNavigationState('result', next, 'replace')
  }, [])

  const returnOrReplace = useCallback((current: Stage, returnStages: Stage | Stage[], fallback: Stage) => {
    if (canReturnToStage(current, returnStages)) {
      window.history.back()
      return
    }
    writeNavigationState(fallback, mode, 'replace', undefined, state.selectedDecisionId)
    setStage(fallback)
  }, [mode, state.selectedDecisionId])
  const closeDecision = useCallback(() => returnOrReplace('decision', 'result', 'result'), [returnOrReplace])
  const returnFromReopen = useCallback(() => returnOrReplace('reopen', 'decision', 'decision'), [returnOrReplace])
  const returnFromReplay = useCallback(() => returnOrReplace('replay', ['result', 'decision'], 'result'), [returnOrReplace])

  /* ----------------------------------------------------------------- room */

  const inviteUrl = buildInviteUrl(room.roomId)
  const copyInvite = async () => {
    try {
      await copyText(inviteUrl)
      setToast(room.roomId ? '초대 링크를 복사했어요' : '데모 초대 링크를 복사했어요')
    } catch { setToast('링크를 복사하지 못했어요') }
  }
  const shareInvite = async () => {
    try {
      const result = await shareTrip(inviteUrl, { name: state.destination.name })
      setToast(result === 'shared' ? '공유 화면을 열었어요' : '링크를 복사했어요')
    } catch { setToast('공유를 취소했어요') }
  }

  /** Destination chosen: open a real room before showing the invite screen. */
  const createRoomAndInvite = useCallback(async () => {
    const roomId = await room.createRoom(state.destination.id)
    if (!roomId) {
      setToast('여행 방을 만들지 못했어요')
      return
    }
    go('invite')
  }, [go, room, state.destination.id])

  /** Invite link opened: join the room in the link, not a demo room. */
  const enterLobby = useCallback(async () => {
    const linkedRoomId = readRoomIdFromUrl() ?? room.roomId
    if (linkedRoomId) {
      if (linkedRoomId !== room.room?.roomId) await room.joinRoom(linkedRoomId)
    } else if (dataMode === 'mock') {
      await room.createRoom(state.destination.id)
    } else {
      setToast('초대 링크로 들어와 주세요')
      return
    }
    go('lobby')
  }, [dataMode, go, room, state.destination.id])

  /**
   * Demo mode self-heals: landing on a room stage without a room (an old
   * bookmark, a shared `?stage=lobby` link) opens a fixture room instead of
   * showing an empty lobby. In api mode we never fabricate a room.
   */
  const roomStage = ['invite', 'lobby', 'survey', 'persona', 'date-resolution', 'planning'].includes(stage)
  const { roomId, loading: roomLoading, createRoom } = room
  useEffect(() => {
    if (roomId || !roomStage || dataMode !== 'mock' || roomLoading) return
    void createRoom(state.destination.id)
  }, [createRoom, dataMode, roomId, roomLoading, roomStage, state.destination.id])

  const finishSurvey = useCallback(async (criteria: string[]) => {
    setPersonaCriteria(criteria)
    setPersonaError(null)
    if (room.roomId) {
      await recordMockSurveySubmission(room.roomId)
      await room.refresh(room.roomId)
    }
    go('persona')
  }, [go, room])

  const confirmPersona = useCallback(async () => {
    setPersonaBusy(true)
    setPersonaError(null)
    try {
      await room.confirmPersona()
      go('date-resolution')
    } catch (error) {
      setPersonaError(error instanceof Error ? error.message : '기준을 확인하지 못했어요.')
    } finally {
      setPersonaBusy(false)
    }
  }, [go, room])

  /* --------------------------------------------------------------- replay */

  const replayLocation = readReplayNavigationState()
  const liveReplayRequest = room.roomId
    ? { tripId: room.roomId, planVersionId: planning.snapshot?.runId ?? readStoredRunId() ?? 'latest' }
    : null
  const replayRequest = replayLocation
    ? { tripId: replayLocation.tripId, planVersionId: replayLocation.planVersionId, decisionId: replayLocation.decisionId }
    : dataMode === 'api' && liveReplayRequest
      ? { ...liveReplayRequest, ...(selectedDecision ? { decisionId: selectedDecision.id } : {}) }
      : selectedDecision
        ? { ...DEMO_REPLAY_REQUEST, decisionId: selectedDecision.id }
        : DEMO_REPLAY_REQUEST
  const initialReplayRoundId = replayLocation?.roundId ?? 'round-r2'
  const openReplay = () => { if (selectedDecision) go('replay', { ...replayRequest, roundId: initialReplayRoundId }) }
  const updateReplayRound = (roundId: string) => writeNavigationState('replay', mode, 'replace', { ...replayRequest, roundId })

  const openDecision = useCallback((id: string, next: 'decision' | 'reopen') => {
    if (!decisions.some((item) => item.id === id)) return
    dispatch({ type: 'decision', id })
    writeNavigationState(next, mode, 'push', undefined, id)
    setStage(next)
    if (next !== 'decision') window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [decisions, dispatch, mode])

  /* ---------------------------------------------------------------- rerun */

  const reopenObjection = useMemo(() => {
    if (!selectedDecision || !state.reopenReason) return null
    const followUp = state.reopenChoice === 'station' ? '역과 가까운 위치를 더 중요하게' : '더 넓은 객실을 더 중요하게'
    return {
      decisionId: selectedDecision.id,
      category: selectedDecision.category,
      reason: state.reopenReason,
      note: `${selectedDecision.title} — ${followUp}`,
    }
  }, [selectedDecision, state.reopenChoice, state.reopenReason])

  const requestRerunImpact = useCallback(() => {
    if (reopenObjection) void rerun.preview(reopenObjection)
  }, [reopenObjection, rerun])

  const startRerun = useCallback(async () => {
    if (!reopenObjection) return
    resultBeforeRerun.current = productResult
    const accepted = await rerun.submit(reopenObjection)
    if (accepted) go('rerun-processing')
  }, [go, productResult, reopenObjection, rerun])

  /** Reload the plan when the rerun finishes and compare it with the old one. */
  const openUpdatedResult = useCallback(async () => {
    const before = resultBeforeRerun.current
    await tripResult.reload()
    const after = tripResult.snapshot?.result ?? null
    if (before && after && rerun.submission?.source === 'live') {
      setRerunDiff(buildRerunDiff(before, after, state.selectedDecisionId))
    } else {
      setRerunDiff(state.reopenReason === 'incorrect-fact' ? unchangedRerunDiff : changedRerunDiff)
    }
    go('updated-result')
  }, [go, rerun.submission?.source, state.reopenReason, state.selectedDecisionId, tripResult])

  /* --------------------------------------------------------------- render */

  const resultsWorkspace = productResult
    ? <div ref={resultsUnderlayRef} className="moa-results-underlay" aria-hidden={stage === 'decision' && selectedDecision ? true : undefined}>
      <ProductResults result={productResult} pace={pace} mode={mode} setMode={changeMode} back={() => go('lobby')} decision={(id) => openDecision(id, 'decision')} reopen={(id) => openDecision(id, 'reopen')} selectedDecisionId={selectedDecision?.id} selectDecision={(id) => dispatch({ type: 'decision', id })} />
    </div>
    : tripResult.loading
      ? <ResultLoadingState />
      : <ResultEmptyState reason={tripResult.error ?? tripResult.snapshot?.reason ?? null} back={() => go('lobby')} retry={() => { void tripResult.reload() }} />
  const missingDecision = <MissingDecisionState back={() => go('result')} />

  const screen = (() => {
    switch (stage) {
      case 'landing': return <Landing create={() => go('destinations')} join={() => { void enterLobby() }} intro={() => setLandingModal('intro')} how={() => setLandingModal('how')} phoneDemo={openPhoneDemo} signedIn={Boolean(authUser)} userInitial={authUser?.name.trim().charAt(0) || ''} login={() => authUser ? setProfileOpen(true) : setLandingModal('login')} />
      case 'destinations': return <DestinationPicker destinations={featuredDestinations} selected={state.destination} select={(value) => dispatch({ type: 'destination', value })} next={() => { void createRoomAndInvite() }} request={() => setRequestOpen(true)} />
      case 'invite': return <InviteRoom destination={state.destination} inviteUrl={inviteUrl} roomId={room.roomId} copy={() => { void copyInvite() }} share={() => { void shareInvite() }} next={() => go('lobby')} />
      case 'lobby': return <ProductLobby destination={state.destination} participants={room.participants} loading={room.loading} error={room.error} source={room.source} start={() => go('survey')} copy={() => { void copyInvite() }} />
      case 'survey': return <TripBuilderSurvey destination={state.destination} roomId={room.roomId} userId={room.userId} backToRoom={() => go('lobby')} complete={(criteria) => { void finishSurvey(criteria) }} />
      case 'persona': return <PersonaConfirmScreen destination={state.destination} criteria={personaCriteria} source={room.source} busy={personaBusy} error={personaError} confirm={() => { void confirmPersona() }} back={() => go('lobby')} />
      case 'date-resolution': return <DateResolutionScreen snapshot={dateResolution.snapshot} loading={dateResolution.loading} error={dateResolution.error} back={() => go('lobby')} next={() => go('planning')} />
      case 'planning': return <PlanningScreen snapshot={planning.snapshot} loading={planning.loading} error={planning.error} leave={() => go('lobby')} next={() => go('result')} />
      case 'result': return resultsWorkspace
      case 'decision': return selectedDecision ? resultsWorkspace : missingDecision
      case 'reopen': return selectedDecision
        ? <ReopenFlow decision={selectedDecision} reason={state.reopenReason} choice={state.reopenChoice} applyFuture={state.applyToFutureTrips} impact={rerun.impact} impactLoading={rerun.busy} impactError={rerun.error} submitting={rerun.busy} setReason={(value) => dispatch({ type: 'reopen-reason', value })} setChoice={(value) => dispatch({ type: 'reopen-choice', value })} setApplyFuture={(value) => dispatch({ type: 'apply-future', value })} requestImpact={requestRerunImpact} back={returnFromReopen} start={() => { void startRerun() }} />
        : missingDecision
      case 'rerun-processing': return selectedDecision
        ? <RerunProcessing decision={selectedDecision} progress={rerun.progress} waitingApproval={rerun.submission?.needsApproval ?? false} error={rerun.error} leave={() => go('result')} next={() => { void openUpdatedResult() }} />
        : missingDecision
      case 'updated-result': return <RerunResult diff={rerunDiff ?? (state.reopenReason === 'incorrect-fact' ? unchangedRerunDiff : changedRerunDiff)} evidence={() => go('decision')} back={() => go('result')} />
      case 'replay': return <MeetingReplayPage request={replayRequest} initialRoundId={initialReplayRoundId} repository={replayRepository} back={returnFromReplay} roundChanged={updateReplayRound} />
    }
  })()

  const resultsStage = resultStages.includes(stage)
  const screenKey = stage === 'result' || stage === 'decision' ? 'results' : stage
  return <div className={`moa-app${resultsStage ? ' moa-results-active' : ''}`}>
    {stage !== 'landing' && !resultsStage && stage !== 'replay' && stage !== 'survey' && <Header stage={stage} destinationLabel={`${state.destination.name} 여행`} home={() => go('landing')} room={() => go('lobby')} profile={() => authUser ? setProfileOpen(true) : setLandingModal('login')} userInitial={authUser?.name.trim().charAt(0) || 'F'} />}
    <AnimatePresence mode="wait"><motion.main key={screenKey} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: .2 }}>{screen}</motion.main></AnimatePresence>
    {stage === 'decision' && selectedDecision && <DecisionDetail decision={selectedDecision} index={selectedDecisionIndex} back={closeDecision} reopen={() => go('reopen')} replay={openReplay} mobileSheet={mode === 'decisions'} />}
    <AnimatePresence>{landingModal === 'intro' || landingModal === 'how' ? <MarketingModal kind={landingModal} close={() => setLandingModal(null)} /> : null}</AnimatePresence>
    <AnimatePresence>{landingModal === 'login' && <LoginModal close={() => setLandingModal(null)} authenticated={(user) => { setAuthUser(user); setLandingModal(null); go('destinations') }} />}</AnimatePresence>
    <AnimatePresence>{profileOpen && authUser && <ProfileModal user={authUser} close={() => setProfileOpen(false)} logout={() => { clearAuthUser(); setAuthUser(null); setProfileOpen(false); go('landing') }} />}</AnimatePresence>
    <AnimatePresence>{requestOpen && <DestinationRequestModal close={() => setRequestOpen(false)} submitted={(destination) => { setRequestOpen(false); setToast(`${destination} 지원 요청을 저장했어요`) }} />}</AnimatePresence>
    <AnimatePresence>{toast && <motion.div className="moa-toast" role="status" aria-live="polite" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><CheckCircle weight="fill" />{toast}</motion.div>}</AnimatePresence>
  </div>
}
