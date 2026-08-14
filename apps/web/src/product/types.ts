export type DestinationPack = {
  id: string
  country: '한국' | '일본'
  name: string
  tags: string[]
  image: string
}

export type TripPace = {
  coreAnchorsPerDay: 1 | 2 | 3
  label: '여유롭게' | '균형 있게' | '알차게'
  detail: string
}

export type ParticipantState = 'complete' | 'in-progress' | 'waiting' | 'incomplete'

export type Participant = {
  id: string
  name: string
  initial: string
  isHost?: boolean
  state: ParticipantState
  stateLabel: string
  availabilityConfirmed: boolean
  preferencesRepresented: boolean
}

/** Whole-plan readiness. This is intentionally independent from individual fact confidence. */
export type PlanStatus = 'VERIFIED_DRAFT' | 'BOOKABLE' | 'NEEDS_USER_CHOICE' | 'BLOCKED'
export type DataConfidence = 'live' | 'verified' | 'estimated' | 'unknown' | 'stale'
export type EvidenceState = DataConfidence
export type SourceType = 'official' | 'provider' | 'web' | 'derived'

export type SourceView = {
  label: string
  sourceType: SourceType
  url?: string
  checkedAt?: string
}

export type EvidenceSummary = {
  id: string
  label: string
  value: string
  state: EvidenceState
  stateLabel: string
  checkedLabel: string
  checkedAt?: string
  uncertainty?: string
  source?: SourceView
}

export type PriceView = {
  type: 'live' | 'estimated' | 'unknown'
  amount?: number
  currency?: 'KRW' | 'JPY' | 'USD' | 'EUR'
  convertedKRW?: number
  rangeMin?: number
  rangeMax?: number
  convertedRangeMinKRW?: number
  convertedRangeMaxKRW?: number
  unit?: 'person' | 'group' | 'night' | 'stay' | 'ticket' | 'route'
  exchangeRate?: number
  checkedAt?: string
  checkedLabel?: string
}

export type CoordinatesView = {
  latitude: number
  longitude: number
}

export type LocationView = {
  name: string
  area?: string
  address?: string
  coordinates?: CoordinatesView
  mapUrl?: string
}

export type AvailabilityView = {
  state: 'available' | 'limited' | 'unavailable' | 'unknown' | 'reservation-required'
  label: string
  detail?: string
  evidence?: EvidenceSummary
}

export type TravelMode = 'flight' | 'train' | 'intercity-bus' | 'ferry' | 'subway' | 'local-bus' | 'walk' | 'taxi' | 'car'

export type RouteStepView = {
  id: string
  mode: TravelMode
  instruction: string
  durationMinutes?: number
  station?: string
}

export type DrivingCostView = {
  fuel: PriceView
  tolls: PriceView
  parking: PriceView
  total: PriceView
}

export type RouteMapView = {
  path: CoordinatesView[]
  label?: string
}

export type RouteSummaryView = {
  id: string
  origin: string
  destination: string
  mode: TravelMode
  modeLabel: string
  durationMinutes: number
  distanceKm?: number
  transferCount: number
  walkingMinutes?: number
  departureTime?: string
  arrivalTime?: string
  fare?: PriceView
  steps?: RouteStepView[]
  cutoffWarning?: string
  originLocation?: LocationView
  destinationLocation?: LocationView
  map?: RouteMapView
  mapUrl?: string
  evidence?: EvidenceSummary
  drivingCost?: DrivingCostView
}

export type WeatherSummaryView = {
  condition: string
  temperatureMinC: number
  temperatureMaxC: number
  precipitationProbability?: number
  summary: string
  evidence?: EvidenceSummary
}

export type WeatherWarningView = {
  title: string
  detail: string
  severity: 'info' | 'caution'
}

export type TransportView = {
  kind: 'transport'
  mode: Extract<TravelMode, 'flight' | 'train' | 'intercity-bus' | 'ferry'>
  modeLabel: string
  operator: string
  serviceNumber?: string
  departureLocation: string
  arrivalLocation: string
  departureTime: string
  arrivalTime: string
  durationMinutes: number
  transferCount: number
  baggage?: string
  reservationRequired?: boolean
  inventory?: AvailabilityView
  baseFare?: PriceView
  additionalTransportCost?: PriceView
  effectiveTotalPrice?: PriceView
  bookingUrl?: string
  evidence?: EvidenceSummary
}

export type AccommodationView = {
  kind: 'accommodation'
  name: string
  location: LocationView
  image?: string
  nightlyPrice: PriceView
  totalStayPrice?: PriceView
  roomCombination: string
  groupCapacity: number
  roomAvailability: AvailabilityView
  amenities: string[]
  accessibility?: string[]
  checkIn: string
  checkOut: string
  cancellationInfo?: string
  bookingUrl?: string
  evidence?: EvidenceSummary
}

export type ActivityView = {
  kind: 'activity'
  name: string
  category: string
  location: LocationView
  openingHours?: string
  closedDays?: string
  ticketPrice?: PriceView
  reservation?: AvailabilityView
  expectedDurationMinutes?: number
  weatherSensitivity?: WeatherWarningView
  bookingUrl?: string
  evidence?: EvidenceSummary
}

export type DietarySupportView = {
  label: string
  status: 'confirmed' | 'unknown' | 'inferred'
  detail: string
  evidence?: EvidenceSummary
}

export type DiningView = {
  kind: 'dining'
  name: string
  cuisine: string
  location: LocationView
  openingHours?: string
  price?: PriceView
  reservation?: AvailabilityView
  waitingInfo?: string
  dietarySupport: DietarySupportView[]
  allergySupport: DietarySupportView[]
  bookingUrl?: string
  evidence?: EvidenceSummary
}

export type ScheduleTravelView = {
  kind: 'route'
  route: RouteSummaryView
}

export type TravelDecisionData = TransportView | AccommodationView | ActivityView | DiningView | ScheduleTravelView

export type RejectedCandidate = {
  id: string
  title: string
  reason: string
  hardConstraintConflict?: boolean
}

export type DecisionCategory = 'transport' | 'stay' | 'activity' | 'dining' | 'schedule'

export type DecisionSummary = {
  id: string
  category: DecisionCategory
  categoryLabel: string
  title: string
  location?: string
  detail: string
  priceLabel?: string
  summaryReason: string
  reasons: string[]
  evidence: EvidenceSummary[]
  rejectedCandidates: RejectedCandidate[]
  status: 'verified' | 'needs-check' | 'choice-required'
  featured?: boolean
  travelData?: TravelDecisionData
}

export type BookingReadiness = {
  id: string
  category: string
  title: string
  state: 'ready' | 'needs-check' | 'blocked' | 'booked'
  stateLabel: string
  price?: PriceView
  priceLabel?: string
  note: string
  actionLabel?: string
  externalUrl?: string
  freshness?: string
  evidence?: EvidenceSummary
}

export type PreferenceCoverage = {
  represented: string[]
  compromised: string[]
  protectedInstead: string[]
  unrepresentedParticipants: Array<{
    name: string
    reasons: string[]
  }>
}

export type Concession = {
  participant: string
  gaveUp: string
  received: string[]
}

export type PlanB = {
  id: string
  trigger: string
  title: string
  replacements: string[]
  budgetDeltaLabel: string
  readinessLabel: string
  weatherWarning?: WeatherWarningView
}

export type ItineraryStop = {
  id: string
  order: number
  time?: string
  name: string
  subtitle?: string
  address?: string
  lat?: number
  lng?: number
}

export type ItineraryLeg = {
  fromStopId: string
  toStopId: string
  mode?: string
  durationMinutes?: number
  distanceMeters?: number
  transferCount?: number
  fare?: number
  polyline?: string
}

export type ItineraryItemView = {
  id: string
  time: string
  title: string
  detail?: string
  location?: LocationView
  route?: RouteSummaryView
  weatherWarning?: WeatherWarningView
}

export type ItineraryDayView = {
  id: string
  dayLabel: string
  dateLabel: string
  title: string
  weather?: WeatherSummaryView
  items: ItineraryItemView[]
}

export type ReopenReason = 'misunderstood' | 'incorrect-fact' | 'new-constraint' | 'budget-change' | 'other-candidate' | 'other'

export type ReopenOption = {
  id: ReopenReason
  label: string
  criticalCorrection?: boolean
}

export type RerunImpact = {
  affectedDecisions: string[]
  decisionCount: number
  estimatedTimeLabel: string
  bookingImpact: string
}

export type RerunDiff = {
  changed: boolean
  beforeTitle: string
  afterTitle: string
  metrics: Array<{ label: string; before: string; after: string }>
  reason: string
  evidenceChanges: string[]
  bookingReadinessChange?: string
}

export type ProductResult = {
  status: PlanStatus
  pace: TripPace
  destination: string
  destinationImage?: string
  duration: string
  dateRange: string
  participantCount: number
  budgetPerPerson: number
  stayArea: string
  checksRequired: number
  decisions: DecisionSummary[]
  bookings: BookingReadiness[]
  itinerary: ItineraryDayView[]
  coverage: PreferenceCoverage
  concessions: Concession[]
  planB: PlanB[]
}
