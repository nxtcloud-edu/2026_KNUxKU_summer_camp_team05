import { useState, type ReactNode } from 'react'
import { ArrowRight, CheckCircle, MapPin, SignOut, UserCircle, X } from '@phosphor-icons/react'
import { mockTrips } from '../data'

function ModalFrame({ children, close, labelledBy }: { children:ReactNode; close:()=>void; labelledBy:string }) {
  return <div className="moa-modal-bg" role="presentation" onMouseDown={close}><section className="moa-simple-modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy} onMouseDown={(event) => event.stopPropagation()}><button className="moa-modal-close" onClick={close} aria-label="닫기"><X /></button>{children}</section></div>
}

export function MarketingModal({ kind, close }: { kind:'intro'|'how'; close:()=>void }) {
  const intro = kind === 'intro'
  const steps = ['여행지만 고르기','각자 취향 입력','내 대리인 확인','대리인들이 계획 조율','근거와 함께 결과 확인']
  return <ModalFrame close={close} labelledBy="marketing-modal-title"><span className="moa-kicker">{intro ? 'ABOUT MOA' : 'HOW IT WORKS'}</span><h2 id="marketing-modal-title">{intro ? '취향은 그대로, 결정은 함께.' : '여행이 정해지는 순서'}</h2>{intro ? <><p>MOA는 한 사람이 모두를 대신해 계획하지 않아요. 각자의 대리인이 조건과 취향을 지키며 의견을 맞추고, 결정 근거와 양보 내역까지 남겨요.</p><div className="moa-modal-points"><p><strong>여행 먼저</strong><span>기술보다 일정과 경험을 먼저 보여줘요.</span></p><p><strong>대화 대신 비동기</strong><span>취향을 남기고 앱을 닫아도 괜찮아요.</span></p><p><strong>결정 근거 공개</strong><span>왜 골랐는지, 누가 양보했는지 확인해요.</span></p></div></> : <ol className="moa-how-list">{steps.map((step,index) => <li key={step}><span>{index + 1}</span><strong>{step}</strong>{index < steps.length - 1 && <ArrowRight />}</li>)}</ol>}<button className="moa-button full" onClick={close}>확인</button></ModalFrame>
}

export function LoginModal({ close, login }: { close:()=>void; login:()=>void }) {
  return <ModalFrame close={close} labelledBy="login-modal-title"><span className="moa-kicker">DEMO LOGIN</span><h2 id="login-modal-title">MOA 데모로 들어갈까요?</h2><p>현재 프로토타입은 실제 계정을 만들지 않아요. 데모 계정으로 내 여행 화면을 확인할 수 있어요.</p><div className="moa-demo-account"><UserCircle /><span><strong>민지</strong><small>minji@moa.demo</small></span></div><button className="moa-button full big" onClick={login}>데모 계정으로 계속 <ArrowRight /></button></ModalFrame>
}

export function DestinationRequestModal({ close, submitted }: { close:()=>void; submitted:(destination:string)=>void }) {
  const [destination,setDestination] = useState('')
  const submit = (event:React.FormEvent) => {
    event.preventDefault()
    const value = destination.trim()
    if (!value) return
    let existing:string[] = []
    try {
      const saved = JSON.parse(localStorage.getItem('moa-destination-requests') || '[]') as unknown
      if (Array.isArray(saved)) existing = saved.filter((item):item is string => typeof item === 'string')
    } catch { /* replace malformed prototype data with a valid list */ }
    localStorage.setItem('moa-destination-requests', JSON.stringify([...existing,value]))
    submitted(value)
  }
  return <ModalFrame close={close} labelledBy="destination-modal-title"><span className="moa-kicker">DESTINATION REQUEST</span><h2 id="destination-modal-title">다음엔 어디를 지원하면 좋을까요?</h2><p>요청은 지원 여행지를 정할 때 참고할게요. 지금 바로 새 여행지로 생성되지는 않아요.</p><form className="moa-request-form" onSubmit={submit}><label>여행지 이름<div><MapPin /><input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="예: 타이베이" autoFocus /></div></label><button className="moa-button full" type="submit" disabled={!destination.trim()}>요청 보내기</button></form></ModalFrame>
}

export function ProfileModal({ close, logout }: { close:()=>void; logout:()=>void }) {
  return <ModalFrame close={close} labelledBy="profile-modal-title"><span className="moa-kicker">PROFILE</span><div className="moa-profile-person"><span>민</span><div><h2 id="profile-modal-title">민지</h2><p>minji@moa.demo</p></div></div><div className="moa-profile-stat"><span>현재 여행</span><strong>{mockTrips.length}개</strong></div><div className="moa-profile-trips">{mockTrips.map((trip) => <p key={trip.id}><CheckCircle weight={trip.status === '계획 완료' ? 'fill' : 'regular'} /><span><strong>{trip.destination}</strong><small>{trip.status}</small></span></p>)}</div><button className="moa-profile-logout" onClick={logout}><SignOut /> 로그아웃</button></ModalFrame>
}
