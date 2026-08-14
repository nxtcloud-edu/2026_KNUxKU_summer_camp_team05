import { useState, type ReactNode } from 'react'
import { ArrowRight, CheckCircle, MapPin, SignOut, X } from '@phosphor-icons/react'
import { mockTrips } from '../data'
import { signIn, signUp, type AuthUser } from '../authApi'
import { readStorage, writeStorage } from '../utils/storage'

function ModalFrame({ children, close, labelledBy }: { children:ReactNode; close:()=>void; labelledBy:string }) {
  return <div className="moa-modal-bg" role="presentation" onMouseDown={close}><section className="moa-simple-modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy} onMouseDown={(event) => event.stopPropagation()}><button className="moa-modal-close" onClick={close} aria-label="닫기"><X /></button>{children}</section></div>
}

export function MarketingModal({ kind, close }: { kind:'intro'|'how'; close:()=>void }) {
  const intro = kind === 'intro'
  const steps = ['여행지만 고르기','각자 취향 입력','내 대리인 확인','대리인들이 계획 조율','근거와 함께 결과 확인']
  return <ModalFrame close={close} labelledBy="marketing-modal-title"><span className="moa-kicker">{intro ? 'ABOUT MOA' : 'HOW IT WORKS'}</span><h2 id="marketing-modal-title">{intro ? '취향은 그대로, 결정은 함께.' : '여행이 정해지는 순서'}</h2>{intro ? <><p>MOA는 한 사람이 모두를 대신해 계획하지 않아요. 각자의 대리인이 조건과 취향을 지키며 의견을 맞추고, 결정 근거와 양보 내역까지 남겨요.</p><div className="moa-modal-points"><p><strong>여행 먼저</strong><span>기술보다 일정과 경험을 먼저 보여줘요.</span></p><p><strong>대화 대신 비동기</strong><span>취향을 남기고 앱을 닫아도 괜찮아요.</span></p><p><strong>결정 근거 공개</strong><span>왜 골랐는지, 누가 양보했는지 확인해요.</span></p></div></> : <ol className="moa-how-list">{steps.map((step,index) => <li key={step}><span>{index + 1}</span><strong>{step}</strong>{index < steps.length - 1 && <ArrowRight />}</li>)}</ol>}<button className="moa-button full" onClick={close}>확인</button></ModalFrame>
}

export function LoginModal({ close, authenticated }: { close:()=>void; authenticated:(user:AuthUser)=>void }) {
  const [mode,setMode] = useState<'login'|'signup'>('login')
  const [name,setName] = useState('')
  const [email,setEmail] = useState('')
  const [password,setPassword] = useState('')
  const [passwordConfirm,setPasswordConfirm] = useState('')
  const [terms,setTerms] = useState(false)
  const [submitting,setSubmitting] = useState(false)
  const [error,setError] = useState('')

  const changeMode = (next:'login'|'signup') => {
    setMode(next)
    setError('')
  }
  const submit = async (event:React.FormEvent) => {
    event.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) { setError('이메일 주소를 확인해주세요.'); return }
    if (password.length < 8) { setError('비밀번호는 8자 이상 입력해주세요.'); return }
    if (mode === 'signup' && name.trim().length < 2) { setError('이름을 2자 이상 입력해주세요.'); return }
    if (mode === 'signup' && password !== passwordConfirm) { setError('비밀번호가 서로 달라요.'); return }
    if (mode === 'signup' && !terms) { setError('서비스 이용약관에 동의해주세요.'); return }
    setSubmitting(true)
    setError('')
    try {
      const user = mode === 'login' ? await signIn({email:normalizedEmail,password}) : await signUp({name:name.trim(),email:normalizedEmail,password})
      authenticated(user)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '요청을 처리하지 못했어요.')
    } finally { setSubmitting(false) }
  }

  return <ModalFrame close={close} labelledBy="login-modal-title"><span className="moa-kicker">WELCOME TO MOA</span><h2 id="login-modal-title">{mode === 'login' ? '다시 만나서 반가워요.' : '같이 여행을 시작해볼까요?'}</h2><p>{mode === 'login' ? '로그인하고 만들던 여행을 이어서 확인하세요.' : '계정을 만들면 여행 방과 내 취향을 이어서 볼 수 있어요.'}</p><div className="moa-auth-tabs" role="tablist"><button type="button" role="tab" aria-selected={mode==='login'} className={mode==='login'?'active':''} onClick={()=>changeMode('login')}>로그인</button><button type="button" role="tab" aria-selected={mode==='signup'} className={mode==='signup'?'active':''} onClick={()=>changeMode('signup')}>회원가입</button></div><form className="moa-auth-form" onSubmit={submit}>{mode === 'signup' && <label>이름<input autoComplete="name" value={name} onChange={(event)=>setName(event.target.value)} placeholder="이름을 입력해주세요" autoFocus /></label>}<label>이메일<input type="email" autoComplete="email" value={email} onChange={(event)=>setEmail(event.target.value)} placeholder="name@example.com" autoFocus={mode==='login'} /></label><label>비밀번호<input type="password" autoComplete={mode==='login'?'current-password':'new-password'} value={password} onChange={(event)=>setPassword(event.target.value)} placeholder="8자 이상 입력해주세요" /></label>{mode === 'signup' && <><label>비밀번호 확인<input type="password" autoComplete="new-password" value={passwordConfirm} onChange={(event)=>setPasswordConfirm(event.target.value)} placeholder="한 번 더 입력해주세요" /></label><label className="moa-auth-terms"><input type="checkbox" checked={terms} onChange={(event)=>setTerms(event.target.checked)} /><span><CheckCircle weight="fill" /></span>서비스 이용약관과 개인정보 처리방침에 동의해요.</label></>}{error && <p className="moa-auth-error" role="alert">{error}</p>}<button className="moa-button full big" type="submit" disabled={submitting}>{submitting ? '확인하는 중…' : mode === 'login' ? '로그인' : '계정 만들기'} {!submitting && <ArrowRight />}</button></form></ModalFrame>
}

export function DestinationRequestModal({ close, submitted }: { close:()=>void; submitted:(destination:string)=>void }) {
  const [destination,setDestination] = useState('')
  const submit = (event:React.FormEvent) => {
    event.preventDefault()
    const value = destination.trim()
    if (!value) return
    let existing:string[] = []
    try {
      const saved = JSON.parse(readStorage('local', 'moa-destination-requests') || '[]') as unknown
      if (Array.isArray(saved)) existing = saved.filter((item):item is string => typeof item === 'string')
    } catch { /* replace malformed prototype data with a valid list */ }
    writeStorage('local', 'moa-destination-requests', JSON.stringify([...existing,value]))
    submitted(value)
  }
  return <ModalFrame close={close} labelledBy="destination-modal-title"><span className="moa-kicker">DESTINATION REQUEST</span><h2 id="destination-modal-title">다음엔 어디를 지원하면 좋을까요?</h2><p>요청은 지원 여행지를 정할 때 참고할게요. 지금 바로 새 여행지로 생성되지는 않아요.</p><form className="moa-request-form" onSubmit={submit}><label>여행지 이름<div><MapPin /><input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="예: 타이베이" autoFocus /></div></label><button className="moa-button full" type="submit" disabled={!destination.trim()}>요청 보내기</button></form></ModalFrame>
}

export function ProfileModal({ user, close, logout }: { user:AuthUser; close:()=>void; logout:()=>void }) {
  return <ModalFrame close={close} labelledBy="profile-modal-title"><span className="moa-kicker">PROFILE</span><div className="moa-profile-person"><span>{user.name.trim().charAt(0)}</span><div><h2 id="profile-modal-title">{user.name}</h2><p>{user.email}</p></div></div><div className="moa-profile-stat"><span>현재 여행</span><strong>{mockTrips.length}개</strong></div><div className="moa-profile-trips">{mockTrips.map((trip) => <p key={trip.id}><CheckCircle weight={trip.status === '계획 완료' ? 'fill' : 'regular'} /><span><strong>{trip.destination}</strong><small>{trip.status}</small></span></p>)}</div><button className="moa-profile-logout" onClick={logout}><SignOut /> 로그아웃</button></ModalFrame>
}
