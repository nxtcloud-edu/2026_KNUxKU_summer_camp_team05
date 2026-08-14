import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, CheckCircle, Gavel, Pause, Play } from '@phosphor-icons/react'
import type { MeetingReplayData, ReplayMessage, ReplayRound } from '../features/replay/types'
import { Page } from './ui'
import glovesImage from '../../assets/gloves.png'

const replayScenes = {
  intro: 0,
  positions: 1,
  discussion: 2,
  factCheck: 3,
  compromise: 4,
  agreement: 5,
  nextRound: 6,
} as const

const replaySceneDurations = [2400, 4200, 11000, 7200, 5600, 5600, 2800] as const
const lastScene = replayScenes.nextRound

type PlaybackSpeed = 1 | 2

function RingConversation({ messages, reduceMotion, speed }: { messages: readonly ReplayMessage[]; reduceMotion: boolean; speed: PlaybackSpeed }) {
  const [visibleCount, setVisibleCount] = useState(reduceMotion ? Math.min(3, messages.length) : 0)

  useEffect(() => {
    if (reduceMotion) { setVisibleCount(Math.min(3, messages.length)); return }
    setVisibleCount(0)
    const timers = messages.map((_, index) => window.setTimeout(
      () => setVisibleCount(index + 1),
      (1500 + index * 1700) / speed,
    ))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [messages, reduceMotion, speed])

  const visibleMessages = messages.slice(Math.max(0, visibleCount - 3), visibleCount)

  return (
    <div className="moa-ring-message-stream" aria-live="polite">
      <AnimatePresence initial={false} mode="popLayout">
        {visibleMessages.map((message) => (
          <motion.article
            layout
            className={`moa-ring-message ${message.side}`}
            initial={{ opacity: 0, x: message.side === 'red' ? -18 : 18, y: 22 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, y: -42, scale: .97 }}
            transition={{ duration: reduceMotion ? .01 : .48, ease: [.22, 1, .36, 1], layout: { duration: .5, ease: [.22, 1, .36, 1] } }}
            key={message.id}
          >
            <span>{message.speakerLabel}</span>
            <p>{message.text}</p>
          </motion.article>
        ))}
      </AnimatePresence>
    </div>
  )
}

function ReplayScene({ scene, round, nextRound, reduceMotion, speed }: { scene: number; round: ReplayRound; nextRound: ReplayRound; reduceMotion: boolean; speed: PlaybackSpeed }) {
  const delay = (seconds: number) => reduceMotion ? 0 : seconds / speed

  if (scene === replayScenes.intro) return (
    <div className="moa-scene-intro" aria-hidden="true">
      <motion.img className="moa-intro-gloves" src={glovesImage} alt="" initial={{ opacity: 0, scale: 1.08 }} animate={{ opacity: .32, scale: 1 }} transition={{ duration: 1.05, ease: [.22, 1, .36, 1] }} />
      <motion.i className="red" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: .65, delay: delay(.22), ease: 'easeOut' }} />
      <motion.i className="blue" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: .65, delay: delay(.22), ease: 'easeOut' }} />
    </div>
  )

  if (scene === replayScenes.positions) return (
    <div className="moa-scene-arguments">
      <motion.article className="red" initial={{ opacity: 0, x: -28, scale: .96 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ duration: .48, ease: 'easeOut' }}><span>RED POSITION</span><strong>{round.positions.red.label}</strong></motion.article>
      <motion.article className="blue" initial={{ opacity: 0, x: 28, scale: .96 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ duration: .48, delay: delay(.48), ease: 'easeOut' }}><span>BLUE POSITION</span><strong>{round.positions.blue.label}</strong></motion.article>
      <motion.div className="moa-scene-split" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .42, delay: delay(1.05) }}><span>의견이 갈렸어요</span><strong>{round.splitSummary}</strong></motion.div>
    </div>
  )

  if (scene === replayScenes.discussion) return (
    <div className="moa-scene-ring">
      <motion.div className="moa-ring-corner red" initial={{ opacity: 0, x: -15 }} animate={{ opacity: 1, x: 0 }}><span>RED CORNER</span><strong>{round.positions.red.label}</strong></motion.div>
      <motion.div className="moa-ring-corner blue" initial={{ opacity: 0, x: 15 }} animate={{ opacity: 1, x: 0 }}><span>BLUE CORNER</span><strong>{round.positions.blue.label}</strong></motion.div>
      {[0, 1, 2].map((line) => <motion.i className={`moa-ring-rope rope-${line}`} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: .52, delay: delay(line * .12) }} key={line} />)}
      <motion.div className="moa-scene-fighter red" initial={{ opacity: 0, x: -42 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .58, delay: delay(.28), ease: 'easeOut' }}><img src="/assets/landing/agent-red.png" alt="빨간 여행 대리인" /></motion.div>
      <motion.div className="moa-scene-fighter blue" initial={{ opacity: 0, x: 42 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .58, delay: delay(.48), ease: 'easeOut' }}><img src="/assets/landing/agent-blue.png" alt="파란 여행 대리인" /></motion.div>
      <motion.div className="moa-scene-fighter referee" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .5, delay: delay(.82) }}><img src="/assets/landing/referee.png" alt="팩트체크 심판" /></motion.div>
      <motion.div className="moa-ring-versus" initial={{ opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: .38, delay: delay(1.05) }}><b>VS</b><strong>{round.splitSummary}</strong></motion.div>
      <RingConversation messages={round.messages} reduceMotion={reduceMotion} speed={speed} />
    </div>
  )

  if (scene === replayScenes.factCheck) return (
    <div className="moa-scene-referee">
      <motion.img className="referee" src="/assets/landing/referee.png" alt="팩트체크 심판" initial={{ opacity: .25, scale: .82, y: 12 }} animate={{ opacity: [.25, 1, .16], scale: [.82, 1.02, .88], y: [12, 0, -7] }} transition={{ duration: 1.15, times: [0, .55, 1], ease: 'easeOut' }} />
      <motion.div className="moa-referee-call" initial={{ opacity: 0, y: 8 }} animate={{ opacity: [0, 1, 1, 0], y: [8, 0, 0, -6] }} transition={{ duration: 1.15, times: [0, .18, .72, 1] }}><strong>잠깐.</strong><span>팩트 체크 들어갑니다.</span></motion.div>
      <motion.section className="moa-scene-fact" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .52, delay: delay(.95), ease: 'easeOut' }}>
        <header><Gavel weight="fill" /><span>심판 팩트체크</span></header>
        <h2>{round.factCheck.title}</h2>
        <ul>{round.factCheck.facts.map((fact, index) => <motion.li initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .36, delay: delay(1.2 + index * .24) }} key={fact.id}><Check />{fact.label}</motion.li>)}</ul>
      </motion.section>
    </div>
  )

  if (scene === replayScenes.compromise) return (
    <div className="moa-scene-negotiation">
      <span className="moa-scene-section-label">조건을 다시 맞추는 중</span>
      {round.compromises.map((message, index) => (
        <motion.article className={message.side} initial={{ opacity: 0, x: message.side === 'red' ? -24 : 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .48, delay: delay(index * .68), ease: 'easeOut' }} key={message.id}>
          <header><i>{message.speakerInitial}</i><strong>{message.speakerLabel}</strong></header><p>{message.text}</p>
        </motion.article>
      ))}
    </div>
  )

  if (scene === replayScenes.agreement) return (
    <motion.div className="moa-scene-agreement" initial={{ opacity: 0, y: 14, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .62, ease: 'easeOut' }}>
      <CheckCircle weight="fill" />
      <span>합의 완료</span>
      <h2>{round.result.title}</h2>
      <p>{round.result.explanation}</p>
      {round.result.concession && <small>{round.result.concession}</small>}
    </motion.div>
  )

  return (
    <div className="moa-scene-next-round">
      <motion.span initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>NEXT ROUND</motion.span>
      <motion.h2 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: delay(.18) }}>{nextRound.code} · {nextRound.categoryLabel}</motion.h2>
      <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: .7, delay: delay(.35), ease: 'easeOut' }} />
    </div>
  )
}

type MeetingReplayProps = {
  data: MeetingReplayData
  initialRoundId?: string
  back: () => void
  roundChanged?: (roundId: string) => void
}

export function MeetingReplay({ data, initialRoundId, back, roundChanged }: MeetingReplayProps) {
  const reduceMotion = useReducedMotion()
  const requestedRoundIndex = initialRoundId ? data.rounds.findIndex((item) => item.id === initialRoundId) : -1
  const [roundIndex, setRoundIndex] = useState(requestedRoundIndex >= 0 ? requestedRoundIndex : 0)
  const [scene, setScene] = useState<number>(replayScenes.intro)
  const [playing, setPlaying] = useState(!reduceMotion)
  const [speed, setSpeed] = useState<PlaybackSpeed>(1)
  const [direction, setDirection] = useState(1)

  useEffect(() => { if (reduceMotion) setPlaying(false) }, [reduceMotion])
  useEffect(() => {
    if (!playing) return
    const timer = window.setTimeout(() => {
      setDirection(1)
      if (scene === lastScene) {
        setRoundIndex((current) => {
          const next = (current + 1) % data.rounds.length
          roundChanged?.(data.rounds[next].id)
          return next
        })
        setScene(replayScenes.intro)
      } else setScene((current) => current + 1)
    }, replaySceneDurations[scene] / speed)
    return () => window.clearTimeout(timer)
  }, [data.rounds, playing, roundChanged, scene, speed])

  const changeRound = (nextRoundIndex: number) => {
    setRoundIndex(nextRoundIndex)
    roundChanged?.(data.rounds[nextRoundIndex].id)
    setScene(replayScenes.intro)
    setDirection(1)
    setPlaying(!reduceMotion)
  }
  const nextScene = () => {
    setDirection(1)
    if (scene === lastScene) changeRound((roundIndex + 1) % data.rounds.length)
    else setScene((current) => current + 1)
  }
  const previousScene = () => {
    setDirection(-1)
    setScene((current) => Math.max(replayScenes.intro, current - 1))
  }

  const round = data.rounds[roundIndex]
  const nextRound = data.rounds[(roundIndex + 1) % data.rounds.length]
  const transitionDuration = reduceMotion ? .01 : .48

  return (
    <Page>
      <main className="moa-scene-replay">
        <header className="moa-scene-topbar">
          <button className="moa-scene-back" onClick={back} aria-label="우리 여행으로 돌아가기"><ArrowLeft /></button>
          <div><span>MEETING REPLAY</span><strong>{scene === replayScenes.intro ? '회의를 다시 보는 중' : `${round.code} · ${round.categoryLabel}`}</strong></div>
          <label>
            <span>라운드 선택</span>
            <select value={round.id} onChange={(event) => changeRound(data.rounds.findIndex((item) => item.id === event.target.value))}>
              {data.rounds.map((item) => <option value={item.id} key={item.id}>{item.code} · {item.categoryLabel}</option>)}
            </select>
          </label>
        </header>

        <section className={`moa-scene-stage scene-${scene}`} aria-live="polite" aria-label={`${round.code} ${round.categoryLabel} 재생 장면 ${scene + 1}`}>
          <motion.div className="moa-scene-round-marker" animate={scene === replayScenes.intro ? { top: '50%', left: '50%', x: '-50%', y: '-58%', scale: 1, opacity: 1 } : { top: 18, left: 20, x: 0, y: 0, scale: .56, opacity: .86 }} transition={{ duration: reduceMotion ? .01 : .7, ease: [.22, 1, .36, 1] }}>
            <span>{round.code}</span>
            <strong>{round.categoryLabel}</strong>
          </motion.div>
          <button className="moa-scene-tap previous" onClick={previousScene} aria-label="이전 장면" />
          <button className="moa-scene-tap next" onClick={nextScene} aria-label="다음 장면" />
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div className="moa-scene-content" key={`${round.id}-${scene}`} custom={direction} variants={{ enter: (value: number) => ({ opacity: 0, x: value * 18 }), center: { opacity: 1, x: 0 }, exit: (value: number) => ({ opacity: 0, x: value * -18 }) }} initial="enter" animate="center" exit="exit" transition={{ duration: transitionDuration, ease: 'easeOut' }}>
              <ReplayScene scene={scene} round={round} nextRound={nextRound} reduceMotion={Boolean(reduceMotion)} speed={speed} />
            </motion.div>
          </AnimatePresence>
        </section>

        <footer className="moa-scene-controls">
          <nav aria-label="장면 선택">
            {replaySceneDurations.map((_, index) => (
              <button className={scene === index ? 'active' : ''} onClick={() => { setDirection(index > scene ? 1 : -1); setScene(index) }} aria-label={`${index + 1}번 장면`} key={index}><span /></button>
            ))}
          </nav>
          <div>
            <button onClick={() => setPlaying((current) => !current)} aria-label={playing ? '일시정지' : '재생'}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button>
            <button onClick={() => setSpeed((current) => current === 1 ? 2 : 1)} aria-label="재생 속도 변경">{speed}x</button>
            <button onClick={nextScene} aria-label="다음 장면"><ArrowRight /></button>
          </div>
        </footer>
      </main>
    </Page>
  )
}
