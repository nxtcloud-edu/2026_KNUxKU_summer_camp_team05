import type { MockTravelProviderResponse } from '../providers/mockTravelProvider'
import type {
  TravelPrice,
  TravelSourceMeta,
  TripPack,
} from '../models'

const won = new Intl.NumberFormat('ko-KR')

function source(raw: MockTravelProviderResponse, key: string): TravelSourceMeta {
  const value = raw.sources[key]
  if (!value) throw new Error(`Unknown travel source: ${key}`)
  return value
}

function krwPrice(raw: MockTravelProviderResponse, amount: number, sourceKey: string): TravelPrice {
  return {
    amount,
    currency: 'KRW',
    display: `₩${won.format(amount)}`,
    per: 'person',
    source: source(raw, sourceKey),
  }
}

function jpyPrice(raw: MockTravelProviderResponse, amount: number, sourceKey: string): TravelPrice {
  const convertedAmount = Math.round(amount * 9.2 / 100) * 100
  return {
    amount,
    currency: 'JPY',
    display: `¥${won.format(amount)}`,
    converted: {
      amount: convertedAmount,
      currency: 'KRW',
      display: `약 ₩${won.format(convertedAmount)}`,
    },
    source: source(raw, sourceKey),
  }
}

export function adaptProviderTripPack(raw: MockTravelProviderResponse): TripPack {
  const budgetPerPerson = raw.budget.reduce((total, [, amount]) => total + amount, 0)

  return {
    id: raw.trip.id,
    kicker: raw.trip.roomLabel,
    title: `${raw.trip.city} ${raw.trip.nights}박 ${raw.trip.days}일`,
    destination: raw.trip.city,
    duration: `${raw.trip.nights}박 ${raw.trip.days}일`,
    dateRange: `${raw.trip.startsOn}–${raw.trip.endsOn}`,
    travelerCount: raw.trip.partySize,
    status: raw.trip.agreementStatus,
    budgetPerPerson,
    pendingBookingCount: raw.bookings.filter((item) => item.status !== 'booked').length,
    coverImage: raw.trip.coverImageUrl,
    days: raw.days.map((day) => ({
      id: day.id,
      label: day.label,
      date: day.date,
      dateIso: day.dateIso,
      title: day.title,
      image: day.imageUrl,
      weather: day.weather,
      totalTravelMinutes: day.travelMinutes,
      estimatedSpend: krwPrice(raw, day.estimatedSpendKrw, 'maps'),
      events: day.events.map((event) => ({
        time: event.time,
        title: event.title,
        detail: event.detail,
        transit: event.transit ? {
          label: event.transit.label,
          detail: `${event.transit.minutes}분${event.transit.fareJpy ? ` · ¥${won.format(event.transit.fareJpy)}` : ''}`,
        } : undefined,
        reason: event.reason ? {
          title: event.reason.title,
          summary: event.reason.summary,
          comparison: event.reason.comparison.map(([label, value]) => ({ label, value })),
          replayRound: event.reason.replayRound,
        } : undefined,
      })),
    })),
    bookings: raw.bookings.map((item) => ({
      id: item.id,
      category: item.category,
      title: item.title,
      detail: item.detail,
      deadline: item.deadline,
      status: item.status,
      statusLabel: item.statusLabel,
      price: item.priceKrw ? krwPrice(raw, item.priceKrw, item.sourceKey) : undefined,
      availability: item.availability ? {
        status: 'available',
        label: item.availability.label,
        checkedAt: item.availability.checkedAt,
        source: source(raw, item.availability.sourceKey),
      } : undefined,
      place: item.place ? {
        id: item.place.id,
        name: item.place.name,
        kind: item.place.kind,
        hours: item.place.hours,
        dietaryNote: item.place.dietaryNote,
        source: source(raw, item.place.sourceKey),
      } : undefined,
      bookingUrl: item.bookingUrl,
    })),
    budget: raw.budget.map(([label, amount]) => ({ label, amount })),
    routes: raw.routes.map((route) => ({
      id: route.id,
      dayId: route.dayId,
      dayLabel: route.dayLabel,
      title: route.title,
      durationMinutes: route.durationMinutes,
      transfers: route.transfers,
      price: jpyPrice(raw, route.fareJpy, route.sourceKey),
      steps: route.steps.map((step) => ({
        place: step.place,
        mode: step.mode,
        durationMinutes: step.minutes,
        detail: step.detail,
      })),
      alternatives: route.alternatives.map((alternative) => ({
        label: alternative.label,
        departure: alternative.departure,
        arrival: alternative.arrival,
        durationMinutes: alternative.minutes,
        price: jpyPrice(raw, alternative.fareJpy, route.sourceKey),
      })),
      mapUrl: route.mapUrl,
      driving: route.driving ? {
        durationMinutes: route.driving.minutes,
        price: krwPrice(raw, route.driving.estimatedKrw, 'maps'),
      } : undefined,
      source: source(raw, route.sourceKey),
    })),
    advisories: raw.advisories.map((item) => ({
      id: item.id,
      category: item.category,
      label: item.label,
      title: item.title,
      detail: item.detail,
      actionLabel: item.actionLabel,
      details: item.details?.map(([label, value]) => ({ label, value })),
      source: source(raw, item.sourceKey),
    })),
    fairness: {
      status: raw.fairness.status,
      averageScore: raw.fairness.averageScore,
      members: raw.fairness.members.map(([name, score, note]) => ({ name, score, note })),
      concessions: raw.fairness.concessions,
      minorityOpinions: raw.fairness.minorityOpinions,
    },
  }
}
