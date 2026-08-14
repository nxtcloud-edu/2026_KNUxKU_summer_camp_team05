import { ArrowSquareOut, Bed, Clock, ForkKnife, Ticket, Train } from '@phosphor-icons/react'
import type { AccommodationView, ActivityView, DiningView, TransportView, TravelDecisionData } from '../../product/types'
import {
  BookingStatus,
  EvidenceBadge,
  FreshnessLabel,
  LocationSummary,
  PriceDisplay,
  RouteSummary,
  SourceDetail,
  UncertaintyNotice,
  WeatherWarning,
} from './ResultDataPrimitives'

const durationLabel = (minutes: number) => minutes < 60 ? `${minutes}분` : `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ''}`

export function TransportCard({ transport }: { transport: TransportView }) {
  const totalPrice = transport.effectiveTotalPrice ?? transport.baseFare
  return (
    <section className="moa-travel-data-card transport">
      <header><Train weight="duotone" /><div><span>{transport.modeLabel}</span><strong>{transport.departureLocation} → {transport.arrivalLocation}</strong></div></header>
      <div className="moa-transport-service"><strong>{transport.operator}{transport.serviceNumber ? ` ${transport.serviceNumber}` : ''}</strong><span>{transport.departureTime} → {transport.arrivalTime}</span><small>{durationLabel(transport.durationMinutes)} · {transport.transferCount ? `환승 ${transport.transferCount}회` : '직행'}</small></div>
      {transport.baggage && <p>{transport.baggage}</p>}
      {totalPrice && <PriceDisplay price={totalPrice} />}
      {transport.additionalTransportCost && <div className="moa-cost-note"><span>추가 이동비</span><PriceDisplay price={transport.additionalTransportCost} compact /></div>}
      {transport.inventory && <BookingStatus availability={transport.inventory} />}
      <div className="moa-data-meta"><EvidenceBadge evidence={transport.evidence} /><FreshnessLabel evidence={transport.evidence} /></div>
      {transport.bookingUrl && <a className="moa-data-link" href={transport.bookingUrl} target="_blank" rel="noreferrer">예약처에서 확인 <ArrowSquareOut /></a>}
    </section>
  )
}

export function AccommodationCard({ accommodation }: { accommodation: AccommodationView }) {
  return (
    <section className="moa-travel-data-card accommodation">
      {accommodation.image && <img src={accommodation.image} alt="" />}
      <header><Bed weight="duotone" /><div><span>{accommodation.location.area}</span><strong>{accommodation.name}</strong></div></header>
      <LocationSummary location={accommodation.location} />
      <div className="moa-price-pair"><PriceDisplay price={accommodation.nightlyPrice} />{accommodation.totalStayPrice && <PriceDisplay price={accommodation.totalStayPrice} compact />}</div>
      <dl className="moa-data-facts"><div><dt>객실 구성</dt><dd>{accommodation.roomCombination}</dd></div><div><dt>수용 인원</dt><dd>{accommodation.groupCapacity}명</dd></div><div><dt>체크인</dt><dd>{accommodation.checkIn}</dd></div><div><dt>체크아웃</dt><dd>{accommodation.checkOut}</dd></div></dl>
      <BookingStatus availability={accommodation.roomAvailability} />
      <div className="moa-tag-list">{accommodation.amenities.map((item) => <span key={item}>{item}</span>)}</div>
      {accommodation.accessibility && <p className="moa-accessibility">이동 접근성 · {accommodation.accessibility.join(' · ')}</p>}
      {accommodation.cancellationInfo && <UncertaintyNotice message={accommodation.cancellationInfo} />}
      <SourceDetail evidence={accommodation.evidence} />
      {accommodation.bookingUrl && <a className="moa-data-link" href={accommodation.bookingUrl} target="_blank" rel="noreferrer">예약처에서 확인 <ArrowSquareOut /></a>}
    </section>
  )
}

export function ActivityCard({ activity }: { activity: ActivityView }) {
  return (
    <section className="moa-travel-data-card activity">
      <header><Ticket weight="duotone" /><div><span>{activity.category}</span><strong>{activity.name}</strong></div></header>
      <LocationSummary location={activity.location} />
      <dl className="moa-data-facts"><div><dt>영업시간</dt><dd>{activity.openingHours ?? '확인 필요'}</dd></div>{activity.closedDays && <div><dt>휴무</dt><dd>{activity.closedDays}</dd></div>}{activity.expectedDurationMinutes && <div><dt>예상 체류</dt><dd>{durationLabel(activity.expectedDurationMinutes)}</dd></div>}</dl>
      {activity.ticketPrice && <PriceDisplay price={activity.ticketPrice} />}
      {activity.reservation && <BookingStatus availability={activity.reservation} />}
      {activity.weatherSensitivity && <WeatherWarning warning={activity.weatherSensitivity} />}
      <SourceDetail evidence={activity.evidence} />
      {activity.bookingUrl && <a className="moa-data-link" href={activity.bookingUrl} target="_blank" rel="noreferrer">티켓·운영 정보 확인 <ArrowSquareOut /></a>}
    </section>
  )
}

export function DiningCard({ dining }: { dining: DiningView }) {
  return (
    <section className="moa-travel-data-card dining">
      <header><ForkKnife weight="duotone" /><div><span>{dining.cuisine}</span><strong>{dining.name}</strong></div></header>
      <LocationSummary location={dining.location} />
      <dl className="moa-data-facts"><div><dt>영업시간</dt><dd>{dining.openingHours ?? '확인 필요'}</dd></div>{dining.waitingInfo && <div><dt>대기</dt><dd>{dining.waitingInfo}</dd></div>}</dl>
      {dining.price && <PriceDisplay price={dining.price} />}
      {dining.reservation && <BookingStatus availability={dining.reservation} />}
      <div className="moa-dietary-statuses">
        {[...dining.allergySupport, ...dining.dietarySupport].map((item) => (
          <article className={`state-${item.status}${dining.allergySupport.includes(item) ? ' safety' : ''}`} key={`${item.label}-${item.status}`}>
            <header><strong>{item.label}</strong><span>{item.status === 'confirmed' ? '확인됨' : item.status === 'inferred' ? '추정 정보' : '정보 없음'}</span></header>
            <p>{item.detail}</p>
            <FreshnessLabel evidence={item.evidence} />
          </article>
        ))}
      </div>
      {dining.allergySupport.some((item) => item.status !== 'confirmed') && <UncertaintyNotice safety message="알레르기 대응은 매장에 직접 확인하기 전까지 안전이 확인된 것으로 보지 않습니다." />}
      <SourceDetail evidence={dining.evidence} />
      {dining.bookingUrl && <a className="moa-data-link" href={dining.bookingUrl} target="_blank" rel="noreferrer">예약 가능 여부 확인 <ArrowSquareOut /></a>}
    </section>
  )
}

export function TravelDecisionContent({ data }: { data?: TravelDecisionData }) {
  if (!data) return null
  if (data.kind === 'transport') return <TransportCard transport={data} />
  if (data.kind === 'accommodation') return <AccommodationCard accommodation={data} />
  if (data.kind === 'activity') return <ActivityCard activity={data} />
  if (data.kind === 'dining') return <DiningCard dining={data} />
  return <RouteSummary route={data.route} />
}

export function ItineraryClock({ time }: { time: string }) {
  return <span className="moa-itinerary-time"><Clock />{time}</span>
}
