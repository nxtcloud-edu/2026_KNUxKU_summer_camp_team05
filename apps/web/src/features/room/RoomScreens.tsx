import { ArrowRight, Bell, Check, Copy, ShareNetwork, SpinnerGap } from '@phosphor-icons/react'
import type { DestinationPack, Participant } from '../../product/types'
import { Page } from '../../components/ui'

export function InviteRoom({ destination, inviteUrl, roomId, copy, share, next }: {
  destination: DestinationPack
  inviteUrl: string
  roomId: string | null
  copy: () => void
  share: () => void
  next: () => void
}) {
  return <Page narrow><section className="moa-room-created">
    <div className="moa-status-mark success"><Check weight="bold" /></div>
    <span className="moa-kicker">ROOM IS READY</span>
    <h1>{destination.name} 여행 방을 열었어요</h1>
    <p>친구들은 링크로 들어와 각자 일정·예산·조건·취향을 입력해요.</p>
    <div className="moa-created-link">
      <span>{roomId ? '초대 링크' : '초대 링크 준비 중'}</span>
      <strong>{inviteUrl}</strong>
      <button type="button" onClick={copy} aria-label="초대 링크 복사"><Copy /><span>복사</span></button>
    </div>
    <div className="moa-created-actions">
      <button type="button" className="moa-button big" onClick={next}>여행 방 열기 <ArrowRight /></button>
      <button type="button" className="moa-button ghost big moa-created-share" onClick={share} aria-label="공유하기"><ShareNetwork /></button>
    </div>
  </section></Page>
}

function participantInputLabel(member: Participant) {
  if (member.state === 'complete') return '입력 완료'
  if (member.state === 'in-progress') return member.availabilityConfirmed && !member.preferencesRepresented ? '기준 확인 대기' : '취향 입력 중'
  const missing = [!member.availabilityConfirmed ? '날짜' : '', !member.preferencesRepresented ? '취향' : ''].filter(Boolean)
  return missing.length > 0 ? `${missing.join(' · ')} 입력 필요` : '입력 대기 중'
}

function RoomParticipantRow({ member, compact, remind }: { member: Participant; compact?: boolean; remind: () => void }) {
  const complete = member.state === 'complete'
  return <li className={`${compact ? 'compact' : 'pending'}${member.isHost ? ' is-me' : ''}`}>
    <span className="moa-room-v2-avatar" aria-hidden="true">{member.initial}</span>
    <div className="moa-room-v2-person"><strong>{member.name}{member.isHost && <i>방장</i>}</strong><small>{participantInputLabel(member)}</small></div>
    {complete
      ? <span className="moa-room-complete-check" aria-hidden="true"><Check weight="bold" /></span>
      : member.state === 'in-progress'
        ? <span className="moa-room-progress-pill">입력 중</span>
        : <button type="button" className="moa-room-remind-link" onClick={remind}>다시 알리기 <ArrowRight /></button>}
  </li>
}

export function ProductLobby({ destination, participants, loading, error, source, start, copy }: {
  destination: DestinationPack
  participants: Participant[]
  loading: boolean
  error: string | null
  source: 'fixture' | 'live'
  start: () => void
  copy: () => void
}) {
  const completed = participants.filter((member) => member.state === 'complete')
  const unfinished = participants.filter((member) => member.state !== 'complete')
  const total = participants.length
  const ready = completed.length
  const remaining = Math.max(total - ready, 0)
  const progress = total > 0 ? Math.round(ready / total * 100) : 0

  return <Page><div className="moa-room-v2">
    <header className="moa-room-v2-header">
      <div><span>{destination.name.toUpperCase()} · TRIP ROOM</span><em>{source === 'live' ? '입력 진행 중' : '데모 데이터'}</em></div>
      <h1>{destination.name} 여행</h1>
      <p>{loading && total === 0 ? '참여자를 불러오고 있어요' : `${total}명 · 입력 진행 중`}</p>
    </header>

    {error && <aside className="moa-demo-note" role="alert">{error}</aside>}

    <section className="moa-room-v2-card moa-room-progress-card" aria-labelledby="moa-room-progress-title">
      <h2 id="moa-room-progress-title"><b>{ready}</b> / {total}명 입력 완료</h2>
      <div className="moa-room-v2-progress" role="progressbar" aria-label="참여자 입력 완료율" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div>
      <p>{remaining > 0 ? `${remaining}명만 더 입력하면 모두의 취향을 반영할 수 있어요.` : '모두 입력을 마쳤어요.'}</p>
      <button type="button" className="moa-room-remind-all" onClick={copy}><Bell />친구에게 다시 알리기</button>
    </section>

    {loading && total === 0
      ? <section className="moa-room-v2-card" role="status"><h2><SpinnerGap /> 참여자 확인 중</h2></section>
      : <>
        <section className="moa-room-v2-group pending" aria-labelledby="moa-room-pending-title">
          <h2 id="moa-room-pending-title">아직 입력이 필요해요 <span>· {unfinished.length}</span></h2>
          <ul>{unfinished.map((member) => <RoomParticipantRow key={member.id} member={member} remind={copy} />)}</ul>
        </section>
        <section className="moa-room-v2-group complete" aria-labelledby="moa-room-complete-title">
          <h2 id="moa-room-complete-title">입력 완료 <span>· {completed.length}</span></h2>
          <ul>{completed.map((member) => <RoomParticipantRow key={member.id} member={member} compact remind={copy} />)}</ul>
        </section>
      </>}

    <button type="button" className="moa-room-self-link" onClick={start}>내 여행 기준 만들기 <ArrowRight /></button>
  </div></Page>
}
