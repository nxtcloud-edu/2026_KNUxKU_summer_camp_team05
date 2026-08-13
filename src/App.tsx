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
  planReadiness, preferenceSliders, reservations, roomMembers, type DestinationPack,
} from './data'
import {
  createEmptySurveyDraft, createRoomSubmissionPayload, createSurveySubmissionPayload,
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
import airplaneImage from '../assets/04_airplane.png'
import suitcaseImage from '../assets/05_suitcase.png'
import airplaneWindowImage from '../assets/06_airplane_window.png'
import passportTicketImage from '../assets/07_passport_ticket.png'
import glovesImage from '../assets/gloves.png'

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
    const parsed = JSON.parse(saved) as Partial<SurveyDraft>
    return {
      ...empty,
      ...parsed,
      availability:{...empty.availability,...parsed.availability},
      hardConstraints:{...empty.hardConstraints,...parsed.hardConstraints},
      travelStyles:{...empty.travelStyles,...parsed.travelStyles},
      activityScores:{...empty.activityScores,...parsed.activityScores},
    }
  } catch { return empty }
}

const stageNav: Record<Stage, string> = {
  landing:'소개', home:'내 여행', destinations:'여행지', create:'방 만들기', invite:'친구 초대', lobby:'여행 방', availability:'설문', hard:'설문', sliders:'설문', cards:'설문', free:'설문',
  'persona-loading':'내 대리인', persona:'내 대리인', submitted:'준비 상태', 'date-conflict':'날짜 조율', running:'대리인 회의', complete:'합의 완료', result:'우리 여행', replay:'회의 구경하기',
}

const replayEpisodes = [
  { redCorner:'여유 · 휴식', blueCorner:'경험 · 방문', conversation:[{side:'red',speaker:'민지의 대리인',text:'일정을 너무 빡빡하게 잡고 싶지 않아요.'},{side:'blue',speaker:'서연의 대리인',text:'짧아도 오사카를 많이 보고 싶어요.'},{side:'red',speaker:'지훈의 대리인',text:'저도 하루에 여유가 있었으면 해요.'},{side:'blue',speaker:'예린의 대리인',text:'핵심 장소는 놓치고 싶지 않아요.'},{side:'red',speaker:'수아의 대리인',text:'자유시간은 꼭 남겨주세요.'}] as const, score:'3 : 2', factTitle:'하루 3곳 일정', facts:['평균 이동 54분','자유시간 90분','6명 모두 가능'], compromise:['이 정도 여유면 괜찮아요.','좋아요. 핵심 장소는 지켜주세요.'], resultTitle:'하루 3곳 일정', resultCopy:'핵심 장소는 챙기되\n매일 자유시간을 남기기로 했어요.', concession:'지훈이 방문 수에서 한 번 양보했어요.' },
  { redCorner:'택시 · 편의', blueCorner:'패스 · 예산', conversation:[{side:'red',speaker:'민지의 대리인',text:'공항에서는 편하게 택시를 타고 싶어요.'},{side:'blue',speaker:'서연의 대리인',text:'교통비는 최대한 아끼고 싶어요.'},{side:'blue',speaker:'지훈의 대리인',text:'저도 예산을 아끼는 쪽이 좋아요.'},{side:'red',speaker:'예린의 대리인',text:'짐이 많아서 환승은 부담스러워요.'},{side:'blue',speaker:'수아의 대리인',text:'빠른 열차면 충분히 편할 것 같아요.'}] as const, score:'2 : 4', factTitle:'라피트 특급', facts:['택시보다 -20,000원 / 인','난바까지 38분','6명 좌석 가능'], compromise:['38분이면 충분히 편하네요.','시내에서는 패스를 쓰면 좋아요.'], resultTitle:'라피트 + 대중교통', resultCopy:'공항에서는 라피트를 타고\n시내에서는 대중교통을 쓰기로 했어요.', concession:'민재가 이동 편의에서 한 번 양보했어요.' },
  { redCorner:'맛집 · 경험', blueCorner:'위치 · 이동', conversation:[{side:'red',speaker:'민지의 대리인',text:'맛집에 더 쓰고 싶어요.'},{side:'blue',speaker:'서연의 대리인',text:'이동시간은 줄이고 싶어요.'},{side:'blue',speaker:'지훈의 대리인',text:'저도 위치는 포기하기 어려워요.'},{side:'red',speaker:'예린의 대리인',text:'여행에서는 먹는 경험이 더 중요해요.'},{side:'blue',speaker:'수아의 대리인',text:'매일 멀리 이동하는 건 힘들 것 같아요.'}] as const, score:'2 : 3', factTitle:'난바역 3분 호텔', facts:['+28,000원 / 인','이동시간 -64분','6인 가능'], compromise:['7분이면 괜찮네요.\n대신 식사 예산은 유지했으면 좋겠어요.','좋아요.'], resultTitle:'난바역 3분 호텔', resultCopy:'숙소 위치를 우선하되\n식사 예산은 유지하기로 했어요.', concession:'민지가 이번 라운드에서 한 번 양보했어요.' },
  { redCorner:'강한 경험', blueCorner:'느긋한 일정', conversation:[{side:'red',speaker:'민지의 대리인',text:'강한 액티비티가 하나는 꼭 필요해요.'},{side:'blue',speaker:'서연의 대리인',text:'하루 종일 줄 서는 건 피하고 싶어요.'},{side:'blue',speaker:'지훈의 대리인',text:'저도 이동이 너무 많으면 힘들어요.'},{side:'red',speaker:'예린의 대리인',text:'기억에 남을 경험은 하나 넣어요.'},{side:'blue',speaker:'수아의 대리인',text:'쉬는 시간도 충분히 필요해요.'}] as const, score:'2 : 3', factTitle:'스파월드 + 교토', facts:['대기시간 -110분','만족 조건 5명 충족','예산 범위 내'], compromise:['스파월드가 있으면 괜찮아요.','교토 일정도 여유 있게 가요.'], resultTitle:'스파월드 + 교토', resultCopy:'강한 경험 하나를 남기고\n나머지는 느긋하게 구성했어요.', concession:'민재가 유니버설에서 한 번 양보했어요.' },
  { redCorner:'로컬 맛집', blueCorner:'검증 · 예약', conversation:[{side:'red',speaker:'민지의 대리인',text:'현지인 맛집을 꼭 가보고 싶어요.'},{side:'blue',speaker:'서연의 대리인',text:'6명이 바로 앉을 수 있어야 해요.'},{side:'blue',speaker:'지훈의 대리인',text:'웨이팅이 짧은 곳이면 좋겠어요.'},{side:'red',speaker:'예린의 대리인',text:'관광객 식당은 피하고 싶어요.'},{side:'blue',speaker:'수아의 대리인',text:'예약 가능한 곳이 안전해요.'}] as const, score:'3 : 2', factTitle:'이자카야 B', facts:['6인 예약 가능','1인 ₩32,000','숙소 도보 8분'], compromise:['예약할 수 있으면 좋아요.','도보 8분도 괜찮아요.'], resultTitle:'이자카야 B', resultCopy:'로컬 분위기는 살리고\n6인 예약 가능한 곳으로 정했어요.', concession:'서연이 식당 분위기에서 한 번 양보했어요.' },
  { redCorner:'많이 보기', blueCorner:'이동 최소', conversation:[{side:'red',speaker:'민지의 대리인',text:'교토까지 하루에 같이 보고 싶어요.'},{side:'blue',speaker:'서연의 대리인',text:'숙소를 옮기는 일정은 싫어요.'},{side:'blue',speaker:'지훈의 대리인',text:'저도 짐을 다시 싸는 건 싫어요.'},{side:'red',speaker:'예린의 대리인',text:'온 김에 최대한 많이 보고 싶어요.'},{side:'blue',speaker:'수아의 대리인',text:'한 숙소에서 이동하는 게 편해요.'}] as const, score:'2 : 4', factTitle:'난바 고정 동선', facts:['숙소 이동 0회','짐 보관 가능','총 이동 -42분'], compromise:['숙소를 안 옮기면 괜찮아요.','자유시간도 남겨주세요.'], resultTitle:'난바 숙소 유지', resultCopy:'난바에서 오가는 동선으로 바꾸고\n자유시간을 한 번 더 넣었어요.', concession:'예린이 방문 수에서 한 번 양보했어요.' },
  { redCorner:'경험 예산', blueCorner:'전체 절약', conversation:[{side:'red',speaker:'민지의 대리인',text:'먹고 즐기는 예산은 지키고 싶어요.'},{side:'blue',speaker:'서연의 대리인',text:'1인 80만원은 넘기기 어려워요.'},{side:'blue',speaker:'지훈의 대리인',text:'예비비도 조금은 남겨두고 싶어요.'},{side:'red',speaker:'예린의 대리인',text:'기억에 남는 경험은 포기하지 말아요.'},{side:'blue',speaker:'수아의 대리인',text:'공동경비까지 포함해서 계산해요.'}] as const, score:'3 : 3', factTitle:'1인 예상 ₩780,000', facts:['전원 최대 예산 충족','공동경비 포함','예비비 ₩40,000'], compromise:['식사 예산이 유지되면 좋아요.','80만원 아래면 괜찮아요.'], resultTitle:'1인 ₩780,000', resultCopy:'모두의 최대 예산 안에서\n식사와 경험 예산을 지켰어요.', concession:'전원이 한 가지씩 조정했어요.' },
] as const

const replaySceneDurations = [2400,4200,11000,7200,5600,5600,2800]

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
        {stage === 'free' && <FreeSurvey mustDo={survey.mustDo} avoid={survey.avoid} change={(field, value) => setSurvey((old) => ({ ...old, [field]: value }))} next={submitSurvey} />}
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
  const [phase, setPhase] = useState(reduceMotion ? 7 : 0)
  const [compact, setCompact] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 620px)')
    const update = () => setCompact(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (reduceMotion) { setPhase(7); return }
    const durations = [1000, 650, 700, 700, 850, 950, 2200, 600]
    const timer = window.setTimeout(() => setPhase((current) => current >= 7 ? 0 : current + 1), durations[phase])
    return () => window.clearTimeout(timer)
  }, [phase, reduceMotion])

  const reveal = (at:number) => reduceMotion || phase >= at
  const resetting = !reduceMotion && phase === 7
  const redBubbleVisible = reveal(2) && !resetting && (!compact || phase < 3)
  const blueBubbleVisible = reveal(3) && !resetting && (!compact || phase < 5)
  const settled = reveal(5)
  return <div className="moa-fight-stage" aria-label="대리인들이 숙소 조건을 조율하는 예시">
    <img className="moa-fight-airplane" src={airplaneImage} alt="" aria-hidden="true" />
    <img className="moa-fight-suitcase" src={suitcaseImage} alt="" aria-hidden="true" />
    <img className="moa-fight-passport" src={passportTicketImage} alt="" aria-hidden="true" />
    <motion.aside className="moa-pop-bubble red" initial={false} animate={{ opacity:redBubbleVisible ? 1 : 0, x:redBubbleVisible ? (settled ? 12 : 0) : 36, y:redBubbleVisible ? (settled ? 7 : 0) : 15, scale:redBubbleVisible ? 1 : .95 }} transition={{ duration:.48, ease:[.22,1,.36,1] }}><span>민지의 대리인</span><strong>맛집에 더 쓰고 싶어요.</strong></motion.aside>
    <motion.aside className="moa-pop-bubble blue" initial={false} animate={{ opacity:blueBubbleVisible ? 1 : 0, x:blueBubbleVisible ? (settled ? -12 : 0) : -36, y:blueBubbleVisible ? (settled ? 7 : 0) : 15, scale:blueBubbleVisible ? 1 : .95 }} transition={{ duration:.48, ease:[.22,1,.36,1] }}><span>서연의 대리인</span><strong>이동시간은 줄이고 싶어요.</strong></motion.aside>
    <motion.div className="moa-fight-phone" initial={reduceMotion ? false : { opacity:0, y:40, rotate:3, scale:.96 }} animate={{ opacity:1, y:0, rotate:2.25, scale:1 }} transition={{ duration:.82, delay:.5, ease:[.22,1,.36,1] }}>
      <div className="moa-fight-bezel">
        <span className="moa-fight-island" />
        <div className="moa-fight-screen">
          <motion.div className="moa-fight-content" initial={false} animate={{ opacity:resetting ? 0 : 1 }} transition={{ duration:.48 }}>
          <header className="moa-fight-header"><motion.span initial={false} animate={{ opacity:reveal(1) && !resetting ? 1 : 0, y:reveal(1) && !resetting ? 0 : -8 }} transition={{ duration:.45 }}>ROUND 2 · 숙소</motion.span><strong>대리인 회의</strong></header>
          <section className="moa-fight-scoreboard">
            <div className="red"><small>맛집·경험</small><strong>민지의 대리인</strong></div>
            <motion.b initial={false} animate={{ opacity:reveal(4) && !resetting ? (reveal(6) ? .42 : 1) : 0, scale:reveal(4) && !resetting ? 1 : .9 }} transition={{ duration:.38 }}>VS</motion.b>
            <div className="blue"><small>위치·이동</small><strong>서연의 대리인</strong></div>
          </section>
          <motion.div className="moa-fight-vote" initial={false} animate={{ opacity:reveal(4) && !resetting ? (reveal(6) ? .48 : 1) : 0, y:reveal(4) && !resetting ? 0 : 6 }}><motion.span initial={false} animate={{opacity:reveal(4) ? 1 : 0,y:reveal(4) ? 0 : 4}} transition={{duration:.28}}>2</motion.span><motion.i initial={false} animate={{opacity:reveal(4) ? 1 : 0}} transition={{duration:.25,delay:.1}}>:</motion.i><motion.span initial={false} animate={{opacity:reveal(4) ? 1 : 0,y:reveal(4) ? 0 : 4}} transition={{duration:.28,delay:.2}}>3</motion.span></motion.div>
          <section className="moa-fight-ring">
            <i className="rope rope-one" /><i className="rope rope-two" /><i className="rope rope-three" />
            <motion.div className="moa-fighter red" initial={false} animate={{ opacity:reveal(1) && !resetting ? 1 : 0, x:reveal(1) && !resetting ? (reveal(2) && !settled ? 3 : 0) : -18, y:reveal(1) && !resetting ? [0,-2,0] : 4, rotate:reveal(2) && !settled ? 1.5 : 0 }} transition={{ opacity:{duration:.48}, x:{duration:.5,ease:'easeOut'}, rotate:{duration:.45}, y:{duration:2.8,repeat:Infinity,ease:'easeInOut'} }}><img src="/assets/landing/agent-red.png" alt="빨간 여행 대리인" /></motion.div>
            <motion.div className="moa-fighter referee" initial={false} animate={{ opacity:reveal(4) && !resetting ? 1 : 0, y:reveal(5) ? [-2,-5,-2] : 3, scale:reveal(5) ? 1.04 : 1 }} transition={{ opacity:{duration:.48}, scale:{duration:.5,ease:'easeOut'}, y:{duration:2.8,repeat:Infinity,ease:'easeInOut'} }}><img src="/assets/landing/referee.png" alt="팩트체크 심판" /></motion.div>
            <motion.div className="moa-fighter blue" initial={false} animate={{ opacity:reveal(3) && !resetting ? 1 : 0, x:reveal(3) && !resetting ? (!settled ? -3 : 0) : 18, y:reveal(3) && !resetting ? [0,-2,0] : 4, rotate:reveal(3) && !settled ? -1.5 : 0 }} transition={{ opacity:{duration:.48}, x:{duration:.5,ease:'easeOut'}, rotate:{duration:.45}, y:{duration:3.1,repeat:Infinity,ease:'easeInOut'} }}><img src="/assets/landing/agent-blue.png" alt="파란 여행 대리인" /></motion.div>
          </section>
          <motion.section className="moa-fight-fact" initial={false} animate={{ opacity:reveal(5) && !resetting ? 1 : 0, y:reveal(5) && !resetting ? 0 : 16 }} transition={{ duration:.48, ease:'easeOut' }}><header><Gavel weight="fill" /><strong>심판 팩트체크</strong></header><div><b>숙소 A</b><span>+28,000원 / 인</span><span>이동시간 -64분</span></div></motion.section>
          <motion.section className="moa-fight-result" initial={false} animate={{ opacity:reveal(6) && !resetting ? 1 : 0, y:reveal(6) && !resetting ? 0 : 14, scale:reveal(6) && !resetting ? 1 : .98 }} transition={{ duration:.52, ease:'easeOut' }}><CheckCircle weight="fill" /><div><small>합의 완료</small><strong>숙소 A 선택</strong><span>식사 예산은 유지하기로 했어요.</span></div></motion.section>
          <motion.div className="moa-fight-rounds" initial={false} animate={{opacity:reveal(4) && !resetting ? 1 : 0,y:reveal(4) && !resetting ? 0 : 5}} transition={{duration:.42}}>{['R0','R1','R2','R3'].map((round)=><span key={round} className={round==='R2'&&reveal(4)?'active':''}>{round}</span>)}</motion.div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  </div>
}

function Landing({ create, join, intro, how, login }: { create:()=>void; join:()=>void; intro:()=>void; how:()=>void; login:()=>void }) {
  const scrollToExample = () => document.getElementById('landing-example')?.scrollIntoView({ behavior:'smooth' })
  const steps = [{title:'취향 남기기',copy:'각자 원하는 여행을 알려주세요.'},{title:'대리인 회의',copy:'서로 다른 조건을 대신 조율해요.'},{title:'여행 확정',copy:'모두가 납득할 결과만 남겨요.'}]
  return <section className="moa-landing-v2">
    <nav className="moa-landing-nav"><Logo /><div><button onClick={intro}>서비스 소개</button><button onClick={how}>이용 방법</button><button onClick={scrollToExample}>여행 예시</button></div><aside><button className="login" onClick={login}>로그인</button><button className="start" onClick={create}>여행 시작하기 <ArrowRight /></button></aside></nav>
    <div className="moa-landing-hero"><motion.div className="moa-landing-copy" initial={false} animate={{ opacity:1 }}><motion.span initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{duration:.45}}>✈ 여행 취향 조율 서비스</motion.span><h1><motion.span initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={{duration:.62,delay:.08,ease:'easeOut'}}>여행 가서 싸우지 마.</motion.span><motion.em initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={{duration:.66,delay:.24,ease:'easeOut'}}>대신 싸워드림.</motion.em></h1><motion.p initial={{opacity:0,y:14}} animate={{opacity:1,y:0}} transition={{duration:.55,delay:.38}}>각자 원하는 건 달라도 괜찮아요.<br />취향만 남기면 대리인들이 대신 붙고, 합의까지 해드려요.</motion.p><motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{duration:.5,delay:.55}}><button className="primary" onClick={create}>여행 방 만들기 <ArrowRight /></button><button className="secondary" onClick={how}>어떻게 싸우나요? <Play weight="fill" /></button></motion.div></motion.div><LandingMeetingDemo /></div>
    <section className="moa-landing-steps" aria-label="모아 이용 과정">{steps.map((step,index)=><article key={step.title}><span>0{index+1}</span><div><strong>{step.title}</strong><p>{step.copy}</p></div>{index<steps.length-1&&<ArrowRight />}</article>)}</section>
    <section className="moa-landing-editorial" id="landing-example"><div><span>ONE TRIP, ONE DECISION</span><h2>여섯 명이 가도,<br />결정은 하나면 되니까.</h2><p>누가 이겼는지만 보여주지 않아요.<br />어떤 조건을 비교했고, 어디서 양보했는지까지 남겨요.</p><button onClick={join}>여행 예시 열기 <ArrowRight /></button></div><div className="moa-editorial-demo"><img src={airplaneWindowImage} alt="비행기 창밖으로 보이는 여행 풍경" /><section><header><span>MEETING REPLAY · R2</span><strong>숙소는 왜 A가 됐을까?</strong></header><blockquote>“7분이면 괜찮아요.<br />대신 식사 예산은 지켜주세요.”</blockquote><div><span>심판 확인</span><b>18만원 절약 vs 이동시간 단축</b></div><footer><CheckCircle weight="fill" /> 숙소 A로 합의했어요.</footer></section></div></section>
  </section>
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
  const toggle = (field: 'beliefs' | 'mobilityNeeds' | 'noGoItems', item: string) => set(field, value[field].includes(item) ? value[field].filter((x) => x !== item) : [...value[field], item])
  const incomplete = !value.budgetLimit.trim() || value.diet === null || value.walkingDistanceKm === null
  return <SurveyShell step={1} time="6분" title="이건 진짜 안 돼요." copy="여기서 고른 건 대리인이 절대 양보하지 않아요." next={next} disabled={incomplete}><div className="moa-hard-grid"><SurveyCard icon={Coins} title="예산"><label className="moa-field">1인 총예산 상한<div className="moa-money"><b>₩</b><input name="budgetLimit" inputMode="numeric" value={value.budgetLimit} onChange={(e) => set('budgetLimit', e.target.value)} placeholder="금액 입력" /><span>원</span></div></label><label className="moa-switch"><input name="includesFlight" type="checkbox" checked={value.includesFlight} onChange={(e) => set('includesFlight', e.target.checked)} /><span /> 항공 포함</label></SurveyCard><SurveyCard icon={ForkKnife} title="먹는 것"><ChipGroup items={['없음','비건','베지테리언','할랄','코셔','알레르기']} selected={value.diet ? [value.diet] : []} select={(diet) => set('diet', diet)} /></SurveyCard><SurveyCard icon={ShieldCheck} title="생활 · 신념"><ChipGroup items={['기도 시간 필요','음주 일정 제외','동물 체험 제외']} selected={value.beliefs} select={(item) => toggle('beliefs', item)} plus /></SurveyCard><SurveyCard icon={SuitcaseRolling} title="체력 · 이동"><label className={`moa-field moa-unanswered-range ${value.walkingDistanceKm === null ? 'unanswered' : ''}`}>하루에 얼마나 걸을 수 있나요?<input name="walkingDistanceKm" type="range" min="1" max="15" value={value.walkingDistanceKm ?? 8} onChange={(e) => set('walkingDistanceKm', Number(e.target.value))} /><div className="moa-range-label"><span>1km</span><strong>{value.walkingDistanceKm === null ? '선택 안 함' : `${value.walkingDistanceKm}km`}</strong><span>15km</span></div></label><ChipGroup items={['계단·경사 어려움','휠체어','유아차']} selected={value.mobilityNeeds} select={(item) => toggle('mobilityNeeds', item)} /></SurveyCard></div><SurveyCard icon={LockKey} title="절대 안 돼요" full><ChipGroup items={['새벽 비행','도미토리','남녀 혼숙','날것','놀이기구','장시간 버스','흡연실']} selected={value.noGoItems} select={(item) => toggle('noGoItems', item)} plus /></SurveyCard><div className="moa-warning"><Warning weight="fill" /><p><strong>빠진 조건은 없나요?</strong><span>여기에 적지 않으면 대리인이 모를 수도 있어요.</span></p></div></SurveyShell>
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

function FreeSurvey({ mustDo, avoid, change, next }: { mustDo: string; avoid: string; change: (field: 'mustDo' | 'avoid', value: string) => void; next: () => void }) { return <SurveyShell step={4} time="1분" title="마지막으로, 이것만 알려주세요" copy="대리인이 꼭 기억해야 할 말이 있다면 남겨주세요." next={next} nextLabel="내 대리인 만들기"><div className="moa-free-grid"><label><span><TrendUp />이번 여행에서 이것만은 꼭 하고 싶어요.</span><textarea name="mustDo" maxLength={100} value={mustDo} onChange={(e) => change('mustDo', e.target.value)} placeholder="예: 하루는 온천에서 느긋하게 쉬고 싶어요." /><small>{mustDo.length} / 100</small></label><label><span><TrendDown />이것만은 정말 피하고 싶어요.</span><textarea name="avoid" maxLength={100} value={avoid} onChange={(e) => change('avoid', e.target.value)} placeholder="예: 새벽 비행과 너무 빡빡한 일정은 싫어요." /><small>{avoid.length} / 100</small></label></div></SurveyShell> }

function PersonaLoading({ next }: { next: () => void }) { useEffect(() => { const t = window.setTimeout(next, 2600); return () => clearTimeout(t) }, [next]); return <section className="moa-loading"><div className="moa-status-mark loading"><SpinnerGap /></div><span className="moa-kicker">BUILDING MY AGENT</span><h1>내 편 만드는 중이에요</h1><p>답변을 하나씩 정리해서, 나를 잘 아는 대리인을 만들고 있어요.</p><div>{['절대 조건 챙기기','좋아하는 것 정리하기','말하는 방식 맞추기'].map((x,i) => <span style={{ animationDelay: `${i*.35}s` }} key={x}><SpinnerGap />{x}</span>)}</div></section> }

function Persona({ survey, confirm, edit }: { survey:SurveyDraft; confirm:()=>void; edit:()=>void }) {
  const ranked = osakaPreferences.map((item) => ({ ...item, score:survey.activityScores[item.id] })).filter((item):item is typeof item & { score:number } => item.score !== null).sort((a,b) => b.score - a.score)
  const strongest = ranked.slice(0,3)
  const lowest = [...ranked].sort((a,b) => a.score - b.score).slice(0,2)
  const paceValue = survey.travelStyles.pace
  const pace = paceValue === null ? '아직 선택 전' : paceValue <= 3 ? '느긋한 편' : paceValue >= 6 ? '알찬 일정' : '균형 잡힌 편'
  const constraints = [survey.hardConstraints.diet && survey.hardConstraints.diet !== '없음' ? survey.hardConstraints.diet : null, ...survey.hardConstraints.beliefs, ...survey.hardConstraints.mobilityNeeds, ...survey.hardConstraints.noGoItems].filter(Boolean) as string[]
  const budgetValue = Number(survey.hardConstraints.budgetLimit.replace(/[^0-9]/g,''))
  const budgetLabel = budgetValue ? `₩${budgetValue.toLocaleString()}` : '아직 입력 전'
  return <Page narrow><div className="moa-persona-head"><span className="moa-kicker">MY AGENT</span><h1>내 편 등장.</h1><p>이 대리인이 여행 회의에서 나 대신 말해줘요.</p></div><div className="moa-persona-card"><div className="moa-persona-side"><div className="moa-agent-avatar"><span>민</span><i><ShieldCheck weight="fill" /></i></div><small>민지의 대리인</small><h2>“맛집은 포기 못하는<br />느긋한 탐험가”</h2><p>{strongest.length ? `${strongest[0].name}을 특히 기대하고, ${pace === '알찬 일정' ? '하루를 알차게 쓰는' : '서두르지 않는'} 여행을 원해요.` : '답변을 바탕으로 여행에서 지킬 우선순위를 정리해요.'}</p><span className="moa-agent-style">협상 스타일 · 조정형</span></div><div className="moa-persona-details"><PersonaBlock icon={Coins} title="예산"><strong>{budgetLabel}</strong><span>{survey.hardConstraints.includesFlight ? '항공 포함' : '항공 제외'} · 상한은 꼭 지켜요</span></PersonaBlock><PersonaBlock icon={Clock} title="여행 스타일"><strong>{pace}</strong><span>{survey.availability.preferredNights ? `${survey.availability.preferredNights}박 선호` : '여행 기간 선택 전'} · {survey.availability.nightFlexibility === 'plus-minus-one' ? '±1박 가능' : '기간 고정'}</span></PersonaBlock><PersonaBlock icon={LockKey} title="이건 진짜 안 돼요"><div className="moa-mini-chips">{constraints.length ? constraints.slice(0,6).map((item) => <i key={item}>{item}</i>) : <i>입력한 조건이 없어요</i>}</div></PersonaBlock><PersonaBlock icon={TrendUp} title="가장 기대돼요"><div className="moa-rank-list">{strongest.length ? strongest.map((item) => <span key={item.id}>{item.name} <b>{item.score}</b></span>) : <span>아직 평가 전</span>}</div></PersonaBlock><PersonaBlock icon={TrendDown} title="별로 안 끌려요"><div className="moa-rank-list low">{lowest.length ? lowest.map((item) => <span key={item.id}>{item.name} <b>{item.score}</b></span>) : <span>아직 평가 전</span>}</div></PersonaBlock><PersonaBlock icon={Gavel} title="꼭 기억할 말"><strong>{survey.mustDo || '꼭 하고 싶은 것 없음'}</strong><span>{survey.avoid ? `피하고 싶은 것 · ${survey.avoid}` : '추가로 피하고 싶은 것은 없어요.'}</span></PersonaBlock></div></div><div className="moa-confirm-gate"><ShieldCheck weight="duotone" /><div><strong>얘, 나 좀 잘 아는 것 같은데?</strong><span>확인하면 이 대리인이 지금 답변으로 나를 대표해요.</span></div></div><div className="moa-persona-actions"><button className="moa-button ghost big" onClick={edit}>답변 수정</button><button className="moa-button big" onClick={confirm}>이대로 나를 대표해요 <Check /></button></div></Page>
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
  const reduceMotion = useReducedMotion()
  const [round,setRound]=useState(2)
  const [scene,setScene]=useState(0)
  const [playing,setPlaying]=useState(!reduceMotion)
  const [speed,setSpeed]=useState<1|2>(1)
  const [direction,setDirection]=useState(1)

  useEffect(() => { if (reduceMotion) setPlaying(false) }, [reduceMotion])
  useEffect(() => {
    if (!playing) return
    const timer = window.setTimeout(() => {
      setDirection(1)
      if (scene === 6) {
        setRound((current) => (current + 1) % meetingRounds.length)
        setScene(0)
      } else setScene((current) => current + 1)
    }, replaySceneDurations[scene] / speed)
    return () => window.clearTimeout(timer)
  }, [playing,scene,speed])

  const changeRound = (nextRound:number) => {
    setRound(nextRound)
    setScene(0)
    setDirection(1)
    setPlaying(!reduceMotion)
  }
  const nextScene = () => {
    setDirection(1)
    if (scene === 6) changeRound((round + 1) % meetingRounds.length)
    else setScene((current) => current + 1)
  }
  const previousScene = () => {
    setDirection(-1)
    setScene((current) => Math.max(0,current - 1))
  }
  const episode = replayEpisodes[round]
  const nextRound = meetingRounds[(round + 1) % meetingRounds.length]
  const transitionDuration = reduceMotion ? .01 : .48

  return <Page><main className="moa-scene-replay">
    <header className="moa-scene-topbar">
      <button className="moa-scene-back" onClick={back} aria-label="우리 여행으로 돌아가기"><ArrowLeft /></button>
      <div><span>MEETING REPLAY</span><strong>{scene === 0 ? '회의를 다시 보는 중' : `${meetingRounds[round].code} · ${meetingRounds[round].name}`}</strong></div>
      <label><span>라운드 선택</span><select value={round} onChange={(event)=>changeRound(Number(event.target.value))}>{meetingRounds.map((item,index)=><option value={index} key={item.code}>{item.code} · {item.name}</option>)}</select></label>
    </header>

    <section className={`moa-scene-stage scene-${scene}`} aria-live="polite" aria-label={`${meetingRounds[round].code} ${meetingRounds[round].name} 재생 장면 ${scene + 1}`}>
      <motion.div className="moa-scene-round-marker" animate={scene===0?{top:'50%',left:'50%',x:'-50%',y:'-58%',scale:1,opacity:1}:{top:18,left:20,x:0,y:0,scale:.56,opacity:.86}} transition={{duration:reduceMotion?.01:.7,ease:[.22,1,.36,1]}}><span>ROUND {round}</span><strong>{meetingRounds[round].name}</strong></motion.div>
      <button className="moa-scene-tap previous" onClick={previousScene} aria-label="이전 장면" />
      <button className="moa-scene-tap next" onClick={nextScene} aria-label="다음 장면" />
      <AnimatePresence mode="wait" custom={direction}>
        <motion.div className="moa-scene-content" key={`${round}-${scene}`} custom={direction} variants={{enter:(value:number)=>({opacity:0,x:value*18}),center:{opacity:1,x:0},exit:(value:number)=>({opacity:0,x:value*-18})}} initial="enter" animate="center" exit="exit" transition={{duration:transitionDuration,ease:'easeOut'}}>
          <ReplayScene scene={scene} episode={episode} nextRound={nextRound} reduceMotion={Boolean(reduceMotion)} speed={speed} />
        </motion.div>
      </AnimatePresence>
    </section>

    <footer className="moa-scene-controls">
      <nav aria-label="장면 선택">{replaySceneDurations.map((_,index)=><button className={scene===index?'active':''} onClick={()=>{setDirection(index>scene?1:-1);setScene(index)}} aria-label={`${index + 1}번 장면`} key={index}><span /></button>)}</nav>
      <div><button onClick={()=>setPlaying((current)=>!current)} aria-label={playing?'일시정지':'재생'}>{playing?<Pause weight="fill"/>:<Play weight="fill"/>}</button><button onClick={()=>setSpeed((current)=>current===1?2:1)} aria-label="재생 속도 변경">{speed}x</button><button onClick={nextScene} aria-label="다음 장면"><ArrowRight /></button></div>
    </footer>
  </main></Page>
}

function RingConversation({ messages, reduceMotion, speed }: { messages:readonly { side:'red'|'blue'; speaker:string; text:string }[]; reduceMotion:boolean; speed:1|2 }) {
  const [visibleCount,setVisibleCount] = useState(reduceMotion ? Math.min(3,messages.length) : 0)

  useEffect(() => {
    if (reduceMotion) {
      setVisibleCount(Math.min(3,messages.length))
      return
    }
    setVisibleCount(0)
    const timers = messages.map((_,index) => window.setTimeout(
      () => setVisibleCount(index + 1),
      (1500 + index * 1700) / speed,
    ))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [messages,reduceMotion,speed])

  const visibleMessages = messages.slice(Math.max(0,visibleCount - 3),visibleCount)
  return <div className="moa-ring-message-stream" aria-live="polite">
    <AnimatePresence initial={false} mode="popLayout">
      {visibleMessages.map((message) => <motion.article
        layout
        className={`moa-ring-message ${message.side}`}
        initial={{opacity:0,x:message.side==='red'?-18:18,y:22}}
        animate={{opacity:1,x:0,y:0}}
        exit={{opacity:0,y:-42,scale:.97}}
        transition={{duration:reduceMotion?.01:.48,ease:[.22,1,.36,1],layout:{duration:.5,ease:[.22,1,.36,1]}}}
        key={message.speaker}
      ><span>{message.speaker}</span><p>{message.text}</p></motion.article>)}
    </AnimatePresence>
  </div>
}

function ReplayScene({ scene, episode, nextRound, reduceMotion, speed }: { scene:number; episode:typeof replayEpisodes[number]; nextRound:typeof meetingRounds[number]; reduceMotion:boolean; speed:1|2 }) {
  const delay = (seconds:number) => reduceMotion ? 0 : seconds / speed
  if (scene === 0) return <div className="moa-scene-intro" aria-hidden="true"><motion.img className="moa-intro-gloves" src={glovesImage} alt="" initial={{opacity:0,scale:1.08}} animate={{opacity:.32,scale:1}} transition={{duration:1.05,ease:[.22,1,.36,1]}} /><motion.i className="red" initial={{scaleX:0}} animate={{scaleX:1}} transition={{duration:.65,delay:delay(.22),ease:'easeOut'}} /><motion.i className="blue" initial={{scaleX:0}} animate={{scaleX:1}} transition={{duration:.65,delay:delay(.22),ease:'easeOut'}} /></div>
  if (scene === 1) return <div className="moa-scene-arguments"><motion.article className="red" initial={{opacity:0,x:-28,scale:.96}} animate={{opacity:1,x:0,scale:1}} transition={{duration:.48,ease:'easeOut'}}><span>RED POSITION</span><strong>{episode.redCorner}</strong></motion.article><motion.article className="blue" initial={{opacity:0,x:28,scale:.96}} animate={{opacity:1,x:0,scale:1}} transition={{duration:.48,delay:delay(.48),ease:'easeOut'}}><span>BLUE POSITION</span><strong>{episode.blueCorner}</strong></motion.article><motion.div className="moa-scene-split" initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{duration:.42,delay:delay(1.05)}}><span>의견이 갈렸어요</span><strong>{episode.score}</strong></motion.div></div>
  if (scene === 2) return <div className="moa-scene-ring"><motion.div className="moa-ring-corner red" initial={{opacity:0,x:-15}} animate={{opacity:1,x:0}}><span>RED CORNER</span><strong>{episode.redCorner}</strong></motion.div><motion.div className="moa-ring-corner blue" initial={{opacity:0,x:15}} animate={{opacity:1,x:0}}><span>BLUE CORNER</span><strong>{episode.blueCorner}</strong></motion.div>{[0,1,2].map((line)=><motion.i className={`moa-ring-rope rope-${line}`} initial={{scaleX:0}} animate={{scaleX:1}} transition={{duration:.52,delay:delay(line*.12)}} key={line} />)}<motion.div className="moa-scene-fighter red" initial={{opacity:0,x:-42}} animate={{opacity:1,x:0}} transition={{duration:.58,delay:delay(.28),ease:'easeOut'}}><img src="/assets/landing/agent-red.png" alt="빨간 여행 대리인" /></motion.div><motion.div className="moa-scene-fighter blue" initial={{opacity:0,x:42}} animate={{opacity:1,x:0}} transition={{duration:.58,delay:delay(.48),ease:'easeOut'}}><img src="/assets/landing/agent-blue.png" alt="파란 여행 대리인" /></motion.div><motion.div className="moa-scene-fighter referee" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{duration:.5,delay:delay(.82)}}><img src="/assets/landing/referee.png" alt="팩트체크 심판" /></motion.div><motion.div className="moa-ring-versus" initial={{opacity:0,scale:.9}} animate={{opacity:1,scale:1}} transition={{duration:.38,delay:delay(1.05)}}><b>VS</b><strong>{episode.score}</strong></motion.div><RingConversation messages={episode.conversation} reduceMotion={reduceMotion} speed={speed} /></div>
  if (scene === 3) return <div className="moa-scene-referee"><motion.img className="referee" src="/assets/landing/referee.png" alt="팩트체크 심판" initial={{opacity:.25,scale:.82,y:12}} animate={{opacity:[.25,1,.16],scale:[.82,1.02,.88],y:[12,0,-7]}} transition={{duration:1.15,times:[0,.55,1],ease:'easeOut'}} /><motion.div className="moa-referee-call" initial={{opacity:0,y:8}} animate={{opacity:[0,1,1,0],y:[8,0,0,-6]}} transition={{duration:1.15,times:[0,.18,.72,1]}}><strong>잠깐.</strong><span>팩트 체크 들어갑니다.</span></motion.div><motion.section className="moa-scene-fact" initial={{opacity:0,y:18}} animate={{opacity:1,y:0}} transition={{duration:.52,delay:delay(.95),ease:'easeOut'}}><header><Gavel weight="fill" /><span>심판 팩트체크</span></header><h2>{episode.factTitle}</h2><ul>{episode.facts.map((fact,index)=><motion.li initial={{opacity:0,x:-8}} animate={{opacity:1,x:0}} transition={{duration:.36,delay:delay(1.2+index*.24)}} key={fact}><Check />{fact}</motion.li>)}</ul></motion.section></div>
  if (scene === 4) return <div className="moa-scene-negotiation"><span className="moa-scene-section-label">조건을 다시 맞추는 중</span><motion.article className="red" initial={{opacity:0,x:-24}} animate={{opacity:1,x:0}} transition={{duration:.48,ease:'easeOut'}}><header><i>민</i><strong>민지의 대리인</strong></header><p>{episode.compromise[0]}</p></motion.article><motion.article className="blue" initial={{opacity:0,x:24}} animate={{opacity:1,x:0}} transition={{duration:.45,delay:delay(.68),ease:'easeOut'}}><header><i>서</i><strong>서연의 대리인</strong></header><p>{episode.compromise[1]}</p></motion.article></div>
  if (scene === 5) return <motion.div className="moa-scene-agreement" initial={{opacity:0,y:14,scale:.98}} animate={{opacity:1,y:0,scale:1}} transition={{duration:.62,ease:'easeOut'}}><CheckCircle weight="fill" /><span>합의 완료</span><h2>{episode.resultTitle}</h2><p>{episode.resultCopy}</p><small>{episode.concession}</small></motion.div>
  return <div className="moa-scene-next-round"><motion.span initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}>NEXT ROUND</motion.span><motion.h2 initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay:delay(.18)}}>{nextRound.code} · {nextRound.name}</motion.h2><motion.i initial={{scaleX:0}} animate={{scaleX:1}} transition={{duration:.7,delay:delay(.35),ease:'easeOut'}} /></div>
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
