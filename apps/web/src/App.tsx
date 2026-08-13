import { useEffect, useRef, useState, type SyntheticEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  AirplaneTilt, ArrowLeft, ArrowRight, Bell, Buildings, CalendarBlank, CaretRight,
  ChartDonut, Check, CheckCircle, Clock, Coins, Copy, ForkKnife, Gavel, Hourglass, Info,
  LockKey, MagicWand, MapPin, Pause, Play, Plus, Printer, Receipt, ShareNetwork,
  ShieldCheck, SpinnerGap, SuitcaseRolling, Ticket, TrendDown, TrendUp, UsersThree,
  Warning, X,
} from '@phosphor-icons/react'
import {
  bookingChecklistItems, budget, destinationPacks, itineraryDays, meetingRounds, osakaPreferences,
  planReadiness, preferenceSliders, replayMessages, reservations, roomMembers, type DestinationPack,
} from './data'
import {
  createEmptySurveyDraft, createRoomSubmissionPayload, createSurveySubmissionPayload,
  allergenOptions, dietaryOptions, DIETARY_NONE,
  type HardConstraintDraft, type SurveyDraft,
} from './formState'
import { submitRoomDraft, submitSurveyDraft } from './formApi'
import { AvailabilitySurvey } from './components/AvailabilitySurvey'
import { DateConflict } from './components/DateConflict'
import { DecisionDrawer, DecisionTab, type DecisionRoundId } from './components/DecisionDetails'
import { Home } from './components/Home'
import { DestinationRequestModal, LoginModal, MarketingModal, ProfileModal } from './components/PrototypeModals'
import { SurveyShell } from './components/SurveyShell'
import { copyText, downloadTripCalendar, shareTrip } from './exportUtils'

type Stage = 'landing' | 'home' | 'destinations' | 'create' | 'invite' | 'lobby' | 'availability' | 'hard' | 'sliders' | 'cards' | 'free' | 'persona-loading' | 'persona' | 'submitted' | 'date-conflict' | 'running' | 'complete' | 'result' | 'replay'
type ResultTab = 'summary' | 'itinerary' | 'booking' | 'decisions' | 'fairness' | 'backup'
type LandingModal = 'intro' | 'how' | 'login' | null

const demoStages: Stage[] = ['landing','home','destinations','create','invite','lobby','availability','hard','sliders','cards','free','persona-loading','persona','submitted','date-conflict','running','complete','result','replay']
const resultTabs: ResultTab[] = ['summary','itinerary','booking','decisions','fairness','backup']
const useLocalImageFallback = (event:SyntheticEvent<HTMLImageElement>) => {
  event.currentTarget.onerror = null
  event.currentTarget.src = '/assets/fukuoka.webp'
}

function initialStage(): Stage {
  const queryStage = new URLSearchParams(window.location.search).get('stage') as Stage | null
  if (queryStage && demoStages.includes(queryStage)) return queryStage
  const savedStage = localStorage.getItem('moa-stage') as Stage | null
  return savedStage && demoStages.includes(savedStage) ? savedStage : 'landing'
}

function initialResultTab(): ResultTab {
  const queryTab = new URLSearchParams(window.location.search).get('tab') as ResultTab | null
  return queryTab && resultTabs.includes(queryTab) ? queryTab : 'summary'
}

function initialSurvey(): SurveyDraft {
  const empty = createEmptySurveyDraft(preferenceSliders.map(({ id }) => id),osakaPreferences.map(({ id }) => id))
  const saved = localStorage.getItem('moa-survey-draft')
  if (!saved) return empty
  try {
    const parsed = JSON.parse(saved) as Partial<SurveyDraft> & { mustDo?: unknown }
    const travelStyles = Object.fromEntries(
      Object.keys(empty.travelStyles).map((id) => [id, parsed.travelStyles?.[id] ?? null]),
    )
    const legacyPurpose = typeof parsed.mustDo === 'string' ? parsed.mustDo : ''
    const purposeItems = Array.isArray(parsed.purposeItems)
      ? [String(parsed.purposeItems[0] ?? ''), String(parsed.purposeItems[1] ?? '')]
      : [legacyPurpose, '']
    return {
      ...empty,
      ...parsed,
      availability:{...empty.availability,...parsed.availability},
      hardConstraints:{...empty.hardConstraints,...parsed.hardConstraints},
      travelStyles,
      activityScores:{...empty.activityScores,...parsed.activityScores},
      purposeItems,
    }
  } catch { return empty }
}

const stageNav: Record<Stage, string> = {
  landing:'소개', home:'내 여행', destinations:'여행지', create:'방 만들기', invite:'친구 초대', lobby:'여행 방', availability:'설문', hard:'설문', sliders:'설문', cards:'설문', free:'설문',
  'persona-loading':'내 대리인', persona:'내 대리인', submitted:'준비 상태', 'date-conflict':'날짜 조율', running:'대리인 회의', complete:'합의 완료', result:'우리 여행', replay:'회의 구경하기',
}

function App() {
  const [stage, setStage] = useState<Stage>(initialStage)
  const [selected, setSelected] = useState<DestinationPack>(destinationPacks.find((d) => d.id === 'osaka')!)
  const [cardIndex, setCardIndex] = useState(0)
  const [survey, setSurvey] = useState<SurveyDraft>(initialSurvey)
  const [tab, setTab] = useState<ResultTab>(initialResultTab)
  const [reason, setReason] = useState<DecisionRoundId | null>(null)
  const [rerun, setRerun] = useState<string | null>(null)
  const [rerunRemaining, setRerunRemaining] = useState(() => {
    const saved = Number(localStorage.getItem('moa-reruns-remaining') ?? 2)
    return Number.isFinite(saved) ? Math.min(2,Math.max(0,saved)) : 2
  })
  const [landingModal, setLandingModal] = useState<LandingModal>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [destinationRequestOpen, setDestinationRequestOpen] = useState(false)
  const [personaConfirmed, setPersonaConfirmed] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => localStorage.setItem('moa-stage', stage), [stage])
  useEffect(() => localStorage.setItem('moa-survey-draft',JSON.stringify(survey)), [survey])
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(''), 2200); return () => window.clearTimeout(t) }, [toast])
  const go = (next: Stage) => { setStage(next); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const invitationUrl = `${window.location.origin}/?stage=lobby`
  const resultUrl = `${window.location.origin}/?stage=result`
  const copyInvitation = async () => {
    try { await copyText(invitationUrl); setToast('링크를 복사했어요') } catch { setToast('링크를 복사하지 못했어요') }
  }
  const shareInvitation = async () => {
    try {
      const result = await shareTrip(invitationUrl)
      setToast(result === 'shared' ? '공유 화면을 열었어요' : '공유 기능 대신 링크를 복사했어요')
    } catch { setToast('공유를 취소했어요') }
  }
  const copyResult = async () => {
    try { await copyText(resultUrl); setToast('여행 결과 링크를 복사했어요') } catch { setToast('링크를 복사하지 못했어요') }
  }
  const shareResult = async () => {
    try { const result = await shareTrip(resultUrl); setToast(result === 'shared' ? '공유 화면을 열었어요' : '결과 링크를 복사했어요') } catch { setToast('공유를 취소했어요') }
  }
  const submitSurvey = async () => {
    const payload = createSurveySubmissionPayload(selected.id, survey)
    try {
      await submitSurveyDraft(payload)
      go('persona-loading')
    } catch {
      setToast('답변을 저장하지 못했어요. 다시 시도해주세요.')
    }
  }

  return <div className="moa-app">
    {stage !== 'landing' && <Header stage={stage} home={() => go('home')} room={() => go(stage === 'home' ? 'destinations' : 'lobby')} profile={() => setProfileOpen(true)} />}
    <AnimatePresence mode="wait">
      <motion.main key={stage} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: .25 }}>
        {stage === 'landing' && <Landing create={() => go('destinations')} join={() => go('lobby')} intro={() => setLandingModal('intro')} how={() => setLandingModal('how')} login={() => setLandingModal('login')} />}
        {stage === 'home' && <Home create={() => go('destinations')} openTrip={go} about={() => go('landing')} />}
        {stage === 'destinations' && <DestinationPicker selected={selected} select={setSelected} next={() => go('create')} request={() => setDestinationRequestOpen(true)} />}
        {stage === 'create' && <CreateRoom destination={selected} back={() => go('destinations')} next={() => go('invite')} />}
        {stage === 'invite' && <InviteSuccess next={() => go('lobby')} copy={copyInvitation} share={shareInvitation} />}
        {stage === 'lobby' && <Lobby start={() => go('availability')} startPlanning={() => go('date-conflict')} copy={copyInvitation} share={shareInvitation} nudge={() => setToast('서연님에게 확인 요청을 보냈어요')} personaConfirmed={personaConfirmed} />}
        {stage === 'availability' && <AvailabilitySurvey value={survey.availability} change={(availability) => setSurvey((old) => ({ ...old, availability }))} next={() => go('hard')} />}
        {stage === 'hard' && <HardSurvey value={survey.hardConstraints} change={(hardConstraints) => setSurvey((old) => ({ ...old, hardConstraints }))} next={() => go('sliders')} />}
        {stage === 'sliders' && <SliderSurvey values={survey.travelStyles} change={(id, value) => setSurvey((old) => ({ ...old, travelStyles: { ...old.travelStyles, [id]: value } }))} next={() => go('cards')} />}
        {stage === 'cards' && <CardSurvey index={cardIndex} scores={survey.activityScores} setScore={(id, score) => setSurvey((old) => ({ ...old, activityScores: { ...old.activityScores, [id]: score } }))} back={() => setCardIndex((i) => Math.max(0, i - 1))} next={() => cardIndex < osakaPreferences.length - 1 ? setCardIndex((i) => i + 1) : go('free')} />}
        {stage === 'free' && <FreeSurvey purposeItems={survey.purposeItems} avoid={survey.avoid} changePurposes={(purposeItems) => setSurvey((old) => ({ ...old, purposeItems }))} changeAvoid={(avoid) => setSurvey((old) => ({ ...old, avoid }))} next={submitSurvey} />}
        {stage === 'persona-loading' && <PersonaLoading next={() => go('persona')} />}
        {stage === 'persona' && <Persona survey={survey} confirm={() => { setPersonaConfirmed(true); go('submitted') }} edit={() => go('availability')} />}
        {stage === 'submitted' && <Submitted next={() => go('running')} room={() => go('lobby')} />}
        {stage === 'date-conflict' && <DateConflict back={() => go('lobby')} select={(optionId) => { sessionStorage.setItem('moa-date-resolution', optionId); go('running') }} extend={() => { setToast('응답 마감을 24시간 연장했어요'); go('lobby') }} />}
        {stage === 'running' && <MeetingRunning next={() => go('complete')} later={() => go('home')} />}
        {stage === 'complete' && <MeetingComplete result={() => go('result')} replay={() => go('replay')} />}
        {stage === 'result' && <FinalResult tab={tab} setTab={setTab} openReason={setReason} replay={() => go('replay')} rerun={setRerun} rerunRemaining={rerunRemaining} share={shareResult} copy={copyResult} />}
        {stage === 'replay' && <MeetingReplay back={() => go('result')} />}
      </motion.main>
    </AnimatePresence>
    <AnimatePresence>{reason && <DecisionDrawer roundId={reason} close={() => setReason(null)} />}</AnimatePresence>
    <AnimatePresence>{rerun && <RerunModal category={rerun} remaining={rerunRemaining} close={() => setRerun(null)} submit={(summary) => { const nextRemaining = Math.max(0,rerunRemaining - 1); setRerunRemaining(nextRemaining); localStorage.setItem('moa-reruns-remaining', String(nextRemaining)); setRerun(null); setToast(summary) }} />}</AnimatePresence>
    <AnimatePresence>{landingModal === 'intro' || landingModal === 'how' ? <MarketingModal kind={landingModal} close={() => setLandingModal(null)} /> : null}</AnimatePresence>
    <AnimatePresence>{landingModal === 'login' && <LoginModal close={() => setLandingModal(null)} login={() => { setLandingModal(null); go('home') }} />}</AnimatePresence>
    <AnimatePresence>{profileOpen && <ProfileModal close={() => setProfileOpen(false)} logout={() => { setProfileOpen(false); go('landing') }} />}</AnimatePresence>
    <AnimatePresence>{destinationRequestOpen && <DestinationRequestModal close={() => setDestinationRequestOpen(false)} submitted={(destination) => { setDestinationRequestOpen(false); setToast(`${destination} 지원 요청을 보냈어요`) }} />}</AnimatePresence>
    <AnimatePresence>{toast && <motion.div className="moa-toast" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><CheckCircle weight="fill" />{toast}</motion.div>}</AnimatePresence>
  </div>
}

function Logo() { return <div className="moa-logo"><img src="/assets/moa-wordmark.png" alt="MOA" /></div> }

function Header({ stage, home, room, profile }: { stage: Stage; home: () => void; room: () => void; profile:()=>void }) {
  return <header className="moa-header"><button onClick={home} aria-label="내 여행 홈"><Logo /></button><div className="moa-breadcrumb">{stage === 'home' ? <strong>내 여행</strong> : <><span>오사카 3박 4일</span><CaretRight /><strong>{stageNav[stage]}</strong></>}</div><div className="moa-header-actions"><button onClick={room}>{stage === 'home' ? <><Plus /> 새 여행</> : <><UsersThree /> 여행 방</>}</button><button className="moa-avatar" onClick={profile} aria-label="프로필 열기">민</button></div></header>
}

function LandingMeetingDemo() {
  const reduceMotion = useReducedMotion()
  const [phase, setPhase] = useState(reduceMotion ? 6 : 0)

  useEffect(() => {
    if (reduceMotion) { setPhase(6); return }
    const durations = [650, 900, 900, 900, 1000, 1250, 2200, 400]
    const timer = window.setTimeout(() => setPhase((current) => current >= 7 ? 0 : current + 1), durations[phase])
    return () => window.clearTimeout(timer)
  }, [phase, reduceMotion])

  const messageMotion = (visibleAt: number, side: 'left' | 'right') => ({
    opacity: phase >= visibleAt && phase < 7 ? phase === 6 ? .66 : 1 : 0,
    x: phase === 4 ? (side === 'left' ? -14 : 14) : phase >= 5 ? (side === 'left' ? 3 : -3) : 0,
    y: phase >= visibleAt ? 0 : 9,
    scale: phase >= visibleAt && phase < 7 ? 1 : .98,
  })

  const stateKey = phase === 4 ? 'conflict' : phase === 5 ? 'fact' : phase === 6 ? 'agreement' : 'working'

  return <div className="moa-phone-stage" aria-label="모아 대리인 회의 예시">
    <motion.div className="moa-phone" initial={reduceMotion ? false : { opacity: 0, y: 24 }} animate={{ opacity: phase === 7 ? .94 : 1, y: phase === 0 ? 8 : 0 }} transition={{ duration: .45, ease: [0.22, 1, 0.36, 1] }}>
      <div className="moa-phone-bezel">
        <div className="moa-phone-island" />
        <div className="moa-phone-screen">
          <header className="moa-phone-header"><button aria-label="뒤로 가기"><ArrowLeft /></button><div><strong>오사카 3박 4일</strong><span>대리인 회의</span></div><button aria-label="회의 정보"><Info /></button></header>
          <div className="moa-phone-round"><div><span>ROUND 02</span><strong>숙소 라운드</strong></div><span className="moa-phone-live"><i /> 진행 중</span></div>
          <div className="moa-phone-members"><div><span>민</span><p><strong>민지</strong><small>맛집 우선</small></p></div><div><span>서</span><p><strong>서연</strong><small>위치 우선</small></p></div><div><span>지</span><p><strong>지훈</strong><small>위치 우선</small></p></div></div>
          <div className="moa-phone-thread"><p><span>민지의 대리인</span>숙소보다 맛집에 더 쓰고 싶어요.</p><p><span>서연의 대리인</span>근데 숙소가 너무 멀잖아요.</p><p><span>지훈의 대리인</span>저도 위치는 포기 못 해요.</p></div>
          <div className="moa-phone-state">
            <AnimatePresence mode="wait" initial={false}>
              {stateKey === 'working' && <motion.div key="working" className="moa-phone-working" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><SpinnerGap /><span>조건을 비교하고 있어요</span></motion.div>}
              {stateKey === 'conflict' && <motion.div key="conflict" className="moa-phone-conflict" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: .35 }}><span>의견이 갈렸어요</span><strong>2 <i>:</i> 1</strong><small>위치 우선 · 맛집 우선</small></motion.div>}
              {stateKey === 'fact' && <motion.div key="fact" className="moa-phone-fact" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: .45, ease: 'easeOut' }}><header><Gavel /><div><small>MOA</small><strong>잠깐, 조건을 확인할게요.</strong><span>실제 조건을 비교했어요.</span></div></header><dl><div><dt>H-03 선택 시</dt><dd>₩28,000 / 인</dd></div><div><dt>이동시간</dt><dd>64분</dd></div></dl></motion.div>}
              {stateKey === 'agreement' && <motion.div key="agreement" className="moa-phone-agreement" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .45, ease: 'easeOut' }}><CheckCircle weight="fill" /><span><strong>합의 완료</strong><small>모두의 조건을 만족하는 안으로 정리했어요.</small></span></motion.div>}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.div>
    <motion.article className="moa-float-message minji" initial={false} animate={messageMotion(1, 'left')} transition={{ duration: .4, ease: 'easeOut' }}><header><span>민</span><strong>민지의 대리인</strong></header><p>“숙소보다 맛집에 더 쓰고 싶어요.”</p></motion.article>
    <motion.article className="moa-float-message seoyeon" initial={false} animate={messageMotion(2, 'right')} transition={{ duration: .4, ease: 'easeOut' }}><header><span>서</span><strong>서연의 대리인</strong></header><p>“근데 숙소가 너무 멀잖아요.”</p></motion.article>
    <motion.article className="moa-float-message jihoon" initial={false} animate={messageMotion(3, 'right')} transition={{ duration: .4, ease: 'easeOut' }}><header><span>지</span><strong>지훈의 대리인</strong></header><p>“저도 위치는 포기 못 해요.”</p></motion.article>
  </div>
}

function Landing({ create, join, intro, how, login }: { create:()=>void; join:()=>void; intro:()=>void; how:()=>void; login:()=>void }) {
  const steps = ['취향 입력', '대리인 회의', '결정 근거 확인', '여행 일정 완성']
  return <section className="moa-landing"><nav><Logo /><div className="moa-landing-menu"><button onClick={intro}>서비스 소개</button><button onClick={how}>사용 방법</button><button onClick={join}>여행 방 참여</button></div><div><button className="moa-link" onClick={login}>로그인</button><button className="moa-button mini" onClick={create}>여행 방 만들기 <ArrowRight /></button></div></nav><div className="moa-hero"><div className="moa-hero-copy"><span className="moa-hero-eyebrow">AI 여행 대리인과 함께</span><h1>싸울 건 싸우고,<br /><em>여행은 같이.</em></h1><p>서로 다른 취향은 그대로.<br />대리인들이 대신 조율해드려요.</p><div className="moa-actions"><button className="moa-button big" onClick={create}>여행 방 만들기 <ArrowRight /></button></div><div className="moa-social-proof"><div>{roomMembers.slice(0,5).map((m) => <i key={m.name} style={{ background: m.color }}>{m.initial}</i>)}</div><p><strong>먼저 여행을 만든 팀 2,400+</strong><span>취향은 달라도, 여행은 같이.</span></p></div></div><LandingMeetingDemo /></div><div className="moa-process" aria-label="모아 이용 과정">{steps.map((step, index) => <div key={step}><span>{String(index + 1).padStart(2, '0')}</span><strong>{step}</strong>{index < steps.length - 1 && <ArrowRight />}</div>)}</div></section>
}

function DestinationPicker({ selected, select, next, request }: { selected:DestinationPack; select:(d:DestinationPack)=>void; next:()=>void; request:()=>void }) {
  return <Page><div className="moa-page-head"><span className="moa-kicker">DESTINATION FIRST</span><h1>어디로 갈까요?</h1><p>여행지를 고르면 그곳에 맞는 질문을 준비할게요.</p></div>{(['국내', '일본'] as const).map((country) => <section className="moa-destination-group" key={country}><div><h2>{country}</h2><span>{country === '국내' ? '가볍게 떠나기 좋은 곳' : '가깝지만 분위기는 확실히 다른 곳'}</span></div><div className="moa-destination-grid">{destinationPacks.filter((d) => d.country === country).map((d) => <button key={d.id} className={`moa-destination-card ${selected.id === d.id ? 'selected' : ''}`} onClick={() => select(d)}><img src={d.image} alt={d.name} onError={useLocalImageFallback} /><span className="moa-photo-shade" /><div><strong>{d.name}</strong><p>{d.tags.join(' · ')}</p></div>{selected.id === d.id && <i><Check weight="bold" /></i>}</button>)}</div></section>)}<div className="moa-request"><div><MapPin /><p><strong>찾는 곳이 없나요?</strong><span>다음 지원 여행지로 요청할 수 있어요.</span></p></div><button onClick={request}>여행지 요청하기 <ArrowRight /></button></div><StickyAction note={`${selected.name}로 떠나볼까요?`} button="다음" onClick={next} /></Page>
}

function CreateRoom({ destination, back, next }: { destination: DestinationPack; back: () => void; next: () => void }) {
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const submit = async () => {
    setSubmitting(true)
    setSubmitError('')
    try {
      await submitRoomDraft(createRoomSubmissionPayload(destination.id))
      next()
    } catch {
      setSubmitError('여행 방을 만들지 못했어요. 잠시 후 다시 시도해주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  return <Page narrow><button className="moa-back" onClick={back}><ArrowLeft /> 여행지 다시 고르기</button><section className="moa-room-create-confirm"><div className="moa-create-visual"><img src={destination.image} alt={destination.name} onError={useLocalImageFallback} /><span className="moa-photo-shade" /><div><small>선택한 여행지</small><h2>{destination.name}</h2><p>{destination.tags.join(' · ')}</p></div></div><div><span className="moa-kicker">CREATE TRIP ROOM</span><h1>{destination.name} 여행 방을 만들까요?</h1><p>방을 만든 뒤 친구들을 초대하세요. 날짜는 모두의 가능 시간을, 예산은 각자의 답변을 모아 정해요.</p><ul><li><Check />호스트는 여행지만 정해요.</li><li><Check />각자 가능한 날짜와 예산을 입력해요.</li><li><Check />모두의 답을 모아 여행안을 만들어요.</li></ul>{submitError && <p className="moa-form-error" role="alert">{submitError}</p>}<button type="button" className="moa-button full big" onClick={submit} disabled={submitting}>{submitting ? '만드는 중…' : '여행 방 만들기'} {!submitting && <ArrowRight />}</button></div></section></Page>
}

function InviteSuccess({ next, copy, share }: { next: () => void; copy: () => void; share: () => void }) {
  return <Page narrow><section className="moa-room-created"><div className="moa-status-mark success"><Check weight="bold" /></div><span className="moa-kicker">ROOM IS READY</span><h1>여행 방 열었어요</h1><p>친구들에게 링크를 보내고, 각자 취향만 받으면 돼요.</p><div className="moa-created-link"><span>초대 링크</span><strong>moa.travel/join/OSK-2410</strong><button onClick={copy} aria-label="초대 링크 복사"><Copy /></button></div><div className="moa-created-actions"><button className="moa-button ghost big" onClick={copy}><Copy /> 링크 복사</button><button className="moa-kakao big" onClick={share}><ShareNetwork /> 카카오톡으로 공유</button></div><button className="moa-link" onClick={next}>여행 방 보기 <ArrowRight /></button></section></Page>
}

function Lobby({ start, startPlanning, copy, share, nudge, personaConfirmed }: { start:()=>void; startPlanning:()=>void; copy:()=>void; share:()=>void; nudge:()=>void; personaConfirmed:boolean }) {
  const [confirmStart,setConfirmStart] = useState(false)
  const members = roomMembers.map((member,index) => index === 0 && !personaConfirmed ? { ...member, status:'설문 시작' as const } : member)
  const ready = members.filter((member) => member.status === '대리인 확인').length
  const notReady = members.length - ready
  const line = (status: typeof members[number]['status']) => ({ '초대됨':'초대됨', '참여함':'여행 방 참여', '설문 시작':'취향 입력 중', '설문 완료':'설문 완료 · 대리인 확인 전', '대리인 확인':'대리인 확인 완료' })[status]
  const beginPlanning = () => notReady ? setConfirmStart(true) : startPlanning()
  return <Page><div className="moa-room">
    <header className="moa-room-top">
      <span className="moa-room-eyebrow">OSAKA · TRIP ROOM</span>
      <div className="moa-room-title"><h1>오사카 3박 4일</h1><span className="moa-room-state">취향 받는 중</span></div>
      <p className="moa-room-meta">2026.10.15 – 10.18 · 6명</p>
    </header>

    <section className="moa-room-ready">
      <p className="moa-room-ask">다들 준비됐나요?</p>
      <strong className="moa-room-count"><b>{ready}</b> / {members.length}명 준비됐어요</strong>
      <div className="moa-room-bar"><i style={{ width: `${(ready / members.length) * 100}%` }} /></div>
      <p className="moa-room-ready-note">모두 준비되면 대리인 회의가 자동으로 시작돼요.</p>
    </section>

    <section className="moa-room-roster">
      <p className="moa-room-roster-note">각자 시간 될 때 취향만 남겨주세요.</p>
      <ul>{members.map((m, index) => <li key={m.name}>
        <span className="moa-room-avatar" style={{ color: m.color, background: m.pale }}>{m.initial}</span>
        <div><strong>{m.name}{index === 0 && <i>나</i>}{m.isHost && <b className="moa-host-badge">HOST</b>}</strong><small>{line(m.status)}</small></div>
        {m.status === '대리인 확인' && <em className="done"><Check weight="bold" /></em>}
        {m.status === '설문 시작' && (index === 0 ? <em className="doing">입력 중</em> : <button className="moa-room-nudge" onClick={nudge}>알림 보내기 <ArrowRight /></button>)}
        {m.status === '설문 완료' && <em className="confirm">확인 전</em>}
        {(m.status === '참여함' || m.status === '초대됨') && <em className="idle">{m.status}</em>}
      </li>)}</ul>
    </section>

    <section className="moa-room-invite">
      <div>
        <span>친구 초대</span>
        <strong className="moa-room-code">MOA-OSK-8X7P</strong>
        <div className="moa-room-invite-actions"><button onClick={copy}>링크 복사</button><button onClick={share}>카카오톡 공유</button></div>
      </div>
      <div className="moa-room-due"><span>취향 입력 마감</span><strong>9월 20일 23:59</strong></div>
    </section>

    <section className="moa-room-action">
      <div><strong>{personaConfirmed ? '내 대리인 준비 완료' : '아직 내 취향을 다 남기지 않았어요'}</strong><span>{personaConfirmed ? '답변을 다시 확인하거나 지금 계획을 시작할 수 있어요.' : '약 7분이면 끝나요.'}</span></div>
      <div className="moa-room-action-buttons"><button className="moa-button ghost big" onClick={start}>{personaConfirmed ? '내 답변 보기' : '내 취향 입력하기'}</button><button className="moa-button big" onClick={beginPlanning}>지금 계획 시작 <ArrowRight /></button></div>
    </section>
    {confirmStart && <div className="moa-modal-bg" role="presentation" onMouseDown={() => setConfirmStart(false)}><section className="moa-start-warning" role="dialog" aria-modal="true" aria-labelledby="start-warning-title" onMouseDown={(event) => event.stopPropagation()}><Warning weight="duotone" /><h2 id="start-warning-title">아직 {notReady}명이 준비되지 않았어요.</h2><p>지금 시작하면 확인하지 않은 친구의 취향이 충분히 반영되지 않을 수 있어요.</p><div><button className="moa-button ghost" onClick={() => setConfirmStart(false)}>취소</button><button className="moa-button" onClick={startPlanning}>그래도 시작</button></div></section></div>}
  </div></Page>
}

function HardSurvey({ value, change, next }: { value: HardConstraintDraft; change: (value: HardConstraintDraft) => void; next: () => void }) {
  const set = <K extends keyof HardConstraintDraft>(field: K, fieldValue: HardConstraintDraft[K]) => change({ ...value, [field]: fieldValue })
  const toggle = (field: 'dietary' | 'allergies' | 'beliefs' | 'mobilityNeeds' | 'noGoItems', item: string) => set(field, value[field].includes(item) ? value[field].filter((x) => x !== item) : [...value[field], item])
  // '없음'은 다른 식이 제약과 공존할 수 없다. 알레르기는 별도 축이므로 여기서 배제하지 않는다.
  const toggleDietary = (item: string) => {
    if (item === DIETARY_NONE) { set('dietary', value.dietary.includes(DIETARY_NONE) ? [] : [DIETARY_NONE]); return }
    const next = value.dietary.filter((x) => x !== DIETARY_NONE)
    set('dietary', next.includes(item) ? next.filter((x) => x !== item) : [...next, item])
  }
  const incomplete = !value.budgetLimit.trim() || value.dietary.length === 0 || value.walkingDistanceKm === null
  return <SurveyShell step={1} time="6분" title="이건 진짜 안 돼요." copy="여기서 고른 건 대리인이 절대 양보하지 않아요." next={next} disabled={incomplete}><div className="moa-hard-grid"><SurveyCard icon={Coins} title="예산"><label className="moa-field">1인 총예산 상한<div className="moa-money"><b>₩</b><input name="budgetLimit" inputMode="numeric" value={value.budgetLimit} onChange={(e) => set('budgetLimit', e.target.value)} placeholder="금액 입력" /><span>원</span></div></label><label className="moa-switch"><input name="includesFlight" type="checkbox" checked={value.includesFlight} onChange={(e) => set('includesFlight', e.target.checked)} /><span /> 항공 포함</label></SurveyCard><SurveyCard icon={ForkKnife} title="먹는 것"><ChipGroup items={[...dietaryOptions]} selected={value.dietary} select={toggleDietary} plus /></SurveyCard><SurveyCard icon={Warning} title="알레르기"><p className="moa-card-note">해당되는 것을 모두 골라주세요. 목록에 없으면 직접 추가할 수 있어요. 알레르기는 어떤 경우에도 양보하지 않고, 대응을 확인하지 못한 식당은 후보에서 제외해요.</p><ChipGroup items={[...allergenOptions]} selected={value.allergies} select={(item) => toggle('allergies', item)} plus /></SurveyCard><SurveyCard icon={ShieldCheck} title="생활 · 신념"><ChipGroup items={['기도 시간 필요','음주 일정 제외','동물 체험 제외']} selected={value.beliefs} select={(item) => toggle('beliefs', item)} plus /></SurveyCard><SurveyCard icon={SuitcaseRolling} title="체력 · 이동"><label className={`moa-field moa-unanswered-range ${value.walkingDistanceKm === null ? 'unanswered' : ''}`}>하루에 얼마나 걸을 수 있나요?<input name="walkingDistanceKm" type="range" min="1" max="15" value={value.walkingDistanceKm ?? 8} onChange={(e) => set('walkingDistanceKm', Number(e.target.value))} /><div className="moa-range-label"><span>1km</span><strong>{value.walkingDistanceKm === null ? '선택 안 함' : `${value.walkingDistanceKm}km`}</strong><span>15km</span></div></label><ChipGroup items={['계단·경사 어려움','휠체어','유아차']} selected={value.mobilityNeeds} select={(item) => toggle('mobilityNeeds', item)} /></SurveyCard></div><SurveyCard icon={LockKey} title="절대 안 돼요" full><ChipGroup items={['새벽 비행','도미토리','남녀 혼숙','날것','놀이기구','장시간 버스','흡연실']} selected={value.noGoItems} select={(item) => toggle('noGoItems', item)} plus /></SurveyCard><div className="moa-warning"><Warning weight="fill" /><p><strong>빠진 조건은 없나요?</strong><span>여기에 적지 않으면 대리인이 모를 수도 있어요.</span></p></div></SurveyShell>
}

function SliderSurvey({ values, change, next }: { values: Record<string, number | null>; change: (id: string, value: number) => void; next: () => void }) {
  const incomplete = preferenceSliders.some(({ id }) => values[id] === null)
  return <SurveyShell step={2} time="4분" title="그래서, 어떤 여행을 좋아해요?" copy="눈치 보지 말고 본인 취향대로 골라주세요." next={next} disabled={incomplete}><div className="moa-slider-grid">{preferenceSliders.map(({ id, title, left, right }) => <article className={`moa-slider ${values[id] === null ? 'unanswered' : ''}`} key={id}><div><strong>{title}</strong><span>{values[id] === null ? '선택 안 함' : `${values[id]} / 7`}</span></div><input name={id} type="range" min="1" max="7" value={values[id] ?? 4} onChange={(e) => change(id, Number(e.target.value))} /><footer><span>{left}</span><span>{right}</span></footer></article>)}</div><div className="moa-tip"><Info weight="fill" /><p><strong>MOA 안내</strong><span>딱 반반이면 가운데도 괜찮아요. 애매한 취향도 그대로 전할게요.</span></p></div></SurveyShell>
}

function CardSurvey({ index, scores, setScore, back, next }: { index: number; scores: Record<string, number | null>; setScore: (id: string, score: number) => void; back: () => void; next: () => void }) {
  const item = osakaPreferences[index]
  const label = (n: number) => n >= 9 ? '꼭 하고 싶어요' : n >= 7 ? '좋아요' : n >= 5 ? '있어도 좋아요' : n >= 3 ? '별로 관심 없어요' : '피하고 싶어요'
  const score = scores[item.id]
  const advanceTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current)
  }, [index])
  const chooseScore = (value: number) => {
    if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current)
    setScore(item.id, value)
    advanceTimer.current = window.setTimeout(next, 320)
  }
  return <SurveyShell step={3} time="2분" title="이거 얼마나 끌려요?" copy="오사카에서 해볼 것들을 1점부터 10점까지 골라주세요." next={next} nextLabel={index === osakaPreferences.length - 1 ? '다음' : '확인'} disabled={score === null}><div className="moa-card-counter"><strong>{index + 1}</strong> / {osakaPreferences.length}<div><i style={{ width: `${((index + 1) / osakaPreferences.length) * 100}%` }} /></div></div><motion.article key={index} className="moa-score-card" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}><img src={item.image} alt={item.name} onError={useLocalImageFallback} /><span className="moa-photo-shade" /><div><span>OSAKA PICK {String(index + 1).padStart(2,'0')}</span><h2>{item.name}</h2><p>{item.context}</p></div></motion.article><div className="moa-score-selector"><div><span>안 끌려요</span><strong>{score === null ? '아직 선택 안 했어요' : <><b>{score}</b> — {label(score)}</>}</strong><span>꼭 할래요</span></div><div>{[1,2,3,4,5,6,7,8,9,10].map((n) => <button type="button" aria-pressed={score === n} className={score === n ? 'active' : ''} key={n} onClick={() => chooseScore(n)}>{n}</button>)}</div></div><div className="moa-card-nav"><button onClick={back} disabled={index === 0}><ArrowLeft /> 이전 카드</button><p aria-live="polite">{score === null ? '하나를 골라주세요' : '선택했어요. 다음으로 넘어갈게요'}</p></div></SurveyShell>
}

function FreeSurvey({ purposeItems, avoid, changePurposes, changeAvoid, next }: { purposeItems: string[]; avoid: string; changePurposes: (value: string[]) => void; changeAvoid: (value: string) => void; next: () => void }) {
  const updatePurpose = (index: number, value: string) => changePurposes([0, 1].map((slot) => slot === index ? value : purposeItems[slot] ?? ''))
  return <SurveyShell step={4} time="1분" title="마지막으로, 이것만 알려주세요" copy="목적급 콘텐츠는 최대 2개까지 순서대로 적을 수 있어요." next={next} nextLabel="내 대리인 만들기"><div className="moa-free-grid"><label><span><TrendUp />1순위 · 이번 여행에서 꼭 하고 싶어요.</span><textarea name="purposeItems[0]" maxLength={100} value={purposeItems[0] ?? ''} onChange={(e) => updatePurpose(0, e.target.value)} placeholder="예: 하루는 온천에서 느긋하게 쉬고 싶어요." /><small>{(purposeItems[0] ?? '').length} / 100</small></label><label><span><TrendUp />2순위 · 하나 더 있다면 적어주세요.</span><textarea name="purposeItems[1]" maxLength={100} value={purposeItems[1] ?? ''} onChange={(e) => updatePurpose(1, e.target.value)} placeholder="예: 스시 오마카세를 한 번은 먹고 싶어요." /><small>{(purposeItems[1] ?? '').length} / 100</small></label><label><span><TrendDown />이것만은 정말 피하고 싶어요.</span><textarea name="avoid" maxLength={100} value={avoid} onChange={(e) => changeAvoid(e.target.value)} placeholder="예: 새벽 비행과 너무 빡빡한 일정은 싫어요." /><small>{avoid.length} / 100</small></label></div></SurveyShell>
}

function PersonaLoading({ next }: { next: () => void }) { useEffect(() => { const t = window.setTimeout(next, 2600); return () => clearTimeout(t) }, [next]); return <section className="moa-loading"><div className="moa-status-mark loading"><SpinnerGap /></div><span className="moa-kicker">BUILDING MY AGENT</span><h1>내 편 만드는 중이에요</h1><p>답변을 하나씩 정리해서, 나를 잘 아는 대리인을 만들고 있어요.</p><div>{['절대 조건 챙기기','좋아하는 것 정리하기','말하는 방식 맞추기'].map((x,i) => <span style={{ animationDelay: `${i*.35}s` }} key={x}><SpinnerGap />{x}</span>)}</div></section> }

function Persona({ survey, confirm, edit }: { survey:SurveyDraft; confirm:()=>void; edit:()=>void }) {
  const ranked = osakaPreferences.map((item) => ({ ...item, score:survey.activityScores[item.id] })).filter((item):item is typeof item & { score:number } => item.score !== null).sort((a,b) => b.score - a.score)
  const strongest = ranked.slice(0,3)
  const lowest = [...ranked].sort((a,b) => a.score - b.score).slice(0,2)
  const paceValue = survey.travelStyles.pace
  const pace = paceValue === null ? '아직 선택 전' : paceValue <= 3 ? '느긋한 편' : paceValue >= 6 ? '알찬 일정' : '균형 잡힌 편'
  // 알레르기를 가장 앞에 둔다. 페르소나 확인 화면이 사용자의 마지막 통제 지점이므로 안전 항목이 먼저 보여야 한다.
  const allergyLabels = survey.hardConstraints.allergies.map((item) => `${item} 알레르기`)
  const dietaryLabels = survey.hardConstraints.dietary.filter((item) => item !== DIETARY_NONE)
  const constraints = [...allergyLabels, ...dietaryLabels, ...survey.hardConstraints.beliefs, ...survey.hardConstraints.mobilityNeeds, ...survey.hardConstraints.noGoItems]
  const budgetValue = Number(survey.hardConstraints.budgetLimit.replace(/[^0-9]/g,''))
  const budgetLabel = budgetValue ? `₩${budgetValue.toLocaleString()}` : '아직 입력 전'
  const purposeSummary = survey.purposeItems.map((item) => item.trim()).filter(Boolean).join(' · ')
  return <Page narrow><div className="moa-persona-head"><span className="moa-kicker">MY AGENT</span><h1>내 편 등장.</h1><p>이 대리인이 여행 회의에서 나 대신 말해줘요.</p></div><div className="moa-persona-card"><div className="moa-persona-side"><div className="moa-agent-avatar"><span>민</span><i><ShieldCheck weight="fill" /></i></div><small>민지의 대리인</small><h2>“맛집은 포기 못하는<br />느긋한 탐험가”</h2><p>{strongest.length ? `${strongest[0].name}을 특히 기대하고, ${pace === '알찬 일정' ? '하루를 알차게 쓰는' : '서두르지 않는'} 여행을 원해요.` : '답변을 바탕으로 여행에서 지킬 우선순위를 정리해요.'}</p><span className="moa-agent-style">협상 스타일 · 조정형</span></div><div className="moa-persona-details"><PersonaBlock icon={Coins} title="예산"><strong>{budgetLabel}</strong><span>{survey.hardConstraints.includesFlight ? '항공 포함' : '항공 제외'} · 상한은 꼭 지켜요</span></PersonaBlock><PersonaBlock icon={Clock} title="여행 스타일"><strong>{pace}</strong><span>{survey.availability.preferredNights ? `${survey.availability.preferredNights}박 선호` : '여행 기간 선택 전'} · {survey.availability.nightFlexibility === 'plus-minus-one' ? '±1박 가능' : '기간 고정'}</span></PersonaBlock><PersonaBlock icon={LockKey} title="이건 진짜 안 돼요"><div className="moa-mini-chips">{constraints.length ? constraints.slice(0,6).map((item) => <i key={item}>{item}</i>) : <i>입력한 조건이 없어요</i>}</div></PersonaBlock><PersonaBlock icon={TrendUp} title="가장 기대돼요"><div className="moa-rank-list">{strongest.length ? strongest.map((item) => <span key={item.id}>{item.name} <b>{item.score}</b></span>) : <span>아직 평가 전</span>}</div></PersonaBlock><PersonaBlock icon={TrendDown} title="별로 안 끌려요"><div className="moa-rank-list low">{lowest.length ? lowest.map((item) => <span key={item.id}>{item.name} <b>{item.score}</b></span>) : <span>아직 평가 전</span>}</div></PersonaBlock><PersonaBlock icon={Gavel} title="꼭 기억할 말"><strong>{purposeSummary || '꼭 하고 싶은 것 없음'}</strong><span>{survey.avoid ? `피하고 싶은 것 · ${survey.avoid}` : '추가로 피하고 싶은 것은 없어요.'}</span></PersonaBlock></div></div><div className="moa-confirm-gate"><ShieldCheck weight="duotone" /><div><strong>얘, 나 좀 잘 아는 것 같은데?</strong><span>확인하면 이 대리인이 지금 답변으로 나를 대표해요.</span></div></div><div className="moa-persona-actions"><button className="moa-button ghost big" onClick={edit}>답변 수정</button><button className="moa-button big" onClick={confirm}>이대로 나를 대표해요 <Check /></button></div></Page>
}

function Submitted({ next, room }: { next: () => void; room: () => void }) { return <section className="moa-submitted"><div className="moa-status-mark success"><Check weight="bold" /></div><span className="moa-kicker">AGENT SUBMITTED</span><h1>이제 맡겨두세요.</h1><p>다들 준비되면 대리인들이 알아서 회의를 시작해요.</p><div className="moa-readiness"><div><strong>4 / 6명</strong><span>준비 완료</span></div><div>{roomMembers.map((m,i) => <span key={m.name} style={{ background: i < 4 ? m.color : '#d8d2ca' }}>{i < 4 ? <Check /> : m.initial}</span>)}</div></div><div className="moa-leave-note"><Bell weight="duotone" /><p><strong>지금 앱을 닫아도 괜찮아요.</strong><span>계획이 완성되면 알려드릴게요.</span></p></div><div className="moa-actions"><button className="moa-button ghost" onClick={room}>준비 상태 보기</button><button className="moa-button" onClick={next}>회의 상태 보기 <ArrowRight /></button></div></section> }

function MeetingRunning({ next, later }: { next:()=>void; later:()=>void }) {
  const [notifyWhenDone, setNotifyWhenDone] = useState(true)
  return <Page narrow><div className="moa-running-head"><div><span className="moa-kicker">BACKGROUND MEETING</span><h1>지금 대신 싸우는 중이에요.</h1><p>숙소부터 식사까지, 하나씩 합의해가고 있어요.</p></div><div className="moa-running-moa"><span><SpinnerGap />MOA · 의견 맞추는 중</span></div></div><div className="moa-rounds">{meetingRounds.map((r,i) => <article className={r.state === '논의 중' ? 'active' : ''} key={r.code}><span>{r.code}</span><div><strong>{r.name}</strong><small>{i === 0 ? '여행 페이스 · 우선순위' : i === 1 ? '공항 · 패스 · 택시' : i === 2 ? '난바 후보 4곳 확인 중' : '앞선 결론을 보고 얘기할 예정'}</small></div><em className={r.state === '완료' ? 'done' : r.state === '논의 중' ? 'doing' : ''}>{r.state === '완료' ? <CheckCircle weight="fill" /> : r.state === '논의 중' ? <SpinnerGap /> : <Clock />}{r.state}</em></article>)}</div><div className="moa-async-note"><Hourglass weight="duotone" /><div><strong>5–20분 정도 걸릴 수 있어요.</strong><p>기다리지 않아도 돼요. 끝나면 바로 알려드릴게요.</p></div><label><input name="notifyWhenDone" type="checkbox" role="switch" checked={notifyWhenDone} onChange={(e) => setNotifyWhenDone(e.target.checked)} /><span aria-hidden="true" /> 끝나면 알림 받기</label></div><div className="moa-actions center"><button className="moa-button ghost" onClick={later}>나중에 보기</button><button className="moa-button" onClick={next}>완료 화면 보기 <ArrowRight /></button></div></Page>
}

function MeetingComplete({ result, replay }: { result: () => void; replay: () => void }) { return <section className="moa-complete"><div className="moa-status-mark verdict"><Gavel weight="fill" /></div><span className="moa-kicker">MEETING COMPLETE</span><h1>오케이, 합의 봤습니다.</h1><p>누가 어디서 양보했는지도 같이 확인해보세요.</p><div className="moa-complete-stats"><span><strong>7</strong>논의 라운드</span><span><strong>42</strong>살펴본 후보</span><span><strong>7.7</strong>평균 만족도</span></div><div className="moa-actions"><button className="moa-button ghost big" onClick={replay}>어떻게 싸웠는지 구경하기</button><button className="moa-button big" onClick={result}>결과 보기 <ArrowRight /></button></div></section> }

function FinalResult({ tab, setTab, openReason, replay, rerun, rerunRemaining, share, copy }: { tab: ResultTab; setTab: (t: ResultTab) => void; openReason: (round:DecisionRoundId) => void; replay: () => void; rerun: (category:string) => void; rerunRemaining:number; share:()=>void; copy:()=>void }) {
  const tabs: [ResultTab,string][] = [['summary','한눈에 보기'],['itinerary','상세 일정'],['booking','예약 · 예산'],['decisions','결정 근거'],['fairness','누가 양보했나요?'],['backup','계획대로 안 된다면?']]
  return <Page>
    <RoomHeading status="합의 완료" completed />
    <section className="moa-plan-readiness" title={planReadiness.explanation}><div><CheckCircle weight="fill" /><span><strong>계획 상태 · {planReadiness.label}</strong><small>{planReadiness.explanation}</small></span></div><div className="moa-result-actions"><button onClick={copy}><Copy /> 링크 복사</button><button onClick={share}><ShareNetwork /> 공유</button><button onClick={() => window.print()}><Printer /> 인쇄</button><button onClick={downloadTripCalendar}><CalendarBlank /> 캘린더</button></div></section>
    <div className="moa-result-meta"><span><CheckCircle weight="fill" /> 합의 완료</span><p>7라운드 · 재심 1회 · 후보 42개 확인</p><button onClick={replay}><Play weight="fill" /> 어떻게 싸웠는지 구경하기</button></div>
    <nav className="moa-result-tabs">{tabs.map(([key,label]) => <button className={tab === key ? 'active' : ''} onClick={() => setTab(key)} key={key}>{label}</button>)}</nav>
    {tab === 'summary' && <SummaryTab openReason={openReason} setTab={setTab} />}
    {tab === 'itinerary' && <ItineraryTab openReason={openReason} />}
    {tab === 'booking' && <BookingTab />}
    {tab === 'decisions' && <DecisionTab open={openReason} />}
    {tab === 'fairness' && <FairnessTab />}
    {tab === 'backup' && <BackupTab />}
    <RerunSection open={rerun} remaining={rerunRemaining} />
  </Page>
}

function SummaryTab({ openReason, setTab }: { openReason: (round:DecisionRoundId) => void; setTab: (t: ResultTab) => void }) {
  const snapshot = [{ value: '3박 4일', label: '여행 기간', Icon: CalendarBlank }, { value: '₩830,000', label: '1인 예상', Icon: Coins }, { value: '난바', label: '핵심 지역', Icon: MapPin }, { value: '3건', label: '예약 필요', Icon: Ticket }, { value: '7.7', label: '평균 만족도', Icon: ChartDonut }]
  return <div className="moa-result-content">
    <section className="moa-agent-result-summary"><header><span className="moa-kicker">HOW MY AGENT REPRESENTED ME</span><h2>민지의 대리인은 이렇게 움직였어요.</h2></header><div><p><ShieldCheck /> <strong>하드 조건</strong><span>예산, 새벽 비행 제외, 갑각류 제한을 모두 지켰어요.</span></p><p><TrendUp /> <strong>끝까지 챙긴 것</strong><span>도톤보리 야경, 난바 숙소, 로컬 음식 경험을 반영했어요.</span></p><p><TrendDown /> <strong>양보한 것</strong><span>스파 호텔 대신 DAY 2에 스파월드를 넣었어요.</span></p><p><ChartDonut /> <strong>내 만족도</strong><span><b>8.3 / 10</b> · 그룹 평균보다 0.6 높아요.</span></p></div><button onClick={() => setTab('fairness')}>양보 균형 전체 보기 <ArrowRight /></button></section>
    <section className="moa-satisfaction"><div className="moa-summary-title"><div><span className="moa-kicker">SATISFACTION FIRST</span><h2>그래서, 다들 괜찮대요?</h2></div><div className="moa-main-score"><strong>7.7</strong><span>/ 10 평균 만족도</span><em><Check /> 모두 6점 이상</em></div></div><div className="moa-member-scores">{roomMembers.map((m,i) => <article key={m.name}><div><span style={{ background: m.color }}>{m.initial}</span><strong>{m.name}</strong>{i === 0 && <i>나</i>}</div><b>{m.score.toFixed(1)}</b><div><span style={{ width: `${m.score*10}%`, background: m.color }} /></div><small>{i === 0 ? '숙소에서 조금 양보' : i === 5 ? '액티비티에서 양보' : '취향이 고르게 반영됐어요'}</small></article>)}</div><div className="moa-min-score"><ShieldCheck weight="duotone" /><p><strong>가장 낮은 점수도 7.2 / 10</strong><span>평균만 높이고 누군가 크게 손해 보는 일은 없게 맞췄어요.</span></p></div></section>
    <section className="moa-trip-snapshot"><span className="moa-kicker">TRIP AT A GLANCE</span><h2>우리 여행, 이렇게 정리됐어요.</h2><div>{snapshot.map(({value,label,Icon}) => <article key={label}><Icon weight="duotone" /><strong>{value}</strong><span>{label}</span></article>)}</div></section>
    <section className="moa-decision-highlight"><div><span className="moa-kicker">KEY DECISION</span><h2>숙소는 난바 H-03에서<br />3박 내내 지내요.</h2><p>이동은 편하고, 수아가 싫어한 숙소 이동도 없앴어요.</p><button onClick={() => openReason('R2')}><Info weight="fill" /> 근데 왜 여기로 정했어요?</button></div><div className="moa-hotel-card"><Buildings weight="duotone" /><small>SELECTED</small><strong>난바 호텔 H-03</strong><span>역 도보 7분 · 6인 투숙 · 1인 ₩210,000</span></div></section><button className="moa-next-section" onClick={() => setTab('itinerary')}>상세 일정 보기 <ArrowRight /></button>
  </div>
}

function ItineraryTab({ openReason }: { openReason: (round:DecisionRoundId) => void }) { const [day,setDay]=useState(0); const d=itineraryDays[day]; return <div className="moa-result-content"><div className="moa-itinerary-layout"><aside><span className="moa-kicker">FINAL PLAN</span><h2>우리 여행, 이렇게 정리됐어요.</h2><p>무리한 이동은 줄이고, 매일 숨 돌릴 시간은 남겼어요.</p><div>{itineraryDays.map((x,i) => <button className={day===i?'active':''} onClick={() => setDay(i)} key={x.day}><span>{x.day}</span><strong>{x.title}</strong><CaretRight /></button>)}</div></aside><section className="moa-day-plan"><header><div><span>{d.day}</span><h2>{d.title}</h2></div><p><span>총 도보 <b>{d.walk}</b></span><span>총 이동 <b>{d.travel}</b></span></p></header><div>{d.items.map(([time,title,meta],i) => <article key={title}><time>{time}</time><span className="moa-time-dot"><i />{i<d.items.length-1&&<b />}</span><div><strong>{title}</strong><p>{meta}</p>{meta.includes('예약') && <em>예약 필요</em>}</div></article>)}</div><button className="moa-why" onClick={() => openReason('R5')}><Info weight="fill" /> 근데 왜 이 동선이에요? <ArrowRight /></button></section><RouteMap day={day} /></div></div> }

function RouteMap({ day }: { day: number }) {
  const pins = [[18,72],[37,50],[56,63],[70,38],[84,57]]
  return <section className="moa-route-map"><header><div><span className="moa-kicker">ROUTE MAP</span><h2>{itineraryDays[day].day} 이동 경로</h2></div><span>오늘 동선을 한눈에 볼 수 있어요</span></header><div className="moa-map-canvas"><span className="moa-river river-a"/><span className="moa-river river-b"/><span className="moa-map-line"/>{pins.map(([left,top],i)=><motion.i key={`${day}-${i}`} style={{left:`${left}%`,top:`${top}%`}} initial={{scale:0}} animate={{scale:1}} transition={{delay:i*.06}}><b>{i+1}</b></motion.i>)}<strong className="moa-map-label a">난바</strong><strong className="moa-map-label b">도톤보리</strong><strong className="moa-map-label c">우메다</strong></div><footer><span><i/>선택 일정</span><b>오늘 갈 곳만 순서대로 보여줘요.</b></footer></section>
}

function BookingTab() {
  const [checked, setChecked] = useState<Record<string,boolean>>(() => {
    const saved = localStorage.getItem('moa-booking-checklist')
    if (saved) { try { return JSON.parse(saved) as Record<string,boolean> } catch { /* use defaults */ } }
    return Object.fromEntries(bookingChecklistItems.map((item) => [item.id,item.defaultDone]))
  })
  useEffect(() => localStorage.setItem('moa-booking-checklist', JSON.stringify(checked)), [checked])
  const icons = { '항공':AirplaneTilt, '숙소':Buildings, '식당':ForkKnife, '티켓':Ticket }
  return <div className="moa-result-content"><div className="moa-section-heading"><span className="moa-kicker">TO BOOK</span><h2>미리 예약해야 해요</h2><p>급한 것부터 하나씩 챙겨볼까요?</p></div><div className="moa-reservations">{reservations.map((item) => { const Icon=icons[item.type]; return <article key={item.id}><span><Icon weight="duotone" /></span><div><small>{item.type} · {item.deadline}</small><strong>{item.name}</strong><p>{item.price} / 인</p><div className="moa-booking-meta"><span>담당 {item.owner}</span><span>{item.verification}</span></div></div><em className={item.status==='완료'?'done':''}>{item.status}</em><a href={item.externalUrl} target="_blank" rel="noreferrer">{item.status==='완료'?'예약 정보 보기':'예약 페이지 열기'} <ArrowRight /></a></article>})}</div><section className="moa-booking-checklist"><header><div><span className="moa-kicker">CHECKLIST</span><h2>예약 준비 체크</h2></div><strong>{Object.values(checked).filter(Boolean).length} / {bookingChecklistItems.length}</strong></header>{bookingChecklistItems.map((item) => <label key={item.id}><input type="checkbox" checked={Boolean(checked[item.id])} onChange={(event) => setChecked((current) => ({...current,[item.id]:event.target.checked}))} /><span><Check /></span>{item.label}</label>)}</section><div className="moa-budget"><div><span className="moa-kicker">BUDGET</span><h2>예상 비용</h2><p>예비비까지 포함해 모두의 최대 예산 안에 들어왔어요.</p><div className="moa-budget-total"><span>1인 예상 합계</span><strong>₩830,000</strong><em><Check /> 전원 예산 충족</em></div></div><div>{budget.map(([label,value],i) => <p key={label}><span>{label}</span><i><b style={{ width: `${Number(value)/3100}%`, background: ['#F2714B','#6C9E79','#D99B3D','#8B78B8','#4D8CA8','#8E8B83'][i] }} /></i><strong>₩{Number(value).toLocaleString()}</strong></p>)}<div className="moa-common-money"><Receipt /><span><strong>그룹 공동경비 ₩1,200,000</strong><small>여행 후 1/N로 정산해요.</small></span></div></div></div></div>
}

function FairnessTab() { return <div className="moa-result-content"><div className="moa-section-heading"><span className="moa-kicker">FAIRNESS, EXPLAINED</span><h2>이번엔 누가 양보했어요?</h2><p>한 번 양보했다면, 다른 결정에서는 그 사람 취향을 더 챙겼어요.</p></div><div className="moa-concessions">{roomMembers.map((m,i) => <article key={m.name}><header><span style={{background:m.color}}>{m.initial}</span><div><strong>{m.name}</strong><small>만족도 {m.score.toFixed(1)}</small></div></header><div><p><TrendDown />{i%2===0?'숙소 · 조금 양보':'액티비티 · 조금 양보'}</p><p><TrendUp />{i%2===0?'식사 · 더 반영':'동선 · 더 반영'}</p></div><footer>{i===0?'숙소에서는 조금 양보했지만, 식사와 액티비티 취향은 더 많이 챙겼어요.':'한 가지는 양보했지만, 진짜 안 된다고 한 조건은 모두 지켰어요.'}</footer></article>)}</div><section className="moa-dissent"><div className="moa-section-heading"><span className="moa-kicker">MINORITY OPINIONS</span><h2>선택되진 않았지만, 이 의견도 있었어요.</h2></div><article><span style={{background:roomMembers[5].color}}>수</span><div><strong>수아</strong><blockquote>“숙소를 옮기지 않는 일정이 더 좋았어요.”</blockquote><p><Check /> 그래서 3일차에도 난바 숙소를 유지하고 짐 보관 서비스를 넣었어요.</p></div></article><article><span style={{background:roomMembers[3].color}}>민</span><div><strong>민재</strong><blockquote>“교토보다 유니버설 스튜디오가 더 끌렸어요.”</blockquote><p><Check /> 최종 선택은 아니지만 DAY 2 저녁 자유시간을 넉넉히 남겼어요.</p></div></article></section></div> }

function BackupTab() { return <div className="moa-result-content"><div className="moa-section-heading"><span className="moa-kicker">PLAN B</span><h2>계획대로 안 된다면?</h2><p>비가 오거나 예약에 실패해도 바로 바꿀 수 있게 준비했어요.</p></div><div className="moa-planb-grid"><PlanB icon={Warning} title="비 오는 날" from="오사카성 야외 일정" to="나카노시마 미술관" note="이동 시간 +8분 · 비용 +₩12,000" /><PlanB icon={ForkKnife} title="식당 예약 실패" from="이자카야 B" to="후보 2위 이자카야 C" note="도보 4분 거리 · 예산 동일" /></div><div className="moa-section-heading issue"><span className="moa-kicker">STILL TO CHECK</span><h2>아직 확인할 게 있어요</h2></div><div className="moa-issues"><article><Warning weight="fill" /><div><strong>이자카야 B</strong><p>6인 예약이 되는지 직접 확인해야 해요.</p></div><em>확인 필요</em></article><article><Info weight="fill" /><div><strong>가격이 달라질 수 있어요</strong><p>항공과 숙소는 예약할 때 가격이 바뀔 수 있어요.</p></div><em>참고</em></article></div></div> }

function MeetingReplay({ back }: { back: () => void }) {
  const [round,setRound]=useState(2)
  const [filter,setFilter]=useState('전체')
  const [expanded,setExpanded]=useState(false)
  const [playing,setPlaying]=useState(true)
  const [speed,setSpeed]=useState<1|1.5|2>(1)
  const matches = (message: typeof replayMessages[number]) => filter==='전체'||filter==='내 대리인'&&(message.speaker.includes('민지')||['conflict','fact','verdict','chief'].includes(message.type))||filter==='다른 대리인'&&message.type==='agent'&&!message.speaker.includes('민지')||filter==='심판'&&['fact','verdict'].includes(message.type)||filter==='Chief'&&message.type==='chief'
  const filtered = replayMessages.filter((message) => (expanded || message.round===round) && matches(message))
  const [revealedCount,setRevealedCount]=useState(1)
  useEffect(() => { setRevealedCount(filtered.length ? 1 : 0); setPlaying(true) }, [round,filter,expanded,filtered.length])
  useEffect(() => {
    if (!playing || revealedCount >= filtered.length) return
    const timer = window.setTimeout(() => setRevealedCount((count) => count + 1), 900 / speed)
    return () => window.clearTimeout(timer)
  }, [playing,revealedCount,filtered.length,speed])
  const cycleSpeed = () => setSpeed((current) => current === 1 ? 1.5 : current === 1.5 ? 2 : 1)
  const visible = filtered.slice(0,revealedCount)
  return <Page><div className="moa-replay-page"><button className="moa-back" onClick={back}><ArrowLeft /> 우리 여행으로 돌아가기</button><div className="moa-replay-head"><div><span className="moa-kicker">MEETING REPLAY</span><h1>우리 대리인들은 어떻게 합의했을까?</h1><p>끝난 회의를 라운드별로 다시 볼 수 있어요.</p></div></div><p className="moa-replay-note"><Info weight="fill" /> 이미 끝난 대리인 중재를 다시 보고 있어요.</p><div className="moa-round-nav">{meetingRounds.map((item,index) => <button className={round===index&&!expanded?'active':''} onClick={() => {setRound(index);setExpanded(false)}} key={item.code}><span>{item.code}</span>{item.name}</button>)}</div><div className="moa-replay-controls"><div>{['전체','내 대리인','다른 대리인','심판','Chief'].map((item) => <button className={filter===item?'active':''} onClick={() => setFilter(item)} key={item}>{item}</button>)}</div><div><button onClick={() => setExpanded(!expanded)}>{expanded?'현재 라운드':'전체 보기'}</button><button onClick={cycleSpeed} aria-label="재생 속도 변경">{speed}x</button><button onClick={() => revealedCount >= filtered.length ? setRevealedCount(1) : setPlaying(!playing)}>{revealedCount >= filtered.length ? <><Play weight="fill"/>다시 재생</> : playing ? <><Pause weight="fill"/>일시정지</> : <><Play weight="fill"/>재생</>}</button></div></div><div className="moa-replay-progress"><span style={{width:`${filtered.length ? revealedCount/filtered.length*100 : 0}%`}} /></div><div className="moa-replay-layout"><section className="moa-message-stream" aria-label="대리인 회의 기록"><AnimatePresence>{visible.length ? visible.map((message,index) => <AgentMessage key={`${message.round}-${message.speaker}-${index}`} message={message} delay={0} sequence={index} />) : <div className="moa-empty"><Info />이 필터에 맞는 기록은 없어요.</div>}</AnimatePresence></section></div></div></Page>
}

function AgentMessage({ message, delay, sequence }: { message: typeof replayMessages[number]; delay: number; sequence: number }) {
  const timestamp = `20:${String(12 + message.round * 5 + sequence).padStart(2,'0')}`
  if (message.type === 'conflict') {
    const positions = message.round === 2
      ? [['맛집 · 경험 우선','민지 · 예린'],['숙소 위치 우선','서연 · 지훈 · 수아']]
      : [['경험 예산 우선','민지 · 예린'],['숙소 품질 우선','서연 · 지훈']]
    return <motion.section className="moa-chat-conflict" initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay}}><div className="moa-chat-separator"><span /><strong>의견이 갈렸어요 · {message.round===2?'2 : 3':'2 : 2'}</strong><span /></div><div className="moa-chat-positions"><div><strong>{positions[0][0]}</strong><span>{positions[0][1]}</span></div><div><strong>{positions[1][0]}</strong><span>{positions[1][1]}</span></div></div></motion.section>
  }
  if (message.type === 'fact') return <motion.section className="moa-chat-fact" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay}}><header><h3>심판이 확인했어요</h3><time>{timestamp}</time></header>{message.round===2?<div className="moa-fact-lines"><p><strong>H-03</strong><span>난바역 7분 · 6인 가능 · ₩1,260,000</span></p><p><strong>H-07</strong><span>난바역 15분 · ₩1,080,000</span></p><p className="difference"><strong>핵심 차이</strong><span>18만원 절약 vs 이동시간 단축</span></p></div>:<p>{message.text}</p>}</motion.section>
  if (message.type === 'verdict') return <motion.section className="moa-chat-decision" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay}}><small>합의됐어요.</small><h3>{message.round===2?'H-03 호텔':'이번 라운드 결론'}</h3><p>{message.round===2?<>숙소는 H-03으로 정하고,<br />식사 예산은 유지하기로 했어요.</>:message.text}</p>{message.round===2&&<footer>민지가 이번 라운드에서 한 번 양보했어요.</footer>}</motion.section>
  if (message.type === 'chief') return <motion.footer className="moa-chat-chief" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay}}><header><strong>Chief 확인 <Check /></strong><time>{timestamp}</time></header><p>{message.round===2?'하드 조건 · 전체 예산 · 양보 균형 모두 통과':message.text}</p><b>재심 없이 통과</b></motion.footer>

  const name = message.speaker.replace('의 대리인','')
  const profile = roomMembers.find((member) => member.name === name) ?? roomMembers[0]
  const right = ['서연','수아','예린'].includes(name)
  return <motion.article className={`moa-chat-message ${right?'right':''}`} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay}}><header><span style={{background:profile.pale,color:profile.color}}>{profile.initial}</span><div><strong>{message.speaker}</strong><time>{timestamp}</time></div></header><p>{message.text}</p></motion.article>
}

function RerunSection({ open, remaining }: { open:(category:string)=>void; remaining:number }) { return <section className="moa-rerun"><div><span className="moa-kicker">ONE CATEGORY AT A TIME</span><h2>이건 다시 얘기해봐요.</h2><p>전체 여행은 건드리지 않고, 마음에 안 드는 부분만 다시 맞춰볼게요.</p><strong>{remaining > 0 ? `${remaining}번 더 얘기할 수 있어요` : '남은 다시 논의가 없어요'}</strong></div><div>{['교통','숙소','액티비티','식사','동선','예산'].map((category)=><button disabled={remaining===0} key={category} onClick={()=>open(category)}>{category} 다시 얘기하기 <ArrowRight /></button>)}</div></section> }

function RerunModal({ category, remaining, close, submit }: { category:string; remaining:number; close:()=>void; submit:(summary:string)=>void }) {
  const [mode,setMode]=useState<'condition'|'candidates'|'again'>('condition')
  const [request,setRequest]=useState('')
  const [excludeWinner,setExcludeWinner]=useState(false)
  const [confirming,setConfirming]=useState(false)
  const modeLabels = { condition:'조건을 바꿀래요', candidates:'다른 후보를 볼래요', again:'같은 조건으로 다시 볼래요' }
  const impactItems = category === '숙소' ? ['액티비티','동선','예산'] : category === '교통' ? ['동선','예산'] : category === '예산' ? ['숙소','액티비티','식사'] : ['동선','예산']
  const impact = `${impactItems.join(' · ')}을 함께 다시 계산해요.`
  const summary = `${category} 다시 논의를 요청했어요. ${modeLabels[mode]}${request.trim() ? ` · ${request.trim()}` : ''}`
  return <motion.div className="moa-modal-bg" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onMouseDown={close}><motion.div className="moa-rerun-modal" initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} onMouseDown={(event)=>event.stopPropagation()}><button className="moa-modal-close" onClick={close}><X /></button><span className="moa-kicker">REOPEN {category.toUpperCase()} · {remaining} LEFT</span>{confirming ? <><h2>{category}, 다시 얘기할까요?</h2><div className="moa-rerun-confirm"><p><strong>대상</strong>{category}</p><p><strong>방식</strong>{modeLabels[mode]}</p>{request.trim()&&<p><strong>요청</strong>{request}</p>}<p><strong>다시 계산</strong>{impactItems.join(' · ')}</p><p><strong>현재 상태</strong>만족도 7.7 · 1인 ₩830,000</p><p><strong>예약 영향</strong>{category === '숙소' ? '난바 호텔 예약이 바뀔 수 있어요.' : '연결된 예약 항목을 다시 확인해요.'}</p></div><div className="moa-rerun-actions"><button className="moa-button ghost" onClick={close}>취소</button><button className="moa-link" onClick={()=>setConfirming(false)}>수정</button><button className="moa-button" onClick={()=>submit(summary)}>다시 논의 확인 <MagicWand /></button></div></> : <><h2>{category}, 어떻게 다시 볼까요?</h2><p>선택한 범위 밖의 결정은 그대로 유지해요.</p><div className="moa-rerun-modes">{(Object.keys(modeLabels) as Array<keyof typeof modeLabels>).map((key)=><button className={mode===key?'active':''} onClick={()=>setMode(key)} key={key}><Check />{modeLabels[key]}</button>)}</div>{mode==='again'&&<p className="moa-rerun-mode-note">취향을 바꾸지 않아도 후보와 조건을 다시 확인하면 결과가 달라질 수 있어요.</p>}{mode==='candidates'&&<label className="moa-rerun-toggle"><input type="checkbox" checked={excludeWinner} onChange={(event)=>setExcludeWinner(event.target.checked)} /> 현재 선택안 제외하고 보기</label>}<textarea value={request} onChange={(event)=>setRequest(event.target.value)} placeholder={mode==='condition'?'예: 숙소에 10만원 더 써도 괜찮아요.':'추가로 전할 말이 있다면 적어주세요.'} /><div className="moa-rerun-impact"><Info /><span><strong>함께 다시 계산</strong>{impact}{excludeWinner&&' 현재 선택안은 후보에서 제외해요.'}<small>현재 만족도 7.7 · 1인 예상 ₩830,000</small></span></div><button className="moa-button full big" onClick={()=>setConfirming(true)}>영향 확인하기 <ArrowRight /></button></>}</motion.div></motion.div>
}

function RoomHeading({ status, completed=false }: { status:string; completed?:boolean }) { return <div className="moa-room-heading"><div><span className="moa-kicker">OSAKA · TRIP ROOM</span><h1>오사카 3박 4일</h1><p><CalendarBlank /> 2026.10.15 – 10.18 <span>·</span><UsersThree /> 6명</p></div><em className={completed?'completed':''}>{completed?<CheckCircle weight="fill"/>:<span/>}{status}</em></div> }
function Page({ children, narrow=false }: { children:React.ReactNode; narrow?:boolean }) { return <div className={`moa-page ${narrow?'narrow':''}`}>{children}</div> }
function StickyAction({ note, button, onClick, disabled=false }: { note:string; button:string; onClick:()=>void; disabled?:boolean }) { return <div className="moa-sticky"><p><CheckCircle weight="fill" />{note}</p><button className="moa-button" onClick={onClick} disabled={disabled}>{button}<ArrowRight /></button></div> }
function SurveyCard({ icon:Icon,title,children,full=false }: { icon:typeof Coins; title:string; children:React.ReactNode; full?:boolean }) { return <section className={`moa-survey-card ${full?'full':''}`}><header><span><Icon weight="duotone" /></span><h2>{title}</h2></header>{children}</section> }
function ChipGroup({ items,selected,select,plus=false }: { items:string[]; selected:string[]; select:(x:string)=>void; plus?:boolean }) {
  const [adding, setAdding] = useState(false)
  const [custom, setCustom] = useState('')
  const visibleItems = [...items, ...selected.filter((item) => !items.includes(item))]
  const addCustom = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = custom.trim()
    if (!trimmed) return
    if (!selected.includes(trimmed)) select(trimmed)
    setCustom('')
    setAdding(false)
  }
  return <div className="moa-chip-group">{visibleItems.map((x)=><button type="button" aria-pressed={selected.includes(x)} className={selected.includes(x)?'active':''} onClick={()=>select(x)} key={x}>{selected.includes(x)&&<Check/>}{x}</button>)}{plus&&!adding&&<button type="button" onClick={() => setAdding(true)}><Plus/>직접 입력</button>}{plus&&adding&&<form className="moa-chip-custom" onSubmit={addCustom}><input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="조건 입력" autoFocus /><button type="submit">추가</button></form>}</div>
}
function PersonaBlock({ icon:Icon,title,children }: { icon:typeof Coins; title:string; children:React.ReactNode }) { return <section className="moa-persona-block"><header><Icon weight="duotone" /><span>{title}</span></header><div>{children}</div></section> }
function PlanB({ icon:Icon,title,from,to,note }: { icon:typeof Warning; title:string; from:string; to:string; note:string }) { return <article className="moa-planb"><header><span><Icon weight="duotone" /></span><div><small>IF · {title}</small><strong>{title}</strong></div></header><div><p><small>ORIGINAL</small><strong>{from}</strong></p><ArrowRight/><p><small>PLAN B</small><strong>{to}</strong></p></div><footer>{note}</footer></article> }

export default App
