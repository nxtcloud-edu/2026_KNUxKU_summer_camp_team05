import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ArrowLeft, CaretDown, Check, CheckCircle, X } from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { DestinationPack } from '../../product/types'
import { cityIdForDestination, surveyRepository } from './api/surveyRepository'
import { getAnswerLabels } from './answerPresentation'
import { QuestionRenderer } from './components/QuestionRenderer'
import { useSurvey } from './hooks/useSurvey'
import type { CityId, SurveyAnswerV4, SurveyPlanV4, SurveyQuestion } from './types/survey'

function ChapterProgress({ plan, question }: { plan: SurveyPlanV4; question: SurveyQuestion }) {
  const sections = [...plan.sections].sort((first, second) => first.displayOrder - second.displayOrder)
  const activeIndex = sections.findIndex(({ id }) => id === question.sectionId)
  return <nav className="moa-builder-progress" aria-label="내 여행 만들기 진행 단계">{sections.map((section, index) => <div key={section.id} className={index < activeIndex ? 'done' : index === activeIndex ? 'active' : ''} aria-current={index === activeIndex ? 'step' : undefined}><i>{index < activeIndex ? <Check weight="bold"/> : String(index + 1).padStart(2, '0')}</i><span>{section.shortLabel}</span></div>)}</nav>
}

function answeredRows(plan: SurveyPlanV4, answers: Record<string, SurveyAnswerV4>) {
  return [...plan.questions]
    .sort((first, second) => first.displayOrder - second.displayOrder)
    .flatMap((question) => getAnswerLabels(question, answers[question.id]?.value).map((label) => ({ id: `${question.id}-${label}`, label })))
}

function LiveProfile({ plan, answers, destination, mobile = false, close }: { plan: SurveyPlanV4; answers: Record<string, SurveyAnswerV4>; destination: DestinationPack; mobile?: boolean; close?: () => void }) {
  const rows = answeredRows(plan, answers)
  return <aside className={`moa-live-profile${mobile ? ' mobile' : ''}`} aria-label="현재 내 여행 답변">
    {mobile&&<button type="button" className="moa-live-profile-close" onClick={close} aria-label="여행 답변 닫기"><X/></button>}
    <div className="moa-live-destination"><span>{destination.name.toUpperCase()}</span><strong>{plan.title}</strong></div>
    <div className="moa-live-profile-heading"><h2>내가 고른 답변</h2><span>{Object.keys(answers).length}개 저장</span></div>
    <ul><AnimatePresence initial={false}>{rows.slice(-8).map((row) => <motion.li key={row.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><CheckCircle weight="fill"/>{row.label}</motion.li>)}</AnimatePresence>{rows.length === 0&&<li className="empty">답할수록 선택한 내용이 여기에 쌓여요.</li>}</ul>
  </aside>
}

function SurveyError({ message, back }: { message: string; back: () => void }) {
  return <section className="moa-survey-status" role="alert"><strong>설문을 열 수 없어요.</strong><p>{message}</p><button type="button" onClick={back}><ArrowLeft/>여행 방으로 돌아가기</button></section>
}

function SurveyExperience({ destination, cityId, backToRoom, complete }: { destination: DestinationPack; cityId: CityId; backToRoom: () => void; complete: () => void }) {
  const reduceMotion = useReducedMotion()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const advanceTimer = useRef<number | undefined>(undefined)
  const [mobileProfile, setMobileProfile] = useState(false)
  const [feedback, setFeedback] = useState('')
  const survey = useSurvey({ destinationId: cityId, repository: surveyRepository })

  useEffect(() => () => { if (advanceTimer.current) window.clearTimeout(advanceTimer.current) }, [])
  useEffect(() => {
    if (survey.currentQuestion?.uiType !== 'intro') headingRef.current?.focus({ preventScroll: true })
    setFeedback('')
  }, [survey.currentQuestionId, survey.currentQuestion?.uiType])

  const autoAnswer = (value: Parameters<typeof survey.answer>[0], message: string) => {
    if (advanceTimer.current) window.clearTimeout(advanceTimer.current)
    survey.answer(value)
    setFeedback(message)
    advanceTimer.current = window.setTimeout(() => { void survey.next() }, reduceMotion ? 80 : 360)
  }

  const submit = async (value: Parameters<typeof survey.submit>[0]) => {
    const result = await survey.submit(value)
    if (result) complete()
  }

  if (survey.loading) return <section className="moa-survey-status" role="status"><strong>여행 질문을 준비하고 있어요.</strong></section>
  if (survey.error && !survey.plan) return <SurveyError message={survey.error} back={backToRoom}/>
  if (!survey.plan || !survey.currentQuestion) return <SurveyError message="이 목적지에 사용할 수 있는 설문이 없어요." back={backToRoom}/>

  const renderer = <QuestionRenderer
    question={survey.currentQuestion}
    answer={survey.currentAnswer}
    plan={survey.plan}
    answers={survey.answers}
    destinationName={destination.name}
    destinationImage={destination.image}
    headingRef={headingRef as RefObject<HTMLHeadingElement | null>}
    submitting={survey.submitting}
    onAnswer={survey.answer}
    onAutoAnswer={autoAnswer}
    onBack={() => { void survey.back() }}
    onNext={() => { void survey.next() }}
    onSkip={() => { void survey.skip() }}
    onExit={backToRoom}
    onSubmit={(value) => { void submit(value) }}
  />

  if (survey.currentQuestion.uiType === 'intro') return renderer

  return <div className="moa-trip-builder"><div className="moa-builder-mobile-bar"><button type="button" aria-expanded={mobileProfile} onClick={() => setMobileProfile(true)}><span>내 여행 답변</span><strong>{Object.keys(survey.answers).length}개 저장</strong><CaretDown/></button></div><div className="moa-builder-shell"><main><ChapterProgress plan={survey.plan} question={survey.currentQuestion}/><AnimatePresence mode="wait" initial={false}><motion.div key={survey.currentQuestion.id} className="moa-builder-question" initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }} transition={{ duration: reduceMotion ? 0 : .26 }}>{renderer}{survey.error&&<p className="moa-builder-error" role="alert">{survey.error}</p>}</motion.div></AnimatePresence><div className="moa-builder-feedback" role="status" aria-live="polite">{feedback}</div></main><LiveProfile plan={survey.plan} answers={survey.answers} destination={destination}/></div><AnimatePresence>{mobileProfile&&<motion.div className="moa-live-profile-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setMobileProfile(false) }}><motion.div initial={reduceMotion ? { opacity: 1 } : { y: '100%' }} animate={{ y: 0 }} exit={reduceMotion ? { opacity: 0 } : { y: '100%' }}><LiveProfile mobile plan={survey.plan} answers={survey.answers} destination={destination} close={() => setMobileProfile(false)}/></motion.div></motion.div>}</AnimatePresence></div>
}

export function TripBuilderSurvey({ destination, backToRoom, complete }: { destination: DestinationPack; backToRoom: () => void; complete: () => void }) {
  const cityId = useMemo(() => cityIdForDestination(destination.id), [destination.id])
  return <SurveyExperience key={cityId} destination={destination} cityId={cityId} backToRoom={backToRoom} complete={complete}/>
}
