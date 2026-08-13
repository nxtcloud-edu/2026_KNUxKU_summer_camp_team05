import { ArrowRight, Check, Gavel, ShieldCheck, Warning, X } from '@phosphor-icons/react'
import { motion } from 'framer-motion'
import { decisionRounds, type DecisionRound } from '../data'

export type DecisionRoundId = DecisionRound['id']

export function DecisionTab({ open }: { open:(id:DecisionRoundId)=>void }) {
  return <div className="moa-result-content moa-decisions-tab"><header className="moa-section-heading"><span className="moa-kicker">DECISION LOG</span><h2>무엇을 비교하고 정했을까요?</h2><p>날짜부터 예산까지, 각 라운드의 후보와 판단 근거를 확인해보세요.</p></header><div className="moa-decision-list">{decisionRounds.map((round) => {
    const winner = round.candidates.find((candidate) => candidate.id === round.winnerId)!
    return <button onClick={() => open(round.id)} key={round.id}><span>{round.id}</span><div><strong>{round.name}</strong><small>{round.summary}</small></div><p><small>선택</small><strong>{winner.name}</strong></p><ArrowRight /></button>
  })}</div></div>
}

export function DecisionDrawer({ roundId, close }: { roundId:DecisionRoundId; close:()=>void }) {
  const round = decisionRounds.find((item) => item.id === roundId)!
  const winner = round.candidates.find((candidate) => candidate.id === round.winnerId)!
  const runnerUp = round.candidates.find((candidate) => candidate.id === round.runnerUpId)!
  return <motion.div className="moa-overlay" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onMouseDown={close}><motion.aside className="moa-drawer moa-decision-drawer" initial={{x:520}} animate={{x:0}} exit={{x:520}} onMouseDown={(event) => event.stopPropagation()}>
    <header><div><span className="moa-kicker">{round.id} · DECISION REASON</span><h2>{round.name}, 왜 이렇게 정했어요?</h2><p>{round.summary}</p></div><button onClick={close} aria-label="닫기"><X /></button></header>
    <div className="moa-verdict"><Gavel weight="duotone" /><div><small>최종 선택</small><strong>{winner.name}</strong></div></div>
    <section><h3>후보 비교</h3><div className="moa-candidate-compare">{round.candidates.map((candidate) => <article className={candidate.id === round.winnerId ? 'winner' : ''} key={candidate.id}><header><span>{candidate.id}</span>{candidate.id === round.winnerId && <em>선택</em>}</header><strong>{candidate.name}</strong><p>{candidate.price}</p><small>{candidate.detail}</small><b>그룹 적합도 {candidate.groupFit.toFixed(1)}</b></article>)}</div></section>
    <section><h3>대리인들의 입장</h3><ul className="moa-position-list">{round.positions.map((position) => <li key={position}>{position}</li>)}</ul></section>
    <div className="moa-fact-source"><ShieldCheck /><p><strong>심판이 확인했어요</strong><span>{round.factCheck}</span></p></div>
    <section><h3>{winner.name}을 고른 이유</h3>{round.reasons.map((reason) => <p key={reason}><Check />{reason}</p>)}<div className="moa-decision-metrics"><span><small>최저 만족도</small><strong>{round.minimumSatisfaction.toFixed(1)} / 10</strong></span><span><small>영향받은 하드 조건</small><strong>{round.constraints.join(' · ')}</strong></span></div></section>
    <section className="moa-runner-up"><h3>차선책</h3><p><strong>{runnerUp.name}</strong><span>{runnerUp.detail}</span></p><small>그룹 적합도가 {winner.groupFit.toFixed(1)}보다 낮아 선택되지 않았어요.</small></section>
    {round.uncertainty && <div className="moa-decision-warning"><Warning /><p><strong>아직 확인할 점</strong><span>{round.uncertainty}</span></p></div>}
    <button className="moa-button full" onClick={close}>확인</button>
  </motion.aside></motion.div>
}
