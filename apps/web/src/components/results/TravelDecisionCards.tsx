import type { ReactNode } from 'react'
import { ArrowRight, ArrowSquareOut, Bed, ForkKnife, MapPin, Ticket, Train } from '@phosphor-icons/react'
import type {
  AccommodationView,
  ActivityView,
  AvailabilityView,
  DiningView,
  EvidenceSummary,
  TransportView,
  TravelDecisionData,
} from '../../product/types'
import {
  EvidenceBadge,
  FreshnessLabel,
  LocationSummary,
  PriceDisplay,
  RouteSummary,
  UncertaintyNotice,
  WeatherWarning,
} from './ResultDataPrimitives'

const durationLabel = (minutes: number) => minutes < 60 ? `${minutes}분` : `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ''}`

type InfoRow = { label: string; value: ReactNode }

function ImportantInfo({ rows }: { rows: InfoRow[] }) {
  if (rows.length === 0) return null
  return <dl className="moa-shared-info-rows">{rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
}

function DecisionInfoStatus({ availability, evidence }: { availability?: AvailabilityView; evidence?: EvidenceSummary }) {
  if (!availability && !evidence) return null
  const statusEvidence = evidence ?? availability?.evidence
  return <section className="moa-shared-info-status">
    {availability && <div><strong>{availability.label}</strong>{availability.detail && <span>{availability.detail}</span>}</div>}
    {statusEvidence && <div className="moa-shared-info-status-chips"><EvidenceBadge evidence={statusEvidence} /><FreshnessLabel evidence={statusEvidence} /></div>}
  </section>
}

function DecisionInfoShell({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return <div className="moa-shared-decision-info"><header><span aria-hidden="true">{icon}</span><strong>{label}</strong></header>{children}</div>
}

export function DecisionPrimaryLink({ href, children }: { href?: string; children: ReactNode }) {
  if (!href) return null
  return <a className="moa-decision-primary-link" href={href} target="_blank" rel="noreferrer">{children}<ArrowSquareOut /></a>
}

export function TransportCard({ transport, showPrimaryAction = true }: { transport: TransportView; showPrimaryAction?: boolean }) {
  const fare = transport.baseFare ?? transport.effectiveTotalPrice
  const hasRoute = Boolean(transport.departureLocation && transport.arrivalLocation)
  const hasTimes = Boolean(transport.departureTime && transport.arrivalTime)
  const hasDuration = Number.isFinite(transport.durationMinutes)
  if (transport.mode !== 'flight') {
    return <DecisionInfoShell icon={<Train />} label={transport.modeLabel}>
      {hasRoute && <section className="moa-transport-route-hero" aria-label={`${transport.departureLocation}에서 ${transport.arrivalLocation}까지`}>
        <div><strong>{transport.departureLocation}</strong><time>{transport.departureTime}</time></div>
        <ArrowRight aria-hidden="true" />
        <div><strong>{transport.arrivalLocation}</strong><time>{transport.arrivalTime}</time></div>
        {hasDuration && <p>{durationLabel(transport.durationMinutes)} · {transport.transferCount ? `환승 ${transport.transferCount}회` : '직행'}</p>}
      </section>}
      <ImportantInfo rows={[
        ...(transport.operator && hasRoute ? [{ label: '운영사 / 노선', value: `${transport.operator} · ${transport.departureLocation} → ${transport.arrivalLocation}` } as InfoRow] : []),
        ...(transport.serviceNumber ? [{ label: '편명', value: transport.serviceNumber } as InfoRow] : []),
        ...(hasTimes ? [{ label: '출발 · 도착', value: <>{transport.departureTime} → {transport.arrivalTime}{hasDuration && <small>{durationLabel(transport.durationMinutes)}</small>}</> } as InfoRow] : []),
        ...(fare ? [{ label: '요금', value: <PriceDisplay price={fare} compact /> } as InfoRow] : []),
      ]} />
      <DecisionInfoStatus availability={transport.inventory} evidence={transport.evidence} />
      {showPrimaryAction && <DecisionPrimaryLink href={transport.bookingUrl}>예약처에서 확인</DecisionPrimaryLink>}
    </DecisionInfoShell>
  }
  return <div className={`moa-transport-decision-info${transport.mode === 'flight' ? ' is-flight' : ''}`}>
    {hasRoute && <section className="moa-transport-route-hero" aria-label={`${transport.departureLocation}에서 ${transport.arrivalLocation}까지`}>
      <div><strong>{transport.departureLocation}</strong>{transport.departureCode && <b>{transport.departureCode}</b>}<time>{transport.departureTime}</time></div>
      <ArrowRight aria-hidden="true" />
      <div><strong>{transport.arrivalLocation}</strong>{transport.arrivalCode && <b>{transport.arrivalCode}</b>}<time>{transport.arrivalTime}</time></div>
      {hasDuration && <p>{durationLabel(transport.durationMinutes)} · {transport.transferCount ? `환승 ${transport.transferCount}회` : '직항'}</p>}
    </section>}
    <section className="moa-selected-flight-info">
      <h2>선택 정보</h2>
      <ImportantInfo rows={[
      ...(transport.operator && hasRoute ? [{ label: '항공사/노선', value: `${transport.operator} · ${transport.departureLocation} → ${transport.arrivalLocation}` } as InfoRow] : []),
      ...(transport.serviceNumber ? [{ label: '편명', value: transport.serviceNumber } as InfoRow] : []),
      ...(hasTimes ? [{ label: '출발·도착 시간', value: <>{transport.departureTime} → {transport.arrivalTime}{hasDuration && <small>{durationLabel(transport.durationMinutes)} · {transport.transferCount ? `환승 ${transport.transferCount}회` : '직항'}</small>}</> } as InfoRow] : []),
      ...(transport.baggage ? [{ label: '위탁 수하물', value: transport.baggage } as InfoRow] : []),
      ...(fare ? [{ label: '요금', value: <PriceDisplay price={fare} compact /> } as InfoRow] : []),
      ...(transport.additionalTransportCost ? [{ label: '추가 이동비', value: <PriceDisplay price={transport.additionalTransportCost} compact /> } as InfoRow] : []),
      ]} />
    </section>
    <DecisionInfoStatus availability={transport.inventory} evidence={transport.evidence} />
    {showPrimaryAction && <DecisionPrimaryLink href={transport.bookingUrl}>예약처에서 확인</DecisionPrimaryLink>}
  </div>
}

export function AccommodationCard({ accommodation, showPrimaryAction = true }: { accommodation: AccommodationView; showPrimaryAction?: boolean }) {
  const roomRows: InfoRow[] = [
    ...(accommodation.roomCombination ? [{ label: '객실 구성', value: accommodation.roomCombination } as InfoRow] : []),
    ...(accommodation.groupCapacity !== undefined ? [{ label: '수용 인원', value: `${accommodation.groupCapacity}명` } as InfoRow] : []),
    ...(accommodation.checkIn && accommodation.checkOut ? [{ label: '체크인 · 체크아웃', value: `${accommodation.checkIn} · ${accommodation.checkOut}` } as InfoRow] : []),
  ]
  const amenities = accommodation.amenities ?? []
  return <DecisionInfoShell icon={<Bed />} label="숙소 정보">
    <LocationSummary location={accommodation.location} />
    {(accommodation.nightlyPrice || accommodation.totalStayPrice) && <div className="moa-shared-price-pair">
      {accommodation.nightlyPrice && <div><span>1박 기준</span><PriceDisplay price={accommodation.nightlyPrice} /></div>}
      {accommodation.totalStayPrice && <div><span>숙박 전체</span><PriceDisplay price={accommodation.totalStayPrice} /></div>}
    </div>}
    {roomRows.length > 0 && <section className="moa-shared-room-info"><h3>객실</h3><ImportantInfo rows={roomRows} /></section>}
    <DecisionInfoStatus availability={accommodation.roomAvailability} evidence={accommodation.evidence} />
    {amenities.length > 0 && <ul className="moa-shared-amenities">{amenities.map((item) => <li key={item}>{item}</li>)}</ul>}
    {accommodation.accessibility?.length && <p className="moa-shared-accessibility"><MapPin />{accommodation.accessibility.join(' · ')}</p>}
    {accommodation.cancellationInfo && <aside className="moa-booking-warning"><strong>예약 전 확인</strong><p>{accommodation.cancellationInfo}</p></aside>}
    {showPrimaryAction && <DecisionPrimaryLink href={accommodation.bookingUrl}>예약처에서 확인</DecisionPrimaryLink>}
  </DecisionInfoShell>
}

export function ActivityCard({ activity, showPrimaryAction = true }: { activity: ActivityView; showPrimaryAction?: boolean }) {
  return <DecisionInfoShell icon={<Ticket />} label={activity.category}>
    <LocationSummary location={activity.location} />
    {activity.ticketPrice && <div className="moa-shared-primary-price"><PriceDisplay price={activity.ticketPrice} /></div>}
    <ImportantInfo rows={[
      ...(activity.openingHours ? [{ label: '운영 시간', value: activity.openingHours } as InfoRow] : []),
      ...(activity.closedDays ? [{ label: '휴무', value: activity.closedDays } as InfoRow] : []),
      ...(activity.expectedDurationMinutes ? [{ label: '예상 체류', value: durationLabel(activity.expectedDurationMinutes) } as InfoRow] : []),
    ]} />
    <DecisionInfoStatus availability={activity.reservation} evidence={activity.evidence} />
    {activity.weatherSensitivity && <WeatherWarning warning={activity.weatherSensitivity} />}
    {showPrimaryAction && <DecisionPrimaryLink href={activity.bookingUrl}>티켓·운영 정보 확인</DecisionPrimaryLink>}
  </DecisionInfoShell>
}

export function DiningCard({ dining, showPrimaryAction = true }: { dining: DiningView; showPrimaryAction?: boolean }) {
  const allergySupport = dining.allergySupport ?? []
  const dietarySupport = dining.dietarySupport ?? []
  const dietaryItems = [...allergySupport, ...dietarySupport]
  const uncertainAllergy = allergySupport.some((item) => item.status !== 'confirmed')
  return <DecisionInfoShell icon={<ForkKnife />} label={dining.cuisine}>
    <LocationSummary location={dining.location} />
    {dining.price && <div className="moa-shared-primary-price"><PriceDisplay price={dining.price} /></div>}
    <ImportantInfo rows={[
      ...(dining.openingHours ? [{ label: '영업시간', value: dining.openingHours } as InfoRow] : []),
      ...(dining.waitingInfo ? [{ label: '대기', value: dining.waitingInfo } as InfoRow] : []),
    ]} />
    <DecisionInfoStatus availability={dining.reservation} evidence={dining.evidence} />
    {dietaryItems.length > 0 && <section className="moa-shared-dietary"><h3>식이 조건</h3>{dietaryItems.map((item) => <article key={`${item.label}-${item.status}`}><strong>{item.label}</strong><span>{item.status === 'confirmed' ? '확인됨' : item.status === 'inferred' ? '추정 정보' : '정보 없음'}</span>{item.detail && <p>{item.detail}</p>}</article>)}</section>}
    {uncertainAllergy && <UncertaintyNotice safety message="알레르기 대응은 매장에 직접 확인하기 전까지 안전이 확인된 것으로 보지 않습니다." />}
    {showPrimaryAction && <DecisionPrimaryLink href={dining.bookingUrl}>예약 가능 여부 확인</DecisionPrimaryLink>}
  </DecisionInfoShell>
}

export function TravelDecisionContent({ data, showPrimaryAction = true }: { data?: TravelDecisionData; showPrimaryAction?: boolean }) {
  if (!data) return null
  if (data.kind === 'transport') return <TransportCard transport={data} showPrimaryAction={showPrimaryAction} />
  if (data.kind === 'accommodation') return <AccommodationCard accommodation={data} showPrimaryAction={showPrimaryAction} />
  if (data.kind === 'activity') return <ActivityCard activity={data} showPrimaryAction={showPrimaryAction} />
  if (data.kind === 'dining') return <DiningCard dining={data} showPrimaryAction={showPrimaryAction} />
  if (!data.route) return null
  return <DecisionInfoShell icon={<Train />} label="이동 정보"><RouteSummary route={data.route} /></DecisionInfoShell>
}
