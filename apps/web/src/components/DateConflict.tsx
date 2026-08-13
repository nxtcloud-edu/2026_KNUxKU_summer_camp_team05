import { ArrowLeft, ArrowRight, CheckCircle, Clock, UsersThree, Warning } from '@phosphor-icons/react'
import { mockDateResolution } from '../data'

export function DateConflict({ select, extend, back }: {
  select: (optionId:string) => void
  extend: () => void
  back: () => void
}) {
  return <div className="moa-page narrow moa-date-conflict">
    <button className="moa-back" onClick={back}><ArrowLeft /> 여행 방으로 돌아가기</button>
    <header><span className="moa-host-only">HOST ONLY</span><Warning weight="duotone" /><h1>모두에게 완벽한 날짜를 찾지 못했어요.</h1><p>{mockDateResolution.summary}<br />가능한 답만 계산해서 가져왔어요.</p></header>
    <div className="moa-date-options">{mockDateResolution.options.map((option) => <article className={option.recommended ? 'recommended' : ''} key={option.id}>
      <div><span>{option.label}</span>{option.recommended && <em>가장 많은 인원</em>}</div>
      {option.dates ? <><h2>{option.dates}</h2><p><UsersThree />{option.attendance}</p>{option.unavailableMember && <small>{option.unavailableMember}</small>}<strong>{option.change}</strong></> : <><span className="moa-date-option-icon"><Clock /></span><h2>응답 마감 연장</h2><p>{option.change}</p></>}
      <button className={option.recommended ? 'moa-button' : 'moa-button ghost'} onClick={() => option.action === 'select' ? select(option.id) : extend()}>{option.action === 'select' ? '이 일정 선택' : '마감 연장'} <ArrowRight /></button>
    </article>)}</div>
    <footer><CheckCircle /> 직접 날짜를 고르는 대신, 모두의 응답으로 계산한 선택지만 보여드려요.</footer>
  </div>
}
