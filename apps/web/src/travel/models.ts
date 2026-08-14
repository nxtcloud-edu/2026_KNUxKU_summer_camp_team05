export type TravelTrustState = 'realtime' | 'verified' | 'estimated' | 'ai-inferred' | 'web-reference'

export type TravelSourceMeta = {
  provider: string
  label: string
  trust: TravelTrustState
  checkedAt?: string
  url?: string
}

export type TravelPrice = {
  amount: number
  currency: 'KRW' | 'JPY'
  display: string
  per?: 'person' | 'group'
  converted?: {
    amount: number
    currency: 'KRW' | 'JPY'
    display: string
  }
  source: TravelSourceMeta
}

export type TravelAvailability = {
  status: 'available' | 'limited' | 'unavailable' | 'unknown'
  label: string
  checkedAt?: string
  source: TravelSourceMeta
}

export type TravelPlace = {
  id: string
  name: string
  kind: 'airport' | 'station' | 'hotel' | 'restaurant' | 'attraction' | 'district'
  address?: string
  hours?: string
  dietaryNote?: string
  source?: TravelSourceMeta
}

export type TravelOption = {
  id: string
  category: 'flight' | 'hotel' | 'transit' | 'rail' | 'attraction' | 'restaurant'
  title: string
  detail?: string
  deadline: string
  status: 'booked' | 'action-required' | 'available'
  statusLabel: string
  price?: TravelPrice
  availability?: TravelAvailability
  place?: TravelPlace
  bookingUrl?: string
}

export type TravelRouteStep = {
  place: string
  mode?: string
  durationMinutes?: number
  detail?: string
}

export type TravelRouteAlternative = {
  label: string
  departure: string
  arrival: string
  durationMinutes: number
  price: TravelPrice
}

export type TravelRoute = {
  id: string
  dayId: string
  dayLabel: string
  title: string
  steps: TravelRouteStep[]
  durationMinutes: number
  transfers: number
  price: TravelPrice
  alternatives: TravelRouteAlternative[]
  mapUrl: string
  driving?: {
    durationMinutes: number
    price: TravelPrice
  }
  source: TravelSourceMeta
}

export type TravelAdvisory = {
  id: string
  category: 'weather' | 'dining' | 'ticket' | 'dietary' | 'fx' | 'web'
  label: string
  title: string
  detail: string
  actionLabel?: string
  details?: Array<{ label: string; value: string }>
  source: TravelSourceMeta
}

export type TripReason = {
  title: string
  summary: string
  comparison: Array<{ label: string; value: string }>
  replayRound: number
}

export type TripEvent = {
  time: string
  title: string
  detail?: string
  durationMinutes?: number
  transit?: {
    label: string
    detail: string
  }
  reason?: TripReason
}

export type TripDay = {
  id: string
  label: string
  date: string
  dateIso: string
  title: string
  image: string
  weather: string
  totalTravelMinutes: number
  estimatedSpend: TravelPrice
  events: TripEvent[]
}

export type TripBudgetLine = {
  label: string
  amount: number
}

export type TripFairness = {
  status: string
  averageScore: number
  members: Array<{
    name: string
    score: number
    note: string
  }>
  concessions: string[]
  minorityOpinions: string[]
}

export type TripPack = {
  id: string
  kicker: string
  title: string
  destination: string
  duration: string
  dateRange: string
  travelerCount: number
  status: string
  budgetPerPerson: number
  pendingBookingCount: number
  coverImage: string
  days: TripDay[]
  bookings: TravelOption[]
  budget: TripBudgetLine[]
  routes: TravelRoute[]
  advisories: TravelAdvisory[]
  fairness: TripFairness
}
