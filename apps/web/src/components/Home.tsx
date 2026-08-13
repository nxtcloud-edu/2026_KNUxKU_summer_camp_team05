import { ArrowRight, CalendarBlank, CheckCircle, Plus, UsersThree } from '@phosphor-icons/react'
import { mockTrips } from '../data'

export function Home({ create, openTrip, about }: {
  create: () => void
  openTrip: (stage:'result' | 'lobby') => void
  about: () => void
}) {
  return <div className="moa-page moa-home">
    <header className="moa-home-head">
      <div><span className="moa-kicker">MY TRIPS</span><h1>내 여행</h1><p>취향을 모으는 여행부터 예약을 앞둔 여행까지 한곳에서 확인해요.</p></div>
      <button className="moa-button big" onClick={create}><Plus /> 새 여행 계획하기</button>
    </header>
    {mockTrips.length ? <div className="moa-trip-list">{mockTrips.map((trip) => <article key={trip.id}>
      <img src={trip.image} alt={trip.destination} onError={(event) => { event.currentTarget.src='/assets/fukuoka.webp' }} />
      <div className="moa-trip-list-body"><span className={trip.status === '계획 완료' ? 'ready' : ''}>{trip.status === '계획 완료' && <CheckCircle weight="fill" />}{trip.status}</span><h2>{trip.destination}</h2><p><CalendarBlank />{trip.dates}<UsersThree />{trip.memberCount}명</p><small>{trip.status === '계획 완료' ? '일정과 주요 조건 확인 완료' : `${trip.readyCount} / ${trip.memberCount}명 준비 완료`}</small><button onClick={() => openTrip(trip.stage)}>여행 열기 <ArrowRight /></button></div>
    </article>)}</div> : <section className="moa-home-empty"><span><CalendarBlank /></span><h2>아직 여행이 없어요</h2><p>첫 여행을 만들고 대리인들에게 계획을 맡겨보세요.</p><button className="moa-button" onClick={create}>첫 여행 계획하기</button></section>}
    <button className="moa-home-about" onClick={about}>MOA는 어떻게 여행을 정하나요? <ArrowRight /></button>
  </div>
}
