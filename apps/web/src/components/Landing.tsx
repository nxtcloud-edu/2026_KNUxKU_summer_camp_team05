import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, CheckCircle, DeviceMobile, Gavel, Play } from '@phosphor-icons/react'
import { Logo } from './ui'
import airplaneImage from '../../assets/04_airplane.png'
import suitcaseImage from '../../assets/05_suitcase.png'
import airplaneWindowImage from '../../assets/06_airplane_window.png'
import passportTicketImage from '../../assets/07_passport_ticket.png'

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

  const reveal = (at: number) => reduceMotion || phase >= at
  const resetting = !reduceMotion && phase === 7
  const redBubbleVisible = reveal(2) && !resetting && (!compact || phase < 3)
  const blueBubbleVisible = reveal(3) && !resetting && (!compact || phase < 5)
  const settled = reveal(5)

  return (
    <div className="moa-fight-stage" aria-hidden="true">
      <img className="moa-fight-airplane" src={airplaneImage} alt="" aria-hidden="true" />
      <img className="moa-fight-suitcase" src={suitcaseImage} alt="" aria-hidden="true" />
      <img className="moa-fight-passport" src={passportTicketImage} alt="" aria-hidden="true" />
      <motion.aside className="moa-pop-bubble red" initial={false} animate={{ opacity: redBubbleVisible ? 1 : 0, x: redBubbleVisible ? (settled ? 12 : 0) : 36, y: redBubbleVisible ? (settled ? 7 : 0) : 15, scale: redBubbleVisible ? 1 : .95 }} transition={{ duration: .48, ease: [.22, 1, .36, 1] }}>
        <span>민지의 대리인</span><strong>맛집에 더 쓰고 싶어요.</strong>
      </motion.aside>
      <motion.aside className="moa-pop-bubble blue" initial={false} animate={{ opacity: blueBubbleVisible ? 1 : 0, x: blueBubbleVisible ? (settled ? -12 : 0) : -36, y: blueBubbleVisible ? (settled ? 7 : 0) : 15, scale: blueBubbleVisible ? 1 : .95 }} transition={{ duration: .48, ease: [.22, 1, .36, 1] }}>
        <span>서연의 대리인</span><strong>이동시간은 줄이고 싶어요.</strong>
      </motion.aside>
      <motion.div className="moa-fight-phone" initial={reduceMotion ? false : { opacity: 0, y: 40, rotate: 3, scale: .96 }} animate={{ opacity: 1, y: 0, rotate: 2.25, scale: 1 }} transition={{ duration: .82, delay: .5, ease: [.22, 1, .36, 1] }}>
        <div className="moa-fight-bezel">
          <span className="moa-fight-island" />
          <div className="moa-fight-screen">
            <motion.div className="moa-fight-content" initial={false} animate={{ opacity: resetting ? 0 : 1 }} transition={{ duration: .48 }}>
              <header className="moa-fight-header">
                <motion.span initial={false} animate={{ opacity: reveal(1) && !resetting ? 1 : 0, y: reveal(1) && !resetting ? 0 : -8 }} transition={{ duration: .45 }}>ROUND 2 · 숙소</motion.span>
                <strong>대리인 회의</strong>
              </header>
              <section className="moa-fight-scoreboard">
                <div className="red"><small>맛집·경험</small><strong>민지의 대리인</strong></div>
                <motion.b initial={false} animate={{ opacity: reveal(4) && !resetting ? (reveal(6) ? .42 : 1) : 0, scale: reveal(4) && !resetting ? 1 : .9 }} transition={{ duration: .38 }}>VS</motion.b>
                <div className="blue"><small>위치·이동</small><strong>서연의 대리인</strong></div>
              </section>
              <motion.div className="moa-fight-vote" initial={false} animate={{ opacity: reveal(4) && !resetting ? (reveal(6) ? .48 : 1) : 0, y: reveal(4) && !resetting ? 0 : 6 }}>
                <motion.span initial={false} animate={{ opacity: reveal(4) ? 1 : 0, y: reveal(4) ? 0 : 4 }} transition={{ duration: .28 }}>2</motion.span>
                <motion.i initial={false} animate={{ opacity: reveal(4) ? 1 : 0 }} transition={{ duration: .25, delay: .1 }}>:</motion.i>
                <motion.span initial={false} animate={{ opacity: reveal(4) ? 1 : 0, y: reveal(4) ? 0 : 4 }} transition={{ duration: .28, delay: .2 }}>3</motion.span>
              </motion.div>
              <section className="moa-fight-ring">
                <i className="rope rope-one" /><i className="rope rope-two" /><i className="rope rope-three" />
                <motion.div className="moa-fighter red" initial={false} animate={{ opacity: reveal(1) && !resetting ? 1 : 0, x: reveal(1) && !resetting ? (reveal(2) && !settled ? 3 : 0) : -18, y: reveal(1) && !resetting ? (reduceMotion ? 0 : [0, -2, 0]) : 4, rotate: reveal(2) && !settled ? 1.5 : 0 }} transition={{ opacity: { duration: .48 }, x: { duration: .5, ease: 'easeOut' }, rotate: { duration: .45 }, y: { duration: 2.8, repeat: reduceMotion ? 0 : Infinity, ease: 'easeInOut' } }}>
                  <img src="/assets/landing/agent-red.png" alt="빨간 여행 대리인" />
                </motion.div>
                <motion.div className="moa-fighter referee" initial={false} animate={{ opacity: reveal(4) && !resetting ? 1 : 0, y: reveal(5) ? (reduceMotion ? -2 : [-2, -5, -2]) : 3, scale: reduceMotion ? 1 : reveal(5) ? 1.04 : 1 }} transition={{ opacity: { duration: .48 }, scale: { duration: .5, ease: 'easeOut' }, y: { duration: 2.8, repeat: reduceMotion ? 0 : Infinity, ease: 'easeInOut' } }}>
                  <img src="/assets/landing/referee.png" alt="팩트체크 심판" />
                </motion.div>
                <motion.div className="moa-fighter blue" initial={false} animate={{ opacity: reveal(3) && !resetting ? 1 : 0, x: reveal(3) && !resetting ? (!settled ? -3 : 0) : 18, y: reveal(3) && !resetting ? (reduceMotion ? 0 : [0, -2, 0]) : 4, rotate: reveal(3) && !settled ? -1.5 : 0 }} transition={{ opacity: { duration: .48 }, x: { duration: .5, ease: 'easeOut' }, rotate: { duration: .45 }, y: { duration: 3.1, repeat: reduceMotion ? 0 : Infinity, ease: 'easeInOut' } }}>
                  <img src="/assets/landing/agent-blue.png" alt="파란 여행 대리인" />
                </motion.div>
              </section>
              <motion.section className="moa-fight-fact" initial={false} animate={{ opacity: reveal(5) && !resetting ? 1 : 0, y: reveal(5) && !resetting ? 0 : 16 }} transition={{ duration: .48, ease: 'easeOut' }}>
                <header><Gavel weight="fill" /><strong>심판 팩트체크</strong></header>
                <div><b>숙소 A</b><span>+28,000원 / 인</span><span>이동시간 -64분</span></div>
              </motion.section>
              <motion.section className="moa-fight-result" initial={false} animate={{ opacity: reveal(6) && !resetting ? 1 : 0, y: reveal(6) && !resetting ? 0 : 14, scale: reveal(6) && !resetting ? 1 : .98 }} transition={{ duration: .52, ease: 'easeOut' }}>
                <CheckCircle weight="fill" />
                <div><small>합의 완료</small><strong>숙소 A 선택</strong><span>식사 예산은 유지하기로 했어요.</span></div>
              </motion.section>
              <motion.div className="moa-fight-rounds" initial={false} animate={{ opacity: reveal(4) && !resetting ? 1 : 0, y: reveal(4) && !resetting ? 0 : 5 }} transition={{ duration: .42 }}>
                {['R0', 'R1', 'R2', 'R3'].map((round) => <span key={round} className={round === 'R2' && reveal(4) ? 'active' : ''}>{round}</span>)}
              </motion.div>
            </motion.div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

export function Landing({
  create,
  join,
  intro,
  how,
  login,
  phoneDemo,
  signedIn,
  userInitial,
}: {
  create: () => void
  join: () => void
  intro: () => void
  how: () => void
  login: () => void
  phoneDemo: () => void
  signedIn: boolean
  userInitial: string
}) {
  const scrollToExample = () => document.getElementById('landing-example')?.scrollIntoView({ behavior: 'smooth' })
  const steps = [
    { title: '취향 남기기', copy: '각자 원하는 여행을 알려주세요.' },
    { title: '대리인 회의', copy: '서로 다른 조건을 대신 조율해요.' },
    { title: '여행 확정', copy: '모두가 납득할 결과만 남겨요.' },
  ]

  return (
    <section className="moa-landing-v2">
      <nav className="moa-landing-nav">
        <Logo />
        <div>
          <button onClick={intro}>서비스 소개</button>
          <button onClick={how}>이용 방법</button>
          <button onClick={scrollToExample}>여행 예시</button>
        </div>
        <aside>
          <button className={signedIn ? 'moa-landing-avatar' : 'login'} onClick={login} aria-label={signedIn ? '프로필 열기' : '로그인'}>
            {signedIn ? userInitial : '로그인'}
          </button>
          <button className="start" onClick={create}>여행 시작하기 <ArrowRight /></button>
        </aside>
      </nav>
      <div className="moa-landing-hero">
        <motion.div className="moa-landing-copy" initial={false} animate={{ opacity: 1 }}>
          <motion.span initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .45 }}>✈ 여행 취향 조율 서비스</motion.span>
          <h1>
            <motion.span initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .62, delay: .08, ease: 'easeOut' }}>여행 가서 싸우지 마.</motion.span>
            <motion.em initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .66, delay: .24, ease: 'easeOut' }}>대신 싸워드림.</motion.em>
          </h1>
          <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .55, delay: .38 }}>
            각자 원하는 건 달라도 괜찮아요.<br />취향만 남기면 대리인들이 대신 붙고, 합의까지 해드려요.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .5, delay: .55 }}>
            <button className="primary" onClick={create}>여행 방 만들기 <ArrowRight /></button>
            <button className="secondary" onClick={how}>어떻게 싸우나요? <Play weight="fill" /></button>
          </motion.div>
        </motion.div>
        <div className="moa-landing-phone-demo">
          <LandingMeetingDemo />
          <button type="button" className="moa-landing-phone-demo-trigger" onClick={phoneDemo} aria-label="폰 데모 열기">
            <span><DeviceMobile aria-hidden="true" />폰 데모 열기</span>
          </button>
        </div>
      </div>
      <section className="moa-landing-steps" aria-label="모아 이용 과정">
        {steps.map((step, index) => (
          <article key={step.title}>
            <span>0{index + 1}</span>
            <div><strong>{step.title}</strong><p>{step.copy}</p></div>
            {index < steps.length - 1 && <ArrowRight />}
          </article>
        ))}
      </section>
      <section className="moa-landing-editorial" id="landing-example">
        <div>
          <span>ONE TRIP, ONE DECISION</span>
          <h2>여섯 명이 가도,<br />결정은 하나면 되니까.</h2>
          <p>누가 이겼는지만 보여주지 않아요.<br />어떤 조건을 비교했고, 어디서 양보했는지까지 남겨요.</p>
          <button onClick={join}>여행 예시 열기 <ArrowRight /></button>
        </div>
        <div className="moa-editorial-demo">
          <img src={airplaneWindowImage} alt="비행기 창밖으로 보이는 여행 풍경" />
          <section>
            <header><span>MEETING REPLAY · R2</span><strong>숙소는 왜 A가 됐을까?</strong></header>
            <blockquote>"7분이면 괜찮아요.<br />대신 식사 예산은 지켜주세요."</blockquote>
            <div><span>심판 확인</span><b>18만원 절약 vs 이동시간 단축</b></div>
            <footer><CheckCircle weight="fill" /> 숙소 A로 합의했어요.</footer>
          </section>
        </div>
      </section>
    </section>
  )
}
