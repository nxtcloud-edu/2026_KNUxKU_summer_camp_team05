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
  Prohibit,
  Warning,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import {
  FreshnessLabel,
  LocationSummary,
  PriceDisplay,
  RouteMapPreview,
  SourceDetail,
  UncertaintyNotice,
  WeatherWarning,
} from '../../components/results/ResultDataPrimitives'
import { TravelDecisionContent } from '../../components/results/TravelDecisionCards'
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

const bookingGroupLabels: Record<BookingReadiness['state'], string> = {
  ready: '예약 가능',
  'needs-check': '다시 확인',
  blocked: '정보 필요',
  booked: '예약 완료',
}

const bookingGroupOrder: BookingReadiness['state'][] = ['blocked', 'needs-check', 'ready', 'booked']
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

function compactPriceLabel(price: PriceView) {
  if (price.type === 'unknown') return { primary: '가격 확인 필요' }
  const currency = price.currency ?? 'KRW'
  const symbol = currency === 'KRW' ? '₩' : currency === 'JPY' ? '¥' : currency === 'USD' ? '$' : '€'
  const amount = (value: number) => `${symbol}${value.toLocaleString(currency === 'KRW' ? 'ko-KR' : 'en-US')}`
  const unit = price.unit ? ` / ${priceUnitLabels[price.unit]}` : ''
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
  metadata: string
  price?: PriceView
  priceLabel?: string
  operationalStatus?: string
}

function decisionSnapshot(decision: DecisionSummary): DecisionSnapshot {
  const data = decision.travelData
  if (!data) return { metadata: decision.location ?? decision.detail, priceLabel: decision.priceLabel, operationalStatus: decision.evidence[0]?.stateLabel }
  if (data.kind === 'transport') return {
    metadata: `${data.departureTime} ${data.departureLocation} → ${data.arrivalTime} ${data.arrivalLocation} · ${formatDuration(data.durationMinutes)}`,
    price: data.effectiveTotalPrice ?? data.baseFare,
    operationalStatus: data.inventory?.label,
  }
  if (data.kind === 'accommodation') return {
    metadata: `${data.location.area ?? data.location.name} · ${data.roomCombination}`,
    price: data.nightlyPrice,
    operationalStatus: data.roomAvailability.label,
  }
  if (data.kind === 'activity') return {
    metadata: [data.location.area, data.openingHours, data.expectedDurationMinutes ? `예상 ${formatDuration(data.expectedDurationMinutes)}` : undefined].filter(Boolean).join(' · '),
    price: data.ticketPrice,
    operationalStatus: data.reservation?.label,
  }
  if (data.kind === 'dining') {
    const allergy = data.allergySupport.find((item) => item.status !== 'confirmed') ?? data.allergySupport[0]
    return {
      metadata: [data.location.area, data.openingHours].filter(Boolean).join(' · '),
      price: data.price,
      operationalStatus: allergy ? `${allergy.label} ${allergy.status === 'confirmed' ? '확인됨' : '확인 필요'}` : data.reservation?.label,
    }
  }
  return {
    metadata: `${data.route.modeLabel} · ${formatDuration(data.route.durationMinutes)} · ${data.route.transferCount ? `환승 ${data.route.transferCount}회` : '환승 없음'}`,
    price: data.route.fare,
    operationalStatus: data.route.evidence?.stateLabel,
  }
}

function decisionStateLine(decision: DecisionSummary, snapshot: DecisionSnapshot) {
  const evidenceState = decision.evidence[0]?.stateLabel
  return [evidenceState, snapshot.operationalStatus].filter((value, index, values) => value && values.indexOf(value) === index).join(' · ')
}

export function DecisionCard({ decision, details }: { decision: DecisionSummary; details: () => void; reopen?: () => void }) {
  const snapshot = decisionSnapshot(decision)
  const stateLine = decisionStateLine(decision, snapshot)
  return (
    <article className="moa-decision-row">
      <div className="moa-decision-category"><span>{decision.categoryLabel}</span>{stateLine && <small>{stateLine}</small>}</div>
      <div className="moa-decision-choice">
        <h3>{decision.title}</h3>
        <p>{snapshot.metadata}</p>
        {snapshot.price ? <PriceDisplay price={snapshot.price} compact /> : snapshot.priceLabel && <strong>{snapshot.priceLabel}</strong>}
      </div>
      <div className="moa-decision-why"><span>선택 이유</span><p>{decision.summaryReason}</p></div>
      <button className="moa-row-action" onClick={details}>자세히 <ArrowRight /></button>
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
  const fare = route.fare ? compactPriceLabel(route.fare) : undefined
  return (
    <section className="moa-agenda-leg">
      <time>{route.departureTime ?? leg.time}</time>
      <div className="moa-agenda-leg-body">
        <details>
          <summary>
            <span className="moa-leg-line" aria-hidden="true">↓</span>
            <span className="moa-leg-copy"><strong>{route.modeLabel} · {formatDuration(route.durationMinutes)} · {route.transferCount ? `환승 ${route.transferCount}회` : '환승 없음'}</strong><small>{route.origin} → {route.destination}</small></span>
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
          <span className="moa-stop-number" aria-hidden="true">{stop.order}</span>
          <span><strong>{stop.name}</strong>{stop.subtitle && <small>{stop.subtitle}</small>}</span>
        </button>
        {stop.location && <LocationSummary location={stop.location} />}
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
      <header><div><h3>지도</h3><span>{day.dateLabel} · {day.dayLabel}</span></div><small>DEMO</small></header>
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

function useDesktopDayMap() {
  const [isDesktop, setIsDesktop] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 981px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(min-width: 981px)')
    const update = () => setIsDesktop(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return isDesktop
}

function Itinerary({ result }: { result: ProductResult }) {
  const isDesktopMap = useDesktopDayMap()
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
      <div className="moa-agenda-layout">
        <article className="moa-agenda-day">
          <header>
            <div><span>{selectedDay.dateLabel} · {selectedDay.dayLabel}</span><h3>{selectedDay.title}</h3></div>
            <p>{selectedDay.weather && <><strong>{selectedDay.weather.temperatureMinC}–{selectedDay.weather.temperatureMaxC}°C</strong> · {selectedDay.weather.condition}{selectedDay.weather.precipitationProbability !== undefined && ` ${selectedDay.weather.precipitationProbability}%`}</>}{travelMinutes > 0 && <><i>·</i> 이동 {formatDuration(travelMinutes)}</>}</p>
          </header>
          {!isDesktopMap && <details className="moa-mobile-day-map" open={mobileMapOpen} onToggle={(event) => setMobileMapOpen(event.currentTarget.open)}>
            <summary><MapPin />지도 보기 <CaretDown /></summary>
            {mobileMapOpen && <DayMapPanel day={selectedDay} agenda={agenda} selectedStopId={selectedStopId} onSelectStop={setSelectedStopId} />}
          </details>}
          <div className="moa-agenda-items">
            {agenda.entries.map((entry) => entry.kind === 'leg'
              ? <RouteLeg key={entry.id} leg={entry.leg} />
              : <AgendaStop key={entry.id} stop={entry.stop} selected={selectedStopId === entry.stop.id} onSelect={setSelectedStopId} />)}
          </div>
        </article>
        {isDesktopMap && <aside className="moa-desktop-day-map"><DayMapPanel day={selectedDay} agenda={agenda} selectedStopId={selectedStopId} onSelectStop={setSelectedStopId} /></aside>}
      </div>
    </div>
  )
}

function BookingStateIcon({ state }: { state: BookingReadiness['state'] }) {
  if (state === 'ready' || state === 'booked') return <CheckCircle weight="fill" />
  if (state === 'blocked') return <Prohibit weight="fill" />
  return <Warning weight="fill" />
}

export function BookingReadinessCard({ booking }: { booking: BookingReadiness }) {
  return (
    <article className={`moa-booking-row state-${booking.state}`}>
      <BookingStateIcon state={booking.state} />
      <div className="moa-booking-row-copy">
        <span>{booking.category}</span><h3>{booking.title}</h3><p>{booking.note}</p>
        <div className="moa-booking-meta"><strong>{booking.stateLabel}</strong>{booking.evidence ? <FreshnessLabel evidence={booking.evidence} /> : booking.freshness && <small><Clock />{booking.freshness}</small>}</div>
      </div>
      <div className="moa-booking-row-action">
        {booking.price ? <PriceDisplay price={booking.price} compact /> : booking.priceLabel && <strong>{booking.priceLabel}</strong>}
        {booking.actionLabel && booking.externalUrl && <a href={booking.externalUrl} target="_blank" rel="noreferrer">{booking.actionLabel}<ArrowSquareOut /></a>}
      </div>
    </article>
  )
}

function BookingChecklist({ result }: { result: ProductResult }) {
  const actionCount = result.bookings.filter((item) => item.state === 'blocked' || item.state === 'needs-check').length
  const readyCount = result.bookings.filter((item) => item.state === 'ready').length
  const bookedCount = result.bookings.filter((item) => item.state === 'booked').length
  return (
    <div className="moa-booking-checklist">
      <div className="moa-booking-totals"><strong>{actionCount}건 확인 필요</strong><span>{readyCount}건 예약 가능{bookedCount > 0 && ` · ${bookedCount}건 완료`}</span></div>
      {bookingGroupOrder.map((state) => {
        const items = result.bookings.filter((item) => item.state === state)
        if (items.length === 0) return null
        return <section key={state}><header><h3>{bookingGroupLabels[state]}</h3><span>{items.length}건</span></header>{items.map((item) => <BookingReadinessCard key={item.id} booking={item} />)}</section>
      })}
    </div>
  )
}

function DecisionLog({ decisions, openDecision }: { decisions: DecisionSummary[]; openDecision: (id: string) => void }) {
  return (
    <ol className="moa-decision-log">
      {decisions.map((item, index) => (
        <li key={item.id}>
          <span className="moa-decision-number">{String(index + 1).padStart(2, '0')}</span>
          <article>
            <div className="moa-audit-decision"><span>{item.categoryLabel}</span><h3>{item.title}</h3><small>{item.evidence[0] ? `${item.evidence[0].stateLabel} · ${item.evidence[0].checkedLabel}` : '근거 정보 없음'}</small></div>
            <div className="moa-audit-reason"><span>선택 이유</span><p>{item.summaryReason}</p></div>
            <div className="moa-audit-basis"><span>반영 조건</span><p>{item.reasons.slice(0, 2).join(' · ')}{item.reasons.length > 2 && ` 외 ${item.reasons.length - 2}`}</p>{item.rejectedCandidates.length > 0 && <details><summary>제외 후보 {item.rejectedCandidates.length}<CaretDown /></summary><ul>{item.rejectedCandidates.map((candidate) => <li key={candidate.id}><strong>{candidate.title}</strong><span>{candidate.reason}</span></li>)}</ul></details>}</div>
            <button className="moa-row-action" onClick={() => openDecision(item.id)}>결정 자세히 <ArrowRight /></button>
          </article>
        </li>
      ))}
    </ol>
  )
}

function DecisionSectionSummary({ decision, index, openDecision }: { decision: DecisionSummary; index: number; openDecision: (id: string) => void }) {
  const snapshot = decisionSnapshot(decision)
  const stateLine = decisionStateLine(decision, snapshot)
  const freshness = decision.evidence[0]?.checkedLabel
  const visibleReasons = decision.reasons.slice(0, 2)
  const remainingReasonCount = Math.max(decision.reasons.length - visibleReasons.length, 0)
  const summaryTitleId = `moa-mobile-decision-heading-${decision.id}`

  return (
    <article className="moa-mobile-decision-summary" id="moa-mobile-decision-summary" aria-labelledby={summaryTitleId} aria-live="polite">
      <header>
        <span>{String(index + 1).padStart(2, '0')}</span>
        <h3 id={summaryTitleId}>{decision.categoryLabel}</h3>
      </header>
      <div className="moa-mobile-decision-choice">
        <h4>{decision.title}</h4>
        <p>{snapshot.metadata}</p>
        {snapshot.price ? <PriceDisplay price={snapshot.price} compact /> : snapshot.priceLabel && <strong>{snapshot.priceLabel}</strong>}
        {(stateLine || freshness) && <div className="moa-mobile-decision-state">{stateLine && <span>{stateLine}</span>}{freshness && <small><Clock />{freshness}</small>}</div>}
      </div>
      <section className="moa-mobile-decision-reason">
        <h4>선택 이유</h4>
        <p>{decision.summaryReason}</p>
      </section>
      <section className="moa-mobile-decision-conditions">
        <h4>반영된 조건</h4>
        {visibleReasons.length > 0 ? <ul>{visibleReasons.map((reason, reasonIndex) => <li key={`${decision.id}-reason-${reasonIndex}`}>{reason}</li>)}</ul> : <p>별도로 반영된 조건이 없습니다.</p>}
        {remainingReasonCount > 0 && <small>외 {remainingReasonCount}개</small>}
      </section>
      <div className="moa-mobile-decision-footer">
        <button className="moa-mobile-decision-detail-link" onClick={() => openDecision(decision.id)}>결정 자세히 보기 <ArrowRight /></button>
      </div>
    </article>
  )
}

function MobileDecisionNavigator({ decisions, selectedDecisionId, selectDecision, openDecision }: { decisions: DecisionSummary[]; selectedDecisionId: string; selectDecision: (id: string) => void; openDecision: (id: string) => void }) {
  const selectedIndex = Math.max(decisions.findIndex((item) => item.id === selectedDecisionId), 0)
  const selectedDecision = decisions[selectedIndex]

  if (!selectedDecision) return <div className="moa-mobile-decision-master"><div className="moa-result-empty"><strong>표시할 결정이 없어요.</strong></div></div>

  return (
    <div className="moa-mobile-decision-master">
      <nav className="moa-mobile-decision-rail" aria-label="결정 항목 선택">
        <ol>
          {decisions.map((item, index) => {
            const selected = item.id === selectedDecision.id
            const number = String(index + 1).padStart(2, '0')
            return <li key={item.id}><button className={selected ? 'active' : ''} onClick={() => selectDecision(item.id)} aria-label={`${index + 1}. ${item.categoryLabel}`} aria-current={selected ? 'step' : undefined} aria-controls="moa-mobile-decision-summary" title={`${index + 1}. ${item.categoryLabel}`}><span aria-hidden="true">{number}</span><i aria-hidden="true" /></button></li>
          })}
        </ol>
      </nav>
      <DecisionSectionSummary key={selectedDecision.id} decision={selectedDecision} index={selectedIndex} openDecision={openDecision} />
    </div>
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
  const accommodationTitle = accommodation ? [accommodation.location.area, accommodation.name].filter(Boolean).join(' · ') : accommodationDecision?.title ?? '숙소 정보 확인 중'
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
          <section className={`moa-trip-masthead${result.destinationImage ? '' : ' no-image'}`}>
            {result.destinationImage && <img src={result.destinationImage} alt={`${result.destination} 여행지 풍경`} />}
            <div className="moa-trip-identity">
              <span>FINAL TRIP PLAN</span>
              <h1>{result.destination}</h1>
              <p>{result.dateRange} · {result.duration} · {result.participantCount}명</p>
              <div className="moa-trip-facts">
                <div><span>1인 예상</span><strong>{formatKrw(result.budgetPerPerson)}</strong></div>
                <div><span>현재 상태</span><strong>{statusLabels[result.status]}</strong></div>
                <div><span>숙소 거점</span><strong>{result.stayArea}</strong></div>
                <button className="moa-trip-booking-action" onClick={() => setMode('booking')} aria-label={`예약 전 확인할 항목 ${result.checksRequired}건, 예약 탭에서 보기`}><span>확인 필요</span><strong>예약 전 확인 {result.checksRequired}건</strong><small>예약 탭에서 보기</small><ArrowRight /></button>
              </div>
            </div>
          </section>
        </div>
      </header>
      <nav className="moa-product-tabs" aria-label="결과 보기"><div className="moa-results-frame">{resultModes.map((item) => <button key={item.id} className={mode === item.id ? 'active' : ''} aria-current={mode === item.id ? 'page' : undefined} onClick={() => setMode(item.id)}><span>{item.label}</span>{item.id === 'booking' && result.checksRequired > 0 && <small>{result.checksRequired}</small>}</button>)}</div></nav>
    </>
  )
}

export function ProductResults({ result, pace, mode, setMode, back, decision, selectedDecisionId, selectDecision }: { result: ProductResult; pace: TripPace; mode: ResultMode; setMode: (mode: ResultMode) => void; back: () => void; decision: (id: string) => void; reopen: (id: string) => void; selectedDecisionId: string; selectDecision: (id: string) => void }) {
  return (
    <div className="moa-product-results">
      <TripHeader result={result} mode={mode} setMode={setMode} back={back} />
      <div className="moa-product-result-content">
        {mode === 'overview' && <Overview result={result} pace={pace} openBooking={() => setMode('booking')} openSchedule={() => setMode('schedule')} openDecisions={() => setMode('decisions')} />}
        {mode === 'schedule' && <section className="moa-results-section first"><ResultSectionHeader eyebrow="일정" title="날짜별 일정" description="시간, 장소, 이동을 한 흐름으로 확인하세요." /><Itinerary result={result} /></section>}
        {mode === 'booking' && <section className="moa-results-section first"><ResultSectionHeader eyebrow="출발 전 할 일" title="예약 준비" description="결제가 필요한 항목과 먼저 확인할 항목을 상태별로 정리했습니다." /><BookingChecklist result={result} /></section>}
        {mode === 'decisions' && <section className="moa-results-section first moa-decisions-section"><ResultSectionHeader eyebrow="결정 순서" title="결정 과정" description="무엇을 선택했고 어떤 조건과 대안이 판단에 영향을 주었는지 확인하세요." mobileDescription="MOA가 어떤 선택을 했고 무엇이 영향을 줬는지 확인하세요." /><DecisionLog decisions={result.decisions} openDecision={decision} /><MobileDecisionNavigator decisions={result.decisions} selectedDecisionId={selectedDecisionId} selectDecision={selectDecision} openDecision={decision} /></section>}
      </div>
    </div>
  )
}

const dialogFocusSelector = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function DecisionDetail({ decision, back, reopen, replay, mobileSheet = false }: { decision: DecisionSummary; back: () => void; reopen: () => void; replay: () => void; mobileSheet?: boolean }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const sheetDragStartY = useRef<number | null>(null)
  const ignoreNextHandleClick = useRef(false)
  const [sheetExpanded, setSheetExpanded] = useState(false)
  const titleId = `moa-decision-title-${decision.id}`
  const descriptionId = `moa-decision-description-${decision.id}`

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
        className={`moa-decision-detail-page moa-results-theme${mobileSheet ? ' mobile-decision-sheet' : ''}${mobileSheet && sheetExpanded ? ' is-expanded' : ''}`}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
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
        <header><span>{decision.categoryLabel}</span><h1 id={titleId}>{decision.title}</h1><p id={descriptionId}>{decision.detail}</p></header>
        <div className="moa-decision-detail-layout">
          <div className="moa-decision-reasoning">
            <section className="moa-decision-rationale"><span>선택 이유</span><p>{decision.summaryReason}</p></section>
            <section className="moa-decision-constraints"><h2>반영된 조건</h2><ul className="moa-detail-conditions">{decision.reasons.map((reason) => <li key={reason}><CheckCircleIcon />{reason}</li>)}</ul></section>
            {decision.travelData && <section className="moa-decision-core-facts"><h2>선택 정보</h2><TravelDecisionContent data={decision.travelData} /></section>}
            <section className="moa-decision-alternatives"><h2>비교한 다른 후보</h2><div className="moa-rejected-list">{decision.rejectedCandidates.map((candidate) => <article className={`moa-rejected ${candidate.hardConstraintConflict ? 'critical' : ''}`} key={candidate.id}><strong>{candidate.title}</strong><span>제외 이유</span><p>{candidate.reason}</p></article>)}</div></section>
          </div>
          <aside className="moa-decision-evidence-panel">
            <section><h2>근거</h2>{decision.evidence.map((evidence) => <article className="moa-evidence-row" key={evidence.id}><header><strong>{evidence.label}</strong><span>{evidence.stateLabel}</span></header><p>{evidence.value}</p><small>{evidence.checkedLabel}</small>{evidence.uncertainty && <UncertaintyNotice message={evidence.uncertainty} safety={decision.category === 'dining'} />}<SourceDetail evidence={evidence} /></article>)}</section>
            <div className="moa-decision-detail-actions">
              <button className="moa-decision-replay" onClick={replay}><PlayCircle />전체 회의 기록 보기</button>
              <button className="moa-reopen-decision" onClick={reopen}>이 결정 다시 논의하기 <ArrowRight /></button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

function CheckCircleIcon() { return <span className="moa-detail-check"><Check /></span> }
