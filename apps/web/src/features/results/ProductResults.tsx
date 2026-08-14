import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Airplane,
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  Bed,
  CalendarBlank,
  CaretDown,
  Check,
  CheckCircle,
  Clock,
  MapPin,
  PlayCircle,
  Warning,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import {
  FreshnessLabel,
  PriceDisplay,
  RouteMapPreview,
  SourceDetail,
  UncertaintyNotice,
  WeatherWarning,
} from '../../components/results/ResultDataPrimitives'
import { DecisionPrimaryLink, TravelDecisionContent } from '../../components/results/TravelDecisionCards'
import type {
  BookingReadiness,
  Concession,
  DecisionSummary,
  ItineraryDayView,
  ItineraryItemView,
  ItineraryLeg,
  ItineraryStop,
  LocationView,
  PlanB,
  PlanStatus,
  PreferenceCoverage,
  PriceView,
  ProductResult,
  RouteSummaryView,
  TripPace,
} from '../../product/types'
import { resultModes, type ResultMode } from '../../types'

export { EvidenceBadge, FreshnessLabel } from '../../components/results/ResultDataPrimitives'

const statusLabels: Record<PlanStatus, string> = {
  VERIFIED_DRAFT: '계획 검증 완료',
  BOOKABLE: '예약 준비 완료',
  NEEDS_USER_CHOICE: '선택이 필요해요',
  BLOCKED: '진행할 수 없는 항목이 있어요',
}

const bookingStatusLabels: Record<BookingReadiness['state'], string> = {
  ready: '예약 가능',
  'needs-check': '재확인',
  blocked: '확인 필요',
  booked: '예약 완료',
}

const bookingGroups: Array<{ id: string; filter: 'attention' | 'ready'; label: string; states: BookingReadiness['state'][] }> = [
  { id: 'attention', filter: 'attention', label: '지금 확인 필요', states: ['blocked'] },
  { id: 'recheck', filter: 'attention', label: '출발 전 재확인', states: ['needs-check'] },
  { id: 'ready', filter: 'ready', label: '예약 가능', states: ['ready', 'booked'] },
]
const formatKrw = (value: number) => `₩${value.toLocaleString('ko-KR')}`
const formatDuration = (minutes: number) => minutes < 60 ? `${minutes}분` : `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ''}`

const priceUnitLabels: Record<NonNullable<PriceView['unit']>, string> = {
  person: '1인',
  group: '그룹',
  night: '박',
  stay: '숙박',
  ticket: '티켓',
  route: '구간',
}

function compactPriceLabel(price: PriceView, includeUnit = true) {
  if (price.type === 'unknown') return { primary: '가격 확인 필요' }
  const currency = price.currency ?? 'KRW'
  const symbol = currency === 'KRW' ? '₩' : currency === 'JPY' ? '¥' : currency === 'USD' ? '$' : '€'
  const amount = (value: number) => `${symbol}${value.toLocaleString(currency === 'KRW' ? 'ko-KR' : 'en-US')}`
  const unit = includeUnit && price.unit ? ` / ${priceUnitLabels[price.unit]}` : ''
  const primary = price.rangeMin !== undefined && price.rangeMax !== undefined
    ? `${amount(price.rangeMin)}–${amount(price.rangeMax)}${unit}`
    : price.amount !== undefined ? `${amount(price.amount)}${unit}` : '가격 확인 필요'
  const converted = price.convertedKRW !== undefined && currency !== 'KRW'
    ? `약 ${formatKrw(price.convertedKRW)}`
    : price.convertedRangeMinKRW !== undefined && price.convertedRangeMaxKRW !== undefined
      ? `약 ${formatKrw(price.convertedRangeMinKRW)}–${formatKrw(price.convertedRangeMaxKRW)}`
      : undefined
  return { primary, converted }
}

type DecisionSnapshot = {
  metadata?: string
  price?: PriceView
  priceLabel?: string
  operationalStatus?: string
}

function decisionSnapshot(decision: DecisionSummary): DecisionSnapshot {
  const data = decision.travelData
  if (!data) return { metadata: decision.location ?? decision.detail, priceLabel: decision.priceLabel, operationalStatus: decision.evidence?.[0]?.stateLabel }
  if (data.kind === 'transport') return {
    metadata: [
      data.departureLocation && data.arrivalLocation ? `${data.departureTime ? `${data.departureTime} ` : ''}${data.departureLocation} → ${data.arrivalTime ? `${data.arrivalTime} ` : ''}${data.arrivalLocation}` : undefined,
      Number.isFinite(data.durationMinutes) ? formatDuration(data.durationMinutes) : undefined,
    ].filter(Boolean).join(' · ') || undefined,
    price: data.effectiveTotalPrice ?? data.baseFare,
    operationalStatus: data.inventory?.label,
  }
  if (data.kind === 'accommodation') return {
    metadata: [data.location?.area ?? data.location?.name, data.roomCombination].filter(Boolean).join(' · ') || undefined,
    price: data.nightlyPrice,
    operationalStatus: data.roomAvailability?.label,
  }
  if (data.kind === 'activity') return {
    metadata: [data.location?.area, data.openingHours, data.expectedDurationMinutes ? `예상 ${formatDuration(data.expectedDurationMinutes)}` : undefined].filter(Boolean).join(' · ') || undefined,
    price: data.ticketPrice,
    operationalStatus: data.reservation?.label,
  }
  if (data.kind === 'dining') {
    const allergySupport = data.allergySupport ?? []
    const allergy = allergySupport.find((item) => item.status !== 'confirmed') ?? allergySupport[0]
    return {
      metadata: [data.location?.area, data.openingHours].filter(Boolean).join(' · ') || undefined,
      price: data.price,
      operationalStatus: allergy ? `${allergy.label} ${allergy.status === 'confirmed' ? '확인됨' : '확인 필요'}` : data.reservation?.label,
    }
  }
  if (!data.route) return {}
  return {
    metadata: `${data.route.modeLabel} · ${formatDuration(data.route.durationMinutes)} · ${data.route.transferCount ? `환승 ${data.route.transferCount}회` : '환승 없음'}`,
    price: data.route.fare,
    operationalStatus: data.route.evidence?.stateLabel,
  }
}

function DecisionStatus({ decision, snapshot }: { decision: DecisionSummary; snapshot: DecisionSnapshot }) {
  const evidence = decision.evidence?.[0]
  const labels = [evidence?.stateLabel, snapshot.operationalStatus]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)

  if (labels.length === 0 && !evidence?.checkedLabel) return null
  return <div className="moa-decision-status" aria-label="확인 상태">
    {labels.map((label, index) => <span className={index === 0 ? `state-${evidence?.state ?? 'unknown'}` : 'state-verified'} key={label}>{label}</span>)}
    {evidence?.checkedLabel && <small><Clock />{evidence.checkedLabel}</small>}
  </div>
}

function ConditionChips({ reasons, limit = 3 }: { reasons: string[]; limit?: number }) {
  const visible = reasons.slice(0, limit)
  const remaining = Math.max(reasons.length - visible.length, 0)
  if (visible.length === 0) return <p className="moa-condition-empty">별도로 표시할 조건이 없어요.</p>
  return <ul className="moa-condition-chips">{visible.map((reason) => <li key={reason}>{reason}</li>)}{remaining > 0 && <li className="more">+{remaining} 조건</li>}</ul>
}

export function DecisionCard({ decision, index, selected, details, select }: { decision: DecisionSummary; index: number; selected: boolean; details: () => void; select: () => void }) {
  const snapshot = decisionSnapshot(decision)
  const reasons = decision.reasons ?? []
  const number = String(index + 1).padStart(2, '0')
  return (
    <article className={`moa-shared-decision-card${selected ? ' selected' : ''}`} onFocus={select}>
      <header className="moa-shared-decision-category"><span>{number} · {decision.categoryLabel}</span></header>
      <div className="moa-shared-decision-choice">
        <h3>{decision.title}</h3>
        {snapshot.metadata && <p>{snapshot.metadata}</p>}
        {snapshot.price ? <PriceDisplay price={snapshot.price} compact /> : snapshot.priceLabel && <strong>{snapshot.priceLabel}</strong>}
      </div>
      <DecisionStatus decision={decision} snapshot={snapshot} />
      {decision.summaryReason && <section className="moa-shared-decision-reason"><h4>선택 이유</h4><p>{decision.summaryReason}</p></section>}
      {reasons.length > 0 && <section className="moa-shared-decision-conditions"><h4>반영된 조건</h4><ConditionChips reasons={reasons} /></section>}
      <button type="button" className="moa-shared-decision-action" onClick={details}>결정 자세히 보기 <ArrowRight /></button>
    </article>
  )
}

function ActionSummary({ result, openBooking }: { result: ProductResult; openBooking: () => void }) {
  if (result.checksRequired === 0) {
    return <section className="moa-overview-attention clear"><CheckCircle weight="fill" /><span><small>확인 완료</small><strong>현재 확인이 필요한 항목이 없습니다.</strong></span></section>
  }

  return (
    <button type="button" className="moa-overview-attention" onClick={openBooking} aria-label={`확인 필요 ${result.checksRequired}건, 예약 탭에서 보기`}>
      <Warning weight="fill" />
      <span><small>확인 필요</small><strong>{result.checksRequired}건</strong><em>예약 전 확인이 필요한 항목이 있어요.</em></span>
      <ArrowRight />
    </button>
  )
}

export function ConcessionCard({ concession }: { concession: Concession }) {
  return <article className="moa-concession-row"><strong>{concession.participant}</strong><span>{concession.gaveUp}</span><ArrowRight /><b>{concession.received.join(' · ')}</b></article>
}

export function PreferenceCoverageCard({ coverage, concessions }: { coverage: PreferenceCoverage; concessions: Concession[] }) {
  const reflectedCount = coverage.represented.length
  return (
    <section className="moa-representation-report">
      <header><span>내 의견 반영</span><h2>{reflectedCount}가지 기준을 계획에 지켰어요.</h2></header>
      <div className="moa-representation-editorial">
        <section className="moa-represented-list"><h3>반영됨</h3><ul>{coverage.represented.map((item) => <li key={item}><Check />{item}</li>)}</ul></section>
        <section className="moa-tradeoff-report">
          <h3>조정과 보호</h3>
          {concessions.map((item) => <ConcessionCard key={item.participant} concession={item} />)}
          <dl>
            {coverage.compromised.length > 0 && <div><dt>양보</dt><dd>{coverage.compromised.join(' · ')}</dd></div>}
            {coverage.protectedInstead.length > 0 && <div><dt>대신 확보</dt><dd>{coverage.protectedInstead.join(' · ')}</dd></div>}
          </dl>
        </section>
      </div>
      {coverage.unrepresentedParticipants.map((participant) => <aside key={participant.name}><WarningCircle /><div><strong>{participant.name} · 아직 반영되지 않은 의견</strong><span>{participant.reasons.join(' · ')}</span></div></aside>)}
    </section>
  )
}

function PlanBDetailContent({ plan }: { plan: PlanB }) {
  return <div className="moa-plan-b-detail">
    {plan.weatherWarning && <p className="warning"><Warning />{plan.weatherWarning.detail}</p>}
    <ul>{plan.replacements.map((item) => <li key={item}>{item}</li>)}</ul>
    <footer><span>{plan.readinessLabel}</span><strong>{plan.budgetDeltaLabel}</strong></footer>
  </div>
}

export function PlanBCard({ plan }: { plan: PlanB }) {
  return (
    <details className="moa-plan-b-summary">
      <summary>
        <span>{plan.trigger}</span>
        <strong>{plan.title}</strong>
        <small>{plan.weatherWarning?.title ?? `${plan.replacements.length}개 일정 대체 가능`}</small>
        <b>{plan.budgetDeltaLabel}</b>
        <i>자세히 <CaretDown /></i>
      </summary>
      <PlanBDetailContent plan={plan} />
    </details>
  )
}

function DrivingCostDetail({ route }: { route: RouteSummaryView }) {
  if (!route.drivingCost) return null
  return (
    <section className="moa-route-cost-detail">
      <h5>렌터카 예상 비용</h5>
      <dl>
        <div><dt>유류비</dt><dd><PriceDisplay price={route.drivingCost.fuel} compact /></dd></div>
        <div><dt>통행료</dt><dd><PriceDisplay price={route.drivingCost.tolls} compact /></dd></div>
        <div><dt>주차</dt><dd><PriceDisplay price={route.drivingCost.parking} compact /></dd></div>
        <div className="total"><dt>예상 합계</dt><dd><PriceDisplay price={route.drivingCost.total} compact /></dd></div>
      </dl>
    </section>
  )
}

function RouteDetail({ route }: { route: RouteSummaryView }) {
  return (
    <div className="moa-route-detail">
      <dl className="moa-route-facts">
        <div><dt>구간</dt><dd>{route.origin} → {route.destination}</dd></div>
        {(route.departureTime || route.arrivalTime) && <div><dt>시간</dt><dd>{route.departureTime ?? '—'} → {route.arrivalTime ?? '—'}</dd></div>}
        {route.walkingMinutes !== undefined && <div><dt>도보</dt><dd>{route.walkingMinutes}분</dd></div>}
        {route.distanceKm !== undefined && <div><dt>거리</dt><dd>{route.distanceKm} km</dd></div>}
      </dl>
      {route.steps && route.steps.length > 0 && <ol>{route.steps.map((step) => <li key={step.id}><span>{step.mode === 'walk' ? '도보' : step.station ?? route.modeLabel}</span><strong>{step.instruction}</strong>{step.durationMinutes !== undefined && <small>{step.durationMinutes}분</small>}</li>)}</ol>}
      {route.cutoffWarning && <UncertaintyNotice message={route.cutoffWarning} />}
      {route.map && <RouteMapPreview map={route.map} origin={route.origin} destination={route.destination} />}
      {route.mapUrl && <a className="moa-route-map-link" href={route.mapUrl} target="_blank" rel="noreferrer">지도에서 경로 열기 <ArrowSquareOut /></a>}
      <DrivingCostDetail route={route} />
      <FreshnessLabel evidence={route.evidence} />
    </div>
  )
}

type DayStopView = ItineraryStop & {
  location?: LocationView
  warning?: ItineraryItemView['weatherWarning']
}

type DayLegView = ItineraryLeg & {
  id: string
  time: string
  route: RouteSummaryView
  warning?: ItineraryItemView['weatherWarning']
}

type DayAgendaEntry =
  | { kind: 'stop'; id: string; stop: DayStopView }
  | { kind: 'leg'; id: string; leg: DayLegView }

type DayAgenda = {
  stops: DayStopView[]
  legs: DayLegView[]
  entries: DayAgendaEntry[]
}

function placesMatch(first: string, second: string) {
  const normalize = (value: string) => value.replace(/[\s·→←-]/g, '').replace(/도착|출발/g, '')
  const a = normalize(first)
  const b = normalize(second)
  return a.includes(b) || b.includes(a)
}

function stopFromItem(item: ItineraryItemView): Omit<DayStopView, 'order'> {
  return {
    id: item.id,
    time: item.time,
    name: item.title,
    subtitle: item.detail,
    address: item.location?.address,
    lat: item.location?.coordinates?.latitude,
    lng: item.location?.coordinates?.longitude,
    location: item.location,
    warning: item.weatherWarning,
  }
}

function buildDayAgenda(day: ItineraryDayView): DayAgenda {
  const stops: DayStopView[] = []
  const legs: DayLegView[] = []
  const entries: DayAgendaEntry[] = []
  let currentStopId: string | undefined

  const addStop = (stop: Omit<DayStopView, 'order'>) => {
    const existing = stops.find((item) => item.id === stop.id)
    if (existing) return existing
    const orderedStop: DayStopView = { ...stop, order: stops.length + 1 }
    stops.push(orderedStop)
    entries.push({ kind: 'stop', id: orderedStop.id, stop: orderedStop })
    return orderedStop
  }

  day.items.forEach((item, index) => {
    if (!item.route) {
      const stop = addStop(stopFromItem(item))
      currentStopId = stop.id
      return
    }

    const route = item.route
    const currentStop = stops.find((stop) => stop.id === currentStopId)
    if (!currentStop || !placesMatch(currentStop.name, route.origin)) {
      currentStopId = addStop({
        id: `${item.id}-origin`,
        time: route.departureTime ?? item.time,
        name: route.origin,
        subtitle: '이동 출발',
        address: route.originLocation?.address,
        lat: route.originLocation?.coordinates?.latitude,
        lng: route.originLocation?.coordinates?.longitude,
        location: route.originLocation,
      }).id
    }

    const fromStopId = currentStopId
    if (!fromStopId) return
    const nextItem = day.items[index + 1]
    const useNextStop = nextItem && !nextItem.route && placesMatch(nextItem.title, route.destination)
    const destinationId = useNextStop ? nextItem.id : `${item.id}-destination`
    const leg: DayLegView = {
      id: item.id,
      fromStopId,
      toStopId: destinationId,
      mode: route.modeLabel,
      durationMinutes: route.durationMinutes,
      distanceMeters: route.distanceKm !== undefined ? Math.round(route.distanceKm * 1000) : undefined,
      transferCount: route.transferCount,
      fare: route.fare?.amount,
      time: item.time,
      route,
      warning: item.weatherWarning,
    }
    legs.push(leg)
    entries.push({ kind: 'leg', id: leg.id, leg })

    if (useNextStop) {
      currentStopId = destinationId
      return
    }

    currentStopId = addStop({
      id: destinationId,
      time: route.arrivalTime,
      name: route.destination,
      subtitle: item.detail ?? '이동 도착',
      address: route.destinationLocation?.address,
      lat: route.destinationLocation?.coordinates?.latitude,
      lng: route.destinationLocation?.coordinates?.longitude,
      location: route.destinationLocation,
    }).id
  })

  return { stops, legs, entries }
}

function RouteLeg({ leg }: { leg: DayLegView }) {
  const route = leg.route
  const fare = route.fare ? compactPriceLabel(route.fare, false) : undefined
  return (
    <section className="moa-agenda-leg">
      <time>{route.departureTime ?? leg.time}</time>
      <div className="moa-agenda-leg-body">
        <details>
          <summary>
            <span className="moa-leg-copy"><small>{route.modeLabel}</small><strong>{route.origin} → {route.destination}</strong><b>{formatDuration(route.durationMinutes)} · {route.transferCount ? `환승 ${route.transferCount}회` : '환승 없음'}</b></span>
            {fare && <span className="moa-leg-fare"><strong>{fare.primary}</strong>{fare.converted && <small>{fare.converted}</small>}</span>}
            <span className="moa-leg-action">경로 보기 <CaretDown /></span>
          </summary>
          <RouteDetail route={route} />
        </details>
        {leg.warning && <WeatherWarning warning={leg.warning} />}
      </div>
    </section>
  )
}

function AgendaStop({ stop, selected, onSelect }: { stop: DayStopView; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <section className={`moa-agenda-stop${selected ? ' selected' : ''}`} id={`agenda-stop-${stop.id}`}>
      <time>{stop.time ?? '—'}</time>
      <div>
        <button className="moa-agenda-stop-select" onClick={() => onSelect(stop.id)} aria-pressed={selected}>
          <span className="moa-stop-dot" aria-hidden="true" />
          <span><strong>{stop.name}</strong>{stop.subtitle && <small>{stop.subtitle}</small>}</span>
        </button>
        {stop.location && <div className="moa-agenda-place-meta">
          {stop.location.area && <span>{stop.location.area}</span>}
          {stop.location.mapUrl && <a href={stop.location.mapUrl} target="_blank" rel="noreferrer">장소 자세히 보기 <ArrowSquareOut /></a>}
        </div>}
        {stop.warning && <WeatherWarning warning={stop.warning} />}
      </div>
    </section>
  )
}

const placeholderPositions = [
  { x: 18, y: 78 },
  { x: 42, y: 59 },
  { x: 68, y: 35 },
  { x: 82, y: 67 },
  { x: 57, y: 18 },
  { x: 27, y: 31 },
]

function placeholderPosition(index: number, total: number) {
  if (total <= placeholderPositions.length) return placeholderPositions[index]
  const progress = total === 1 ? 0 : index / (total - 1)
  const angle = (-145 + progress * 290) * (Math.PI / 180)
  const radius = 31 + (index % 2) * 7
  return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius }
}

function DayMapPlaceholder({ stops, selectedStopId, onSelectStop }: { stops: DayStopView[]; selectedStopId?: string; onSelectStop: (id: string) => void }) {
  const markers = stops.map((stop, index) => ({ stop, position: placeholderPosition(index, stops.length) }))
  const points = markers.map(({ position }) => `${position.x},${position.y}`).join(' ')
  return (
    <div className="moa-day-map-placeholder">
      <span className="moa-map-zone zone-a" aria-hidden="true" />
      <span className="moa-map-zone zone-b" aria-hidden="true" />
      <span className="moa-map-zone zone-c" aria-hidden="true" />
      {markers.length > 1 && <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} /></svg>}
      {markers.map(({ stop, position }) => (
        <button
          key={stop.id}
          className={`moa-demo-map-marker${selectedStopId === stop.id ? ' selected' : ''}${position.x > 66 ? ' label-left' : ''}`}
          style={{ left: `${position.x}%`, top: `${position.y}%` }}
          onClick={() => onSelectStop(stop.id)}
          aria-label={`${stop.order}번 ${stop.name}`}
          aria-pressed={selectedStopId === stop.id}
        >
          <span>{stop.order}</span><small>{stop.name}</small>
        </button>
      ))}
      <p>일정 순서 기반 데모 · 실제 지리적 위치와 다를 수 있어요.</p>
    </div>
  )
}

type DayMapPanelProps = {
  day: ItineraryDayView
  agenda: DayAgenda
  selectedStopId?: string
  onSelectStop: (id: string) => void
}

function DayMapPanel({ day, agenda, selectedStopId, onSelectStop }: DayMapPanelProps) {
  const selectedStop = agenda.stops.find((stop) => stop.id === selectedStopId) ?? agenda.stops[0]
  const knownTravelMinutes = agenda.legs.reduce((sum, leg) => sum + (leg.durationMinutes ?? 0), 0)
  return (
    <section className="moa-day-map-panel" aria-label={`${day.dateLabel} 지도`}>
      <header><div><h3>오늘 동선</h3><span>{day.dateLabel} · {day.dayLabel}</span></div></header>
      <DayMapPlaceholder stops={agenda.stops} selectedStopId={selectedStop?.id} onSelectStop={onSelectStop} />
      <footer>
        <div><span>선택 위치</span><strong>{selectedStop ? `${selectedStop.order}. ${selectedStop.name}` : '표시할 위치 없음'}</strong></div>
        {knownTravelMinutes > 0 && <small>예상 이동 {formatDuration(knownTravelMinutes)}</small>}
      </footer>
    </section>
  )
}

function compactDateLabel(label: string) {
  const match = label.match(/(\d+)월\s*(\d+)일/)
  return match ? `${match[1].padStart(2, '0')}.${match[2].padStart(2, '0')}` : label
}

function Itinerary({ result }: { result: ProductResult }) {
  const [mobileMapOpen, setMobileMapOpen] = useState(false)
  const [selectedDayId, setSelectedDayId] = useState(result.itinerary[0]?.id ?? '')
  const [selectedStopId, setSelectedStopId] = useState<string>()
  const selectedDay = result.itinerary.find((day) => day.id === selectedDayId) ?? result.itinerary[0]
  const agenda = useMemo<DayAgenda>(() => selectedDay ? buildDayAgenda(selectedDay) : { stops: [], legs: [], entries: [] }, [selectedDay])

  useEffect(() => {
    const firstDayId = result.itinerary[0]?.id
    if (firstDayId && !result.itinerary.some((day) => day.id === selectedDayId)) setSelectedDayId(firstDayId)
  }, [result.itinerary, selectedDayId])

  useEffect(() => {
    const firstStopId = agenda.stops[0]?.id
    if (firstStopId && !agenda.stops.some((stop) => stop.id === selectedStopId)) setSelectedStopId(firstStopId)
    if (!firstStopId && selectedStopId) setSelectedStopId(undefined)
  }, [agenda, selectedStopId])

  if (!selectedDay) return <div className="moa-result-empty"><CalendarBlank /><strong>상세 일정 정보가 아직 없어요.</strong><span>여행 데이터가 연결되면 날짜별 날씨와 이동 경로를 여기에서 확인할 수 있어요.</span></div>

  const travelMinutes = agenda.legs.reduce((sum, leg) => sum + (leg.durationMinutes ?? 0), 0)
  const selectDay = (day: ItineraryDayView) => {
    const nextAgenda = buildDayAgenda(day)
    setSelectedDayId(day.id)
    setSelectedStopId(nextAgenda.stops[0]?.id)
  }

  return (
    <div className="moa-selected-day-workspace">
      <nav className="moa-day-navigation" aria-label="여행 날짜 선택">
        {result.itinerary.map((day) => <button key={day.id} onClick={() => selectDay(day)} className={selectedDay.id === day.id ? 'active' : ''} aria-pressed={selectedDay.id === day.id}><span>{compactDateLabel(day.dateLabel)}</span><strong>{day.dayLabel}</strong></button>)}
      </nav>
      <article className="moa-agenda-day">
        <header>
          <div><span>{selectedDay.dateLabel} · {selectedDay.dayLabel}</span><h3>{selectedDay.title}</h3></div>
          <p>{selectedDay.weather && <><strong>{selectedDay.weather.temperatureMinC}–{selectedDay.weather.temperatureMaxC}°C</strong> · {selectedDay.weather.condition}</>}{travelMinutes > 0 && <><i>·</i> 이동 {formatDuration(travelMinutes)}</>}</p>
        </header>
          <details className="moa-mobile-day-map" open={mobileMapOpen} onToggle={(event) => setMobileMapOpen(event.currentTarget.open)}>
            <summary><MapPin />오늘 동선 지도 보기 <ArrowRight /></summary>
            {mobileMapOpen && <DayMapPanel day={selectedDay} agenda={agenda} selectedStopId={selectedStopId} onSelectStop={setSelectedStopId} />}
          </details>
          <div className="moa-agenda-items">
            {agenda.entries.map((entry) => entry.kind === 'leg'
              ? <RouteLeg key={entry.id} leg={entry.leg} />
              : <AgendaStop key={entry.id} stop={entry.stop} selected={selectedStopId === entry.stop.id} onSelect={setSelectedStopId} />)}
          </div>
      </article>
    </div>
  )
}

export function BookingReadinessCard({ booking }: { booking: BookingReadiness }) {
  const hasActionContent = (booking.price && booking.price.type !== 'unknown')
    || booking.priceLabel
    || booking.evidence
    || booking.freshness
    || booking.availabilityLabel
    || (booking.actionLabel && booking.externalUrl)
  return (
    <article className={`moa-booking-row state-${booking.state}`}>
      <div className="moa-booking-row-copy">
        <header><span>{booking.category}</span><strong>{bookingStatusLabels[booking.state]}</strong></header>
        <h3>{booking.title}</h3>
        {booking.detail && <p className="moa-booking-detail">{booking.detail}</p>}
        {booking.note && <p>{booking.note}</p>}
        {booking.checkItems && booking.checkItems.length > 0 && <div className="moa-booking-checks"><span>확인할 것</span><strong>{booking.checkItems.join(' · ')}</strong></div>}
        {booking.followUpLabel && <p className="moa-booking-follow-up">{booking.followUpLabel}</p>}
      </div>
      {hasActionContent && <div className="moa-booking-row-action">
        {booking.price && booking.price.type !== 'unknown' ? <div className="moa-booking-price-block">{booking.price.type === 'estimated' && <span>예상 가격</span>}<PriceDisplay price={booking.price} compact /></div> : booking.priceLabel && <strong>{booking.priceLabel}</strong>}
        <div className="moa-booking-meta">
          {booking.evidence && <><span className={`moa-evidence-badge state-${booking.evidence.state}`}>{booking.evidence.stateLabel}</span><FreshnessLabel evidence={booking.evidence} /></>}
          {booking.availabilityLabel && <span>{booking.availabilityLabel}</span>}
          {!booking.evidence && booking.freshness && <small><Clock />{booking.freshness}</small>}
        </div>
        {booking.actionLabel && booking.externalUrl && <a href={booking.externalUrl} target="_blank" rel="noreferrer">{booking.actionLabel}<ArrowSquareOut /></a>}
      </div>}
    </article>
  )
}

function BookingChecklist({ result }: { result: ProductResult }) {
  const attentionCount = result.bookings.filter((item) => item.state === 'blocked' || item.state === 'needs-check').length
  const readyCount = result.bookings.filter((item) => item.state === 'ready' || item.state === 'booked').length
  const preferredFilter: 'attention' | 'ready' = attentionCount > 0 || readyCount === 0 ? 'attention' : 'ready'
  const [activeFilter, setActiveFilter] = useState<'attention' | 'ready'>(preferredFilter)
  useEffect(() => setActiveFilter(preferredFilter), [preferredFilter])
  const visibleGroups = bookingGroups.flatMap((group) => {
    if (group.filter !== activeFilter) return []
    const items = result.bookings.filter((item) => group.states.includes(item.state))
    return items.length > 0 ? [{ ...group, items }] : []
  })
  const showOtherFilter = activeFilter === 'attention' ? readyCount > 0 : attentionCount > 0
  return (
    <div className="moa-booking-checklist">
      <section className="moa-booking-totals" aria-label="예약 준비 요약">
        <button type="button" aria-pressed={activeFilter === 'attention'} onClick={() => setActiveFilter('attention')}><span>확인 필요</span></button>
        <button type="button" aria-pressed={activeFilter === 'ready'} onClick={() => setActiveFilter('ready')}><span>예약 가능</span></button>
      </section>
      <div className="moa-booking-filter-results" aria-live="polite">{visibleGroups.length > 0 ? visibleGroups.map((group) => <section className={`moa-booking-group group-${group.id}`} key={group.id}><header><h3>{group.label}</h3></header><div>{group.items.map((item) => <BookingReadinessCard key={item.id} booking={item} />)}</div></section>) : <div className="moa-booking-filter-empty"><strong>{result.bookings.length === 0 ? '예약 준비 항목이 아직 없어요.' : activeFilter === 'attention' ? '지금 확인이 필요한 항목이 없어요.' : '바로 예약 가능한 항목이 아직 없어요.'}</strong>{showOtherFilter && <button type="button" onClick={() => setActiveFilter(activeFilter === 'attention' ? 'ready' : 'attention')}>{activeFilter === 'attention' ? '예약 가능 보기' : '확인 필요 보기'} <ArrowRight /></button>}</div>}</div>
    </div>
  )
}

function DecisionTimeline({ decisions, selectedDecisionId, selectDecision, openDecision }: { decisions: DecisionSummary[]; selectedDecisionId?: string; selectDecision: (id: string) => void; openDecision: (id: string) => void }) {
  if (decisions.length === 0) return <div className="moa-result-empty"><strong>아직 확정된 결정이 없어요.</strong><span>여행 조건을 확인한 뒤 결과를 다시 불러와 주세요.</span></div>
  return (
    <ol className="moa-decision-timeline">
      {decisions.map((item, index) => (
        <li className={item.id === selectedDecisionId ? 'current' : ''} key={item.id}>
          <button type="button" className="moa-decision-timeline-marker" onClick={() => selectDecision(item.id)} aria-current={item.id === selectedDecisionId ? 'step' : undefined} aria-label={`${index + 1}. ${item.categoryLabel} 결정 선택`}>
            <span>{String(index + 1).padStart(2, '0')}</span><i aria-hidden="true" />
          </button>
          <DecisionCard decision={item} index={index} selected={item.id === selectedDecisionId} select={() => selectDecision(item.id)} details={() => openDecision(item.id)} />
        </li>
      ))}
    </ol>
  )
}

function ResultSectionHeader({ title, description, eyebrow, mobileDescription }: { title: string; description?: string; eyebrow?: string; mobileDescription?: string }) {
  return <header className="moa-results-section-header">{eyebrow && <span>{eyebrow}</span>}<h2>{title}</h2>{description && <p>{mobileDescription ? <><span className="moa-copy-desktop">{description}</span><span className="moa-copy-mobile">{mobileDescription}</span></> : description}</p>}</header>
}

const paceOverviewLabels: Record<TripPace['label'], string> = {
  '여유롭게': '여유 일정',
  '균형 있게': '균형 일정',
  '알차게': '알찬 일정',
}

function OverviewGlanceRow({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <article className="moa-overview-glance-row"><span aria-hidden="true">{icon}</span><div><strong>{title}</strong><p>{detail}</p></div></article>
}

function compactPlanBLabel(result: ProductResult, plan: PlanB) {
  const affectedDay = result.itinerary.find((day) => plan.trigger.includes(day.dateLabel))
  const compactDate = affectedDay?.dateLabel.replace(/(\d+)월\s*(\d+)일/, '$1/$2')
  const trigger = compactDate
    ? `${compactDate} ${affectedDay?.weather?.condition.includes('비') ? '비 예보' : plan.weatherWarning?.title ?? '일정 변경 가능'}`
    : plan.trigger
  const alternative = plan.title.includes('실내') ? '실내 대안 준비' : `${plan.title} 준비`
  return `${trigger} · ${alternative}`
}

function OverviewDetailSheet({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = 'moa-overview-detail-title'

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())
    const focusSelector = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusSelector)).filter((element) => {
        const style = window.getComputedStyle(element)
        return !element.hidden && element.getAttribute('aria-hidden') !== 'true' && style.display !== 'none' && style.visibility !== 'hidden'
      })
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousBodyOverflow
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [close])

  return <div className="moa-overview-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <div ref={dialogRef} className="moa-overview-detail-sheet moa-results-theme" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <div className="moa-overview-detail-toolbar"><h2 id={titleId}>{title}</h2><button ref={closeButtonRef} onClick={close}><X />닫기</button></div>
      <div className="moa-overview-detail-body">{children}</div>
    </div>
  </div>
}

function Overview({ result, pace, openBooking, openSchedule, openDecisions }: { result: ProductResult; pace: TripPace; openBooking: () => void; openSchedule: () => void; openDecisions: () => void }) {
  const [detail, setDetail] = useState<'coverage' | 'plan-b' | null>(null)
  const flightDecision = result.decisions.find((item) => item.travelData?.kind === 'transport' && item.travelData.mode === 'flight') ?? result.decisions.find((item) => item.category === 'transport')
  const accommodationDecision = result.decisions.find((item) => item.travelData?.kind === 'accommodation') ?? result.decisions.find((item) => item.category === 'stay')
  const flight = flightDecision?.travelData?.kind === 'transport' ? flightDecision.travelData : undefined
  const accommodation = accommodationDecision?.travelData?.kind === 'accommodation' ? accommodationDecision.travelData : undefined
  const flightTitle = flight ? [flight.operator, flight.serviceNumber].filter(Boolean).join(' ') : flightDecision?.title ?? '항공 정보 확인 중'
  const flightDetail = flight ? `${flight.departureTime} ${flight.departureLocation} → ${flight.arrivalTime} ${flight.arrivalLocation}` : flightDecision?.location ?? flightDecision?.detail ?? '항공 정보를 확인하고 있어요.'
  const accommodationTitle = accommodation ? [accommodation.location?.area, accommodation.name].filter(Boolean).join(' · ') : accommodationDecision?.title ?? '숙소 정보 확인 중'
  const accommodationDetail = accommodation?.roomCombination ?? accommodationDecision?.detail ?? '숙소 정보를 확인하고 있어요.'
  const reflectedCount = result.coverage.represented.length
  const concessionCount = result.coverage.compromised.length
  const primaryPlanB = result.planB[0]

  return (
    <div className="moa-overview-workspace">
      <ActionSummary result={result} openBooking={openBooking} />
      <section className="moa-overview-glance" aria-labelledby="moa-overview-glance-title">
        <h2 id="moa-overview-glance-title">여행 한눈에</h2>
        <div className="moa-overview-glance-list">
          <OverviewGlanceRow icon={<Airplane />} title={flightTitle} detail={flightDetail} />
          <OverviewGlanceRow icon={<Bed />} title={accommodationTitle} detail={accommodationDetail} />
          <OverviewGlanceRow icon={<CalendarBlank />} title={paceOverviewLabels[pace.label]} detail={`${result.duration} · 주요 일정 ${pace.coreAnchorsPerDay}개 / day`} />
        </div>
        <button type="button" className="moa-overview-full-plan" onClick={openSchedule}>전체 계획 보기 <ArrowRight /></button>
      </section>
      <div className="moa-overview-index">
        <button type="button" onClick={() => setDetail('coverage')} aria-haspopup="dialog"><span><small>내 의견</small><strong>{reflectedCount}개 반영 · {concessionCount}개 양보</strong></span><ArrowRight /></button>
        {primaryPlanB && <button type="button" onClick={() => setDetail('plan-b')} aria-haspopup="dialog"><span><small>Plan B</small><strong>{compactPlanBLabel(result, primaryPlanB)}</strong></span><ArrowRight /></button>}
        <button type="button" className="moa-overview-decisions-link" onClick={openDecisions}><strong>결정 과정 보기</strong><ArrowRight /></button>
      </div>
      {detail === 'coverage' && <OverviewDetailSheet title="내 의견" close={() => setDetail(null)}><PreferenceCoverageCard coverage={result.coverage} concessions={result.concessions} /></OverviewDetailSheet>}
      {detail === 'plan-b' && <OverviewDetailSheet title="Plan B" close={() => setDetail(null)}><div className="moa-overview-plan-details">{result.planB.map((plan) => <article key={plan.id}><header><span>{plan.trigger}</span><h3>{plan.title}</h3><p>{plan.weatherWarning?.title ?? `${plan.replacements.length}개 일정 대체 가능`}</p></header><PlanBDetailContent plan={plan} /></article>)}</div></OverviewDetailSheet>}
    </div>
  )
}

function TripHeader({ result, mode, setMode, back }: { result: ProductResult; mode: ResultMode; setMode: (mode: ResultMode) => void; back: () => void }) {
  return (
    <>
      <header className="moa-trip-header">
        <div className="moa-results-frame">
          <div className="moa-results-tools"><button onClick={back}><ArrowLeft />여행 방</button></div>
          <section className="moa-trip-plan-hero" aria-labelledby="moa-result-destination">
            {result.destinationImage && <img className="moa-trip-plan-hero-image" src={result.destinationImage} alt={`${result.destination} 여행지 풍경`} onError={(event) => { event.currentTarget.hidden = true }} />}
            <span className="moa-trip-plan-hero-overlay" aria-hidden="true" />
            <div className="moa-result-hero-copy">
              <span>FINAL TRIP PLAN</span>
              <h1 id="moa-result-destination">{result.destination}</h1>
              <p>{result.dateRange} · {result.duration} · {result.participantCount}명</p>
              <small>{statusLabels[result.status]}</small>
            </div>
            <div className="moa-trip-summary-card" aria-label="여행 핵심 정보">
              <dl>
                <div><dt>예상 비용</dt><dd>{formatKrw(result.budgetPerPerson)}<small>/ 1인</small></dd></div>
                <div><dt>숙소 기준</dt><dd>{result.stayArea} 숙박</dd></div>
              </dl>
              <button type="button" onClick={() => setMode('booking')} aria-label={`확인이 필요한 항목 ${result.checksRequired}건, 예약 탭에서 보기`}><span>확인이 필요한 항목</span><strong>{result.checksRequired}건</strong><ArrowRight /></button>
            </div>
          </section>
        </div>
      </header>
      <nav className="moa-product-tabs" aria-label="결과 보기"><div className="moa-results-frame">{resultModes.map((item) => <button key={item.id} className={mode === item.id ? 'active' : ''} aria-current={mode === item.id ? 'page' : undefined} onClick={() => setMode(item.id)}><span>{item.label}{item.id === 'booking' && result.checksRequired > 0 ? ` ${result.checksRequired}` : ''}</span></button>)}</div></nav>
    </>
  )
}

export function ProductResults({ result, pace, mode, setMode, back, decision, selectedDecisionId, selectDecision }: { result: ProductResult; pace: TripPace; mode: ResultMode; setMode: (mode: ResultMode) => void; back: () => void; decision: (id: string) => void; reopen: (id: string) => void; selectedDecisionId?: string; selectDecision: (id: string) => void }) {
  return (
    <div className="moa-product-results">
      <TripHeader result={result} mode={mode} setMode={setMode} back={back} />
      <div className="moa-product-result-content">
        {mode === 'overview' && <Overview result={result} pace={pace} openBooking={() => setMode('booking')} openSchedule={() => setMode('schedule')} openDecisions={() => setMode('decisions')} />}
        {mode === 'schedule' && <section className="moa-results-section first moa-schedule-section"><ResultSectionHeader title="일정" description="날짜별 동선과 이동을 빠르게 확인하세요." /><Itinerary result={result} /></section>}
        {mode === 'booking' && <section className="moa-results-section first moa-booking-section"><ResultSectionHeader eyebrow="출발 전 할 일" title="예약 준비" description="지금 확인하거나 예약해야 할 항목만 모았어요." /><BookingChecklist result={result} /></section>}
        {mode === 'decisions' && <section className="moa-results-section first moa-decisions-section"><ResultSectionHeader title="결정 과정" description="MOA가 어떤 선택을 했고 무엇이 영향을 줬는지 보여드려요." /><DecisionTimeline decisions={result.decisions} selectedDecisionId={selectedDecisionId} selectDecision={selectDecision} openDecision={decision} /></section>}
      </div>
    </div>
  )
}

const dialogFocusSelector = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function DecisionDetail({ decision, index = 0, back, reopen, replay, mobileSheet = false }: { decision: DecisionSummary; index?: number; back: () => void; reopen: () => void; replay: () => void; mobileSheet?: boolean }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const sheetDragStartY = useRef<number | null>(null)
  const ignoreNextHandleClick = useRef(false)
  const [sheetExpanded, setSheetExpanded] = useState(false)
  const titleId = `moa-decision-title-${decision.id}`
  const descriptionId = `moa-decision-description-${decision.id}`
  const reasons = decision.reasons ?? []
  const rejectedCandidates = decision.rejectedCandidates ?? []
  const evidenceItems = decision.evidence ?? []
  const primaryAction = (() => {
    const data = decision.travelData
    if (!data || data.kind === 'route') return undefined
    if (data.kind === 'activity') return { href: data.bookingUrl, label: '티켓·운영 정보 확인' }
    if (data.kind === 'dining') return { href: data.bookingUrl, label: '예약 가능 여부 확인' }
    return { href: data.bookingUrl, label: '예약처에서 확인' }
  })()

  useEffect(() => setSheetExpanded(false), [decision.id, mobileSheet])

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        back()
        return
      }
      if (event.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(dialogFocusSelector))
        .filter((element) => {
          const style = window.getComputedStyle(element)
          return !element.hidden && element.getAttribute('aria-hidden') !== 'true' && style.display !== 'none' && style.visibility !== 'hidden'
        })
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousBodyOverflow
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [back])

  const finishSheetDrag = (endY: number) => {
    if (sheetDragStartY.current === null) return
    const distance = endY - sheetDragStartY.current
    sheetDragStartY.current = null
    if (Math.abs(distance) < 28) return
    ignoreNextHandleClick.current = true
    window.requestAnimationFrame(() => { ignoreNextHandleClick.current = false })
    if (distance < -36) {
      setSheetExpanded(true)
      return
    }
    if (distance > 52) {
      if (sheetExpanded) setSheetExpanded(false)
      else back()
    }
  }

  return (
    <div className="moa-decision-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) back() }}>
      <div
        className={`moa-decision-detail-page moa-results-theme is-unified-decision${mobileSheet ? ' mobile-decision-sheet' : ''}${mobileSheet && sheetExpanded ? ' is-expanded' : ''}`}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={decision.detail ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className="moa-decision-detail-toolbar">
          {mobileSheet && <button
            type="button"
            className="moa-decision-sheet-handle"
            aria-expanded={sheetExpanded}
            aria-label={sheetExpanded ? '결정 상세 시트를 반 높이로 축소' : '결정 상세 시트를 화면 가까이 펼치기'}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              sheetDragStartY.current = event.clientY
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerUp={(event) => finishSheetDrag(event.clientY)}
            onPointerCancel={() => { sheetDragStartY.current = null }}
            onClick={() => {
              if (ignoreNextHandleClick.current) return
              setSheetExpanded((expanded) => !expanded)
            }}
          ><span aria-hidden="true" /></button>}
          <button ref={closeButtonRef} className="moa-decision-detail-close" onClick={back}><X />닫기</button>
        </div>
        <header><span>{String(index + 1).padStart(2, '0')} · {decision.categoryLabel}</span><h1 id={titleId}>{decision.title}</h1>{decision.detail && <p id={descriptionId}>{decision.detail}</p>}</header>
        <div className="moa-unified-detail-composition">
          {decision.travelData && <TravelDecisionContent data={decision.travelData} showPrimaryAction={false} />}
          {(decision.summaryReason || reasons.length > 0) && <div className="moa-unified-why-conditions">
            {decision.summaryReason && <section className="moa-decision-rationale"><h2>선택 이유</h2><p>{decision.summaryReason}</p></section>}
            {reasons.length > 0 && <section className="moa-decision-constraints"><h2>반영된 조건</h2><ConditionChips reasons={reasons} limit={reasons.length} /></section>}
          </div>}
          <div className="moa-unified-detail-actions">
            {primaryAction && <DecisionPrimaryLink href={primaryAction.href}>{primaryAction.label}</DecisionPrimaryLink>}
            <button className="moa-reopen-decision" onClick={reopen}>이 결정 다시 논의하기 <ArrowRight /></button>
          </div>
          {rejectedCandidates.length > 0 && <details className="moa-unified-secondary-disclosure"><summary>비교한 다른 후보 <span>{rejectedCandidates.length}</span><CaretDown /></summary><div className="moa-rejected-list">{rejectedCandidates.map((candidate) => <article className={`moa-rejected ${candidate.hardConstraintConflict ? 'critical' : ''}`} key={candidate.id}><span aria-hidden="true" /><div><strong>{candidate.title}</strong>{candidate.reason && <p>{candidate.reason}</p>}</div></article>)}</div></details>}
          {evidenceItems.length > 0 && <details className="moa-decision-evidence-disclosure"><summary>상세 근거 보기 <CaretDown /></summary><div>{evidenceItems.map((evidence) => <article className="moa-evidence-row" key={evidence.id}><header><strong>{evidence.label}</strong><span>{evidence.stateLabel}</span></header>{evidence.value && <p>{evidence.value}</p>}{evidence.checkedLabel && <small>{evidence.checkedLabel}</small>}{evidence.uncertainty && <UncertaintyNotice message={evidence.uncertainty} safety={decision.category === 'dining'} />}<SourceDetail evidence={evidence} /></article>)}</div></details>}
          <button className="moa-decision-replay moa-unified-replay" onClick={replay}><PlayCircle />전체 회의 기록 보기</button>
        </div>
      </div>
    </div>
  )
}
