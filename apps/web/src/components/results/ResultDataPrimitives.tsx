import { ArrowSquareOut, Car, Clock, CloudRain, Info, MapPin, WarningCircle } from '@phosphor-icons/react'
import type {
  AvailabilityView,
  DataConfidence,
  EvidenceSummary,
  LocationView,
  PriceView,
  RouteMapView,
  RouteSummaryView,
  WeatherSummaryView,
  WeatherWarningView,
} from '../../product/types'

const currencySymbols: Record<NonNullable<PriceView['currency']>, string> = {
  KRW: '₩',
  JPY: '¥',
  USD: '$',
  EUR: '€',
}

const unitLabels: Record<NonNullable<PriceView['unit']>, string> = {
  person: '1인',
  group: '그룹',
  night: '박',
  stay: '숙박 전체',
  ticket: '입장권',
  route: '이동',
}

const confidenceLabels: Record<DataConfidence, string> = {
  live: '실시간',
  verified: '확인됨',
  estimated: '추정',
  unknown: '확인 필요',
  stale: '오래된 정보',
}

const formatAmount = (amount: number, currency: NonNullable<PriceView['currency']>) =>
  `${currencySymbols[currency]}${Math.round(amount).toLocaleString('ko-KR')}`

const formatDuration = (minutes: number) => {
  if (minutes < 60) return `${minutes}분`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}시간 ${remainder}분` : `${hours}시간`
}

export function PriceDisplay({ price, compact = false }: { price: PriceView; compact?: boolean }) {
  if (price.type === 'unknown') {
    return <div className="moa-price-display state-unknown"><strong>가격 확인 필요</strong><span>예약 전 확인 필요</span></div>
  }

  const currency = price.currency ?? 'KRW'
  const unit = price.unit ? ` / ${unitLabels[price.unit]}` : ''
  const hasRange = price.rangeMin !== undefined && price.rangeMax !== undefined
  const primary = hasRange
    ? `약 ${formatAmount(price.rangeMin!, currency)}–${formatAmount(price.rangeMax!, currency)}${unit}`
    : price.amount !== undefined
      ? `${formatAmount(price.amount, currency)}${unit}`
      : '가격 확인 필요'
  const convertedRange = price.convertedRangeMinKRW !== undefined && price.convertedRangeMaxKRW !== undefined
    ? `약 ${formatAmount(price.convertedRangeMinKRW, 'KRW')}–${formatAmount(price.convertedRangeMaxKRW, 'KRW')}`
    : undefined
  const converted = price.convertedKRW !== undefined && currency !== 'KRW'
    ? `약 ${formatAmount(price.convertedKRW, 'KRW')}`
    : convertedRange

  return (
    <div className={`moa-price-display state-${price.type}${compact ? ' compact' : ''}`}>
      <strong>{primary}</strong>
      {converted && <b>{converted}</b>}
      <span>{confidenceLabels[price.type]}{price.checkedLabel ? ` · ${price.checkedLabel}` : ''}</span>
      {!compact && price.exchangeRate && price.checkedAt && <small>환율 기준 · {price.checkedAt} · ¥1 = ₩{price.exchangeRate.toFixed(2)}</small>}
    </div>
  )
}

export function EvidenceBadge({ evidence }: { evidence?: EvidenceSummary }) {
  if (!evidence) return <span className="moa-evidence-badge state-unknown">정보 없음</span>
  return <span className={`moa-evidence-badge state-${evidence.state}`}>{evidence.stateLabel}</span>
}

export function FreshnessLabel({ evidence }: { evidence?: EvidenceSummary }) {
  if (!evidence?.checkedLabel) return null
  return <span className="moa-freshness"><Clock />{evidence.checkedLabel}</span>
}

export function UncertaintyNotice({ message, safety = false }: { message?: string; safety?: boolean }) {
  if (!message) return null
  return <aside className={`moa-uncertainty${safety ? ' safety' : ''}`}><WarningCircle weight="fill" /><span>{message}</span></aside>
}

export function BookingStatus({ availability }: { availability: AvailabilityView }) {
  return (
    <div className={`moa-booking-status state-${availability.state}`}>
      <strong>{availability.label}</strong>
      {availability.detail && <span>{availability.detail}</span>}
      <FreshnessLabel evidence={availability.evidence} />
    </div>
  )
}

export function SourceDetail({ evidence }: { evidence?: EvidenceSummary }) {
  if (!evidence?.source) return null
  const source = evidence.source
  const sourceLabel = source.label === '예약처 조회'
    ? '예약처에서 확인'
    : source.label === '지도 경로 정보'
      ? '지도에서 위치 확인'
      : source.label
  return (
    <div className={`moa-source-detail state-${evidence.state}`}>
      <Info />
      <div><strong>{sourceLabel}</strong></div>
      {source.url && <a href={source.url} target="_blank" rel="noreferrer">근거 보기 <ArrowSquareOut /></a>}
    </div>
  )
}

export function LocationSummary({ location }: { location: LocationView }) {
  if (!location.address && !location.area && !location.mapUrl) return null
  return (
    <div className="moa-location-summary">
      <MapPin />
      <div><strong>{location.area ?? location.name}</strong>{location.address && <span>{location.address}</span>}</div>
      {location.mapUrl && <a href={location.mapUrl} target="_blank" rel="noreferrer" aria-label={`${location.name} 지도에서 보기`}><ArrowSquareOut /></a>}
    </div>
  )
}

export function RouteMapPreview({ map, origin, destination }: { map: RouteMapView; origin: string; destination: string }) {
  if (map.path.length < 2) return null
  const latitudes = map.path.map((point) => point.latitude)
  const longitudes = map.path.map((point) => point.longitude)
  const minLatitude = Math.min(...latitudes)
  const maxLatitude = Math.max(...latitudes)
  const minLongitude = Math.min(...longitudes)
  const maxLongitude = Math.max(...longitudes)
  const latitudeRange = Math.max(maxLatitude - minLatitude, 0.001)
  const longitudeRange = Math.max(maxLongitude - minLongitude, 0.001)
  const points = map.path.map((point) => ({
    x: 24 + ((point.longitude - minLongitude) / longitudeRange) * 272,
    y: 116 - ((point.latitude - minLatitude) / latitudeRange) * 92,
  }))
  const polyline = points.map((point) => `${point.x},${point.y}`).join(' ')
  const first = points[0]
  const last = points[points.length - 1]

  return (
    <figure className="moa-route-map">
      <div><span>경로 미리보기</span><strong>{map.label ?? `${origin} → ${destination}`}</strong></div>
      <svg viewBox="0 0 320 140" role="img" aria-label={`${origin}에서 ${destination}까지 예상 경로`}>
        <rect width="320" height="140" rx="12" />
        <path className="grid" d="M0 35H320 M0 70H320 M0 105H320 M64 0V140 M128 0V140 M192 0V140 M256 0V140" />
        <polyline points={polyline} />
        <circle className="start" cx={first.x} cy={first.y} r="6" />
        <circle className="end" cx={last.x} cy={last.y} r="6" />
      </svg>
      <figcaption><span><i className="start" />{origin}</span><span><i className="end" />{destination}</span></figcaption>
    </figure>
  )
}

export function RouteSummary({ route, compact = false }: { route: RouteSummaryView; compact?: boolean }) {
  if (compact) {
    return (
      <div className="moa-route-summary compact">
        {route.departureTime && <strong>{route.departureTime}</strong>}
        <span>{route.modeLabel} {formatDuration(route.durationMinutes)} · {route.transferCount ? `환승 ${route.transferCount}회` : '환승 없음'}</span>
      </div>
    )
  }

  return (
    <section className="moa-route-summary">
      <header><div><span>{route.origin}</span><strong>{route.destination}</strong></div><b>{route.modeLabel}</b></header>
      {route.map && <RouteMapPreview map={route.map} origin={route.origin} destination={route.destination} />}
      <div className="moa-route-metrics">
        <div><span>이동시간</span><strong>{formatDuration(route.durationMinutes)}</strong></div>
        <div><span>환승</span><strong>{route.transferCount ? `${route.transferCount}회` : '없음'}</strong></div>
        {route.walkingMinutes !== undefined && <div><span>도보</span><strong>{route.walkingMinutes}분</strong></div>}
        {route.distanceKm !== undefined && <div><span>거리</span><strong>{route.distanceKm} km</strong></div>}
      </div>
      {(route.departureTime || route.arrivalTime) && <p className="moa-route-time">{route.departureTime} → {route.arrivalTime}</p>}
      {route.fare && <PriceDisplay price={route.fare} compact />}
      {route.steps && route.steps.length > 0 && <ol>{route.steps.map((step) => <li key={step.id}><span>{step.mode === 'walk' ? '도보' : step.station ?? route.modeLabel}</span><strong>{step.instruction}</strong>{step.durationMinutes !== undefined && <small>{step.durationMinutes}분</small>}</li>)}</ol>}
      {route.cutoffWarning && <UncertaintyNotice message={route.cutoffWarning} />}
      {route.mapUrl && <a className="moa-data-link" href={route.mapUrl} target="_blank" rel="noreferrer">경로 지도에서 보기 <ArrowSquareOut /></a>}
      {route.drivingCost && (
        <div className="moa-driving-cost">
          <header><Car /><div><strong>렌터카 예상 비용</strong><span>{formatDuration(route.durationMinutes)}{route.distanceKm ? ` · ${route.distanceKm} km` : ''}</span></div></header>
          <dl>
            <div><dt>유류비</dt><dd><PriceDisplay price={route.drivingCost.fuel} compact /></dd></div>
            <div><dt>통행료</dt><dd><PriceDisplay price={route.drivingCost.tolls} compact /></dd></div>
            <div><dt>주차</dt><dd><PriceDisplay price={route.drivingCost.parking} compact /></dd></div>
          </dl>
          <footer><span>예상 합계</span><PriceDisplay price={route.drivingCost.total} compact /></footer>
        </div>
      )}
      <FreshnessLabel evidence={route.evidence} />
    </section>
  )
}

export function WeatherSummary({ weather }: { weather: WeatherSummaryView }) {
  return (
    <div className="moa-weather-summary">
      <CloudRain weight="duotone" />
      <div><strong>{weather.temperatureMinC}–{weather.temperatureMaxC}°C</strong><span>{weather.summary}</span></div>
      {weather.precipitationProbability !== undefined && <b>강수 {weather.precipitationProbability}%</b>}
    </div>
  )
}

export function WeatherWarning({ warning }: { warning: WeatherWarningView }) {
  return (
    <aside className={`moa-weather-warning severity-${warning.severity}`}>
      <CloudRain weight="fill" />
      <div><strong>{warning.title}</strong><span>{warning.detail}</span></div>
    </aside>
  )
}
