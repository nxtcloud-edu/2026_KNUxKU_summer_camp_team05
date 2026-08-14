import { ArrowLeft, ArrowRight, CheckCircle, SpinnerGap } from '@phosphor-icons/react'
import type { DestinationPack } from '../../product/types'
import { Page } from '../../components/ui'

/**
 * The persona confirmation gate — the last point a user can intervene before
 * the meeting speaks for them.
 *
 * It shows the answers the user actually chose, not an interpretation of them.
 * The criteria list is derived from the submitted survey, so nothing on this
 * screen was written by a model: confirming here means "these facts represent
 * me", and the backend records that confirmation (`POST /persona/confirm`).
 * Without it no advocate stands up for this participant.
 */
export function PersonaConfirmScreen({
  destination,
  criteria,
  source,
  busy,
  error,
  confirm,
  back,
}: {
  destination: DestinationPack
  criteria: string[]
  source: 'fixture' | 'live'
  busy: boolean
  error: string | null
  confirm: () => void
  back: () => void
}) {
  return <Page narrow>
    <button className="moa-back" onClick={back}><ArrowLeft />여행 방으로</button>
    <div className="moa-product-head">
      <span className="moa-kicker">PERSONA CONFIRMATION</span>
      <h1>MOA가 이해한 내 여행 기준</h1>
      <p>회의에서 이 기준으로 내 입장을 대신 말해요. 확인하지 않으면 회의에 내 대변인이 서지 않아요.</p>
    </div>

    <section className="moa-persona-block">
      <header><CheckCircle weight="duotone" /><span>{destination.name} 여행에 반영되는 내용</span></header>
      <div>
        {criteria.length > 0
          ? <ul className="moa-persona-criteria">{criteria.map((item) => <li key={item}><CheckCircle weight="fill" />{item}</li>)}</ul>
          : <p>아직 확인할 답변이 없어요. 설문을 먼저 완료해 주세요.</p>}
      </div>
    </section>

    {error && <p className="moa-builder-error" role="alert">{error}</p>}

    <aside className="moa-demo-note">
      {source === 'live'
        ? '확인을 누르면 이 기준이 서버에 기록되고, 회의가 시작될 때 내 대변인이 이 값으로 발언해요.'
        : '지금은 데모 모드예요. 확인 기록은 이 브라우저에만 저장되고 서버로 가지 않아요.'}
    </aside>

    <div className="moa-planning-actions">
      <button className="moa-button big" onClick={confirm} disabled={busy || criteria.length === 0}>
        {busy ? <><SpinnerGap />확인 중</> : <>이대로 나를 대표해요 <ArrowRight /></>}
      </button>
    </div>
  </Page>
}
