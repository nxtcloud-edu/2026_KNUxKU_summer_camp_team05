import type {
  FairnessResponse,
  PlanItemResponse,
  PlanResultResponse,
  ResultBadge,
} from '../../../api/backendContracts'
import type {
  BookingReadiness,
  DecisionCategory,
  DecisionSummary,
  DestinationPack,
  EvidenceSummary,
  ItineraryDayView,
  PlanStatus,
  PreferenceCoverage,
  ProductResult,
  TripPace,
} from '../../../product/types'

/**
 * Backend response -> frontend view model.
 *
 * This is the only place the canonical contract is allowed to meet the UI.
 * `ProductResult` stays a **view model**: we never push wire shapes into the
 * screens, and we never claim a state the backend did not report.
 *
 *   backend PlanResult + FairnessView -> adapter -> ProductResult -> ProductResults
 */

export function planStatusFromBadge(badge: ResultBadge, blockerCount: number): PlanStatus {
  if (blockerCount > 0) return 'BLOCKED'
  if (badge === 'VERIFIED') return 'VERIFIED'
  if (badge === 'PROVISIONAL') return 'PROVISIONAL'
  return badge
}

const decisionStatusFromBadge = (badge: ResultBadge): DecisionSummary['status'] => {
  if (badge === 'VERIFIED') return 'verified'
  if (badge === 'PROVISIONAL') return 'needs-check'
  return 'choice-required'
}

const evidenceStateFromBadge = (badge: ResultBadge): EvidenceSummary['state'] => {
  if (badge === 'VERIFIED') return 'verified'
  if (badge === 'PROVISIONAL') return 'estimated'
  return 'unknown'
}

const badgeStateLabels: Record<ResultBadge, string> = {
  PROVISIONAL: '잠정 확인',
  VERIFIED: '확인됨',
  NEEDS_USER_CHOICE: '사용자 선택 필요',
  BLOCKED: '진행 차단',
}

const nodeCategories: Record<string, { category: DecisionCategory; label: string }> = {
  flight: { category: 'transport', label: '오는 길·가는 길' },
  transport_policy: { category: 'transport', label: '오는 길·가는 길' },
  transit_pass: { category: 'transport', label: '오는 길·가는 길' },
  accommodation_area: { category: 'stay', label: '체류 거점·숙소' },
  accommodation: { category: 'stay', label: '체류 거점·숙소' },
  activity: { category: 'activity', label: '갈 곳·할 일' },
  dining: { category: 'dining', label: '식사' },
  schedule: { category: 'schedule', label: '날짜별 일정·현지 이동' },
  date: { category: 'schedule', label: '날짜별 일정·현지 이동' },
  budget: { category: 'schedule', label: '최종 확인' },
  booking_readiness: { category: 'schedule', label: '최종 확인' },
  validation: { category: 'schedule', label: '최종 확인' },
  document: { category: 'schedule', label: '최종 확인' },
}

const categoryOf = (nodeId: string) => nodeCategories[nodeId] ?? { category: 'schedule' as DecisionCategory, label: '날짜별 일정·현지 이동' }

const isoToShort = (value: string | null): string => {
  if (!value) return ''
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getMonth() + 1}.${date.getDate()}`
}

const isoToKoreanDate = (value: string | null): string => {
  if (!value) return ''
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(date)
}

const timeLabel = (value: string | null): string => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

const paceFor = (itemsPerDay: number): TripPace => {
  if (itemsPerDay <= 1.5) return { coreAnchorsPerDay: 1, label: '여유롭게', detail: '쉬는 시간을 넉넉하게' }
  if (itemsPerDay <= 2.5) return { coreAnchorsPerDay: 2, label: '균형 있게', detail: '관광과 휴식의 균형' }
  return { coreAnchorsPerDay: 3, label: '알차게', detail: '보고 싶은 곳을 적극적으로' }
}

function itemEvidence(item: PlanItemResponse, checkedAt: string | null): EvidenceSummary {
  const state = evidenceStateFromBadge(item.badge)
  return {
    // Evidence id first: a user must be able to point at what was checked.
    id: item.externalId ?? item.itemId,
    label: '근거',
    value: item.externalId ?? '조달 근거 없음',
    state,
    stateLabel: badgeStateLabels[item.badge],
    checkedLabel: checkedAt ? `${isoToKoreanDate(checkedAt)} 확인` : '확인 시각 없음',
    ...(checkedAt ? { checkedAt } : {}),
    ...(item.caution ? { uncertainty: item.caution } : {}),
  }
}

function toDecision(
  item: PlanItemResponse,
  index: number,
  blockedItemIds: Set<string>,
  checkedAt: string | null,
): DecisionSummary {
  const { category, label } = categoryOf(item.nodeId)
  const blocked = blockedItemIds.has(item.itemId)
  return {
    id: item.itemId,
    category,
    categoryLabel: label,
    title: item.title,
    ...(item.detail ? { detail: item.detail } : {}),
    priceLabel: item.costPerPersonKrw > 0 ? `₩${item.costPerPersonKrw.toLocaleString('ko-KR')} / 1인` : '가격 확인 필요',
    ...(item.caution ? { summaryReason: item.caution } : {}),
    reasons: [
      item.externalId ? `조달 근거 ${item.externalId}` : '조달 근거가 아직 없어요',
      item.travelMinutesFromPrev === null ? '이동시간 미측정' : `직전 항목에서 ${item.travelMinutesFromPrev}분`,
    ],
    evidence: [itemEvidence(item, checkedAt)],
    status: blocked ? 'choice-required' : decisionStatusFromBadge(item.badge),
    featured: index < 6,
  }
}

function toBooking(
  item: PlanItemResponse,
  blockedItemIds: Set<string>,
): BookingReadiness {
  const { label } = categoryOf(item.nodeId)
  const state: BookingReadiness['state'] = blockedItemIds.has(item.itemId)
    ? 'blocked'
    : item.badge === 'VERIFIED'
      ? 'ready'
      : 'needs-check'
  return {
    id: `booking-${item.itemId}`,
    category: label,
    title: item.title,
    state,
    stateLabel: state === 'ready' ? '확인됨' : state === 'needs-check' ? '예약 전 확인 필요' : '진행 불가',
    price: item.costPerPersonKrw > 0
      ? { type: item.badge === 'VERIFIED' ? 'live' : 'estimated', amount: item.costPerPersonKrw, currency: 'KRW', unit: 'person' }
      : { type: 'unknown' },
    note: item.caution ?? (state === 'ready' ? '결제 전 최종 조건을 직접 확인해 주세요.' : '확인되지 않은 항목이 있어요.'),
    ...(item.detail ? { detail: item.detail } : {}),
    ...(item.bookingUrl ? { actionLabel: '예약처에서 확인', externalUrl: item.bookingUrl } : {}),
  }
}

function toCoverage(fairness: FairnessResponse | null): PreferenceCoverage {
  if (!fairness) {
    return { represented: [], compromised: [], protectedInstead: [], unrepresentedParticipants: [] }
  }
  return {
    represented: fairness.members
      .filter((member) => member.satisfaction !== null)
      .map((member) => `${member.displayName} 만족도 ${member.satisfaction}`),
    compromised: fairness.dissents.map((dissent) => `${dissent.userId}: ${dissent.reason}`),
    protectedInstead: fairness.dissents
      .filter((dissent) => dissent.mitigation !== null)
      .map((dissent) => dissent.mitigation as string),
    unrepresentedParticipants: fairness.members
      .filter((member) => member.satisfaction === null)
      .map((member) => ({ name: member.displayName, reasons: ['이번 회의에 반영된 점수가 없어요'] })),
  }
}

export type PlanAdapterInput = {
  plan: PlanResultResponse
  fairness: FairnessResponse | null
  destination: DestinationPack
  participantCount: number
}

export function adaptPlanResult({
  plan,
  fairness,
  destination,
  participantCount,
}: PlanAdapterInput): ProductResult {
  const blockedItemIds = new Set(
    plan.blockers.map((blocker) => blocker.itemId).filter((id): id is string => id !== null),
  )
  const items = plan.days.flatMap((day) => day.items)
  const decisions = items.map((item, index) => toDecision(item, index, blockedItemIds, plan.publishedAt))
  const nights = plan.days.length > 0 ? plan.days.length - 1 : 0
  const stayItem = items.find((item) => item.nodeId === 'accommodation' || item.nodeId === 'accommodation_area')

  const itinerary: ItineraryDayView[] = plan.days.map((day) => ({
    id: `day-${day.day}`,
    dayLabel: `DAY ${day.day}`,
    dateLabel: isoToKoreanDate(day.date),
    title: day.title,
    items: day.items.map((item) => ({
      id: item.itemId,
      time: timeLabel(item.startAt),
      title: item.title,
      ...(item.detail ? { detail: item.detail } : {}),
      ...(item.caution ? { weatherWarning: { title: '확인 필요', detail: item.caution, severity: 'caution' as const } } : {}),
    })),
  }))

  // An item lands in the pre-departure list when it costs money, can be booked,
  // or was not confirmed. Dropping unconfirmed items would hide exactly the ones
  // a user has to check.
  const bookings = items
    .filter((item) => item.bookingUrl !== null
      || item.costPerPersonKrw > 0
      || item.badge !== 'VERIFIED'
      || blockedItemIds.has(item.itemId))
    .map((item) => toBooking(item, blockedItemIds))
  const attentionCount = bookings.filter((item) => item.state !== 'ready').length
  const readyCount = bookings.filter((item) => item.state === 'ready').length
  // Blockers attached to an item are already counted through that item.
  const looseBlockerCount = plan.blockers.filter((blocker) => blocker.itemId === null).length

  return {
    status: planStatusFromBadge(plan.badge, plan.blockers.length),
    source: 'live',
    runId: plan.runId,
    unverifiedItems: [
      ...plan.uncertainties,
      ...plan.blockers.map((blocker) => blocker.detail),
      ...plan.warnings.map((warning) => warning.detail),
    ].filter((entry) => entry.length > 0),
    ...(plan.publishedAt ? { checkedAt: plan.publishedAt } : {}),
    pace: paceFor(plan.days.length === 0 ? 0 : items.length / plan.days.length),
    destination: destination.name,
    destinationImage: destination.image,
    duration: nights > 0 ? `${nights}박 ${nights + 1}일` : '기간 확인 필요',
    dateRange: plan.dateRange
      ? `${isoToShort(plan.dateRange.start)} – ${isoToShort(plan.dateRange.end)}`
      : '날짜 확인 필요',
    participantCount,
    budgetPerPerson: plan.budget.declaredTotalPerPersonKrw,
    stayArea: stayItem?.detail || stayItem?.title || '숙소 확인 필요',
    checksRequired: attentionCount + looseBlockerCount,
    decisions,
    bookings,
    bookingSummary: {
      attentionCount,
      readyCount,
      ...(bookings.find((item) => item.state === 'blocked')?.id
        ? { priorityBookingId: bookings.find((item) => item.state === 'blocked')?.id }
        : {}),
    },
    itinerary,
    coverage: toCoverage(fairness),
    concessions: (fairness?.members ?? [])
      .filter((member) => member.concessions.length > 0)
      .map((member) => ({
        participant: member.displayName,
        gaveUp: `양보 ${member.concessions.length}건`,
        received: [`양보 크레딧 ${member.concessionCredit}`],
      })),
    planB: [],
  }
}
