/**
 * Wire shapes returned by the MOA backend.
 *
 * These are a **read-only mirror** of `packages/contracts/src/*.ts`. The web app
 * cannot import that package yet (it is not a dependency of `@tm/web`), so the
 * fields we consume are declared here and nowhere else. Rules:
 *
 *   · never widen or rename a field to suit a screen — adapters do that,
 *   · never treat these as UI types: `features/<name>/adapters` translate them,
 *   · when the backend contract changes, this file changes first.
 *
 * Source of truth: packages/contracts/src/result.ts · objection.ts · survey.ts
 */

export type RoomStatus =
  | 'COLLECTING'
  | 'DATE_RESOLVING'
  | 'READY'
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'

export type RunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED'

export type ResultAvailability = 'pending' | 'running' | 'partial' | 'ready' | 'failed'

export type ResultEnvelope<T> = {
  availability: ResultAvailability
  reason: string | null
  data: T | null
}

export type MemberRole = 'host' | 'member'

export type SessionResponse = {
  userId: string
  /** Always false. The cookie is continuity, not authentication. */
  authenticated: boolean
}

export type CreateRoomResponse = {
  roomId: string
  status: RoomStatus
}

export type MemberResponse = {
  roomId: string
  userId: string
  role: MemberRole
  surveySubmitted: boolean
  personaConfirmedAt: string | null
  joinedAt: string
}

export type RoomDetailResponse = {
  roomId: string
  packId: string
  status: RoomStatus
  deadlineAt: string | null
  completedRounds: string[]
  bookedNodes: string[]
  memberCount: number
  surveyDone: number
  personaConfirmed: number
  me: {
    userId: string
    role: MemberRole
    surveySubmitted: boolean
    personaConfirmedAt: string | null
  } | null
  pendingApprovals: number
}

export type StartTriggerId = 'all_done' | 'host' | 'deadline'

export type AbsenteeResponse = {
  userId: string
  reason: 'no_survey' | 'no_persona_confirm'
}

export type TriggerDecisionResponse = {
  allowed: boolean
  reason: string | null
  attendees: string[]
  absentees: AbsenteeResponse[]
}

export type StartCheckResponse = {
  triggers: Record<StartTriggerId, TriggerDecisionResponse>
}

export type StartRunResponse = {
  runId: string
  jobId: string | null
  /** false means the job never reached the queue. Do not show the room as waiting. */
  enqueued: boolean
  trigger: StartTriggerId
  attendees: string[]
  absentees: AbsenteeResponse[]
}

export type RoundProgressResponse = {
  roundId: string
  category: string
  phase: string
  seq: number
  rerunCount: number
  settled: boolean
}

export type RoomProgressResponse = {
  roomId: string
  packId: string
  roomStatus: RoomStatus
  runId: string | null
  runStatus: RunStatus | null
  rounds: RoundProgressResponse[]
  completedRounds: string[]
  totalRounds: number
  percent: number
  startedAt: string | null
  finishedAt: string | null
  failureReason: string | null
  pendingApprovals: number
}

export type DateWindowResponse = {
  start: string
  end: string
  nights: number
  attendees: string[]
  absentees: string[]
  score: number
  breakdown: Record<string, number>
}

export type DateResolutionResponse = {
  status: 'PROVISIONAL' | 'VERIFIED' | 'NEEDS_USER_CHOICE' | 'BLOCKED'
  reason: string | null
  data: {
    status: 'confirmed' | 'needs_discussion' | 'needs_host_choice' | 'impossible'
    windows: DateWindowResponse[]
    chosen: DateWindowResponse | null
    relaxation: 'none' | 'fewer_nights' | 'partial_attendance'
    nights: number
    reason: string
  } | null
}

/**
 * Item and plan badges as the backend declares them. `BOOKABLE` and `BOOKED`
 * stay in the wire type because the canonical contract still lists them, but no
 * screen renders them: `planStatusFromBadge` collapses them into MVP states.
 */
export type ResultBadge =
  | 'NONE'
  | 'DRAFT'
  | 'PARTIAL'
  | 'PROVISIONAL'
  | 'VERIFIED'
  | 'BOOKABLE'
  | 'BOOKED'

export type PlanBlockerResponse = {
  kind: string
  detail: string
  itemId: string | null
  nodeId: string | null
  roundId: string | null
}

export type PlanItemResponse = {
  itemId: string
  nodeId: string
  externalId: string | null
  title: string
  detail: string
  startAt: string | null
  endAt: string | null
  costPerPersonKrw: number
  badge: ResultBadge
  bookingUrl: string | null
  travelMinutesFromPrev: number | null
  caution: string | null
}

export type PlanDayResponse = {
  day: number
  date: string | null
  title: string
  items: PlanItemResponse[]
  totals: {
    costPerPersonKrw: number
    travelMinutes: number | null
    walkMeters: number | null
  }
}

export type PlanResultResponse = {
  roomId: string
  runId: string
  itineraryId: string
  version: number
  publishedAt: string | null
  badge: ResultBadge
  dateRange: { start: string; end: string } | null
  headline: string
  days: PlanDayResponse[]
  budget: {
    declaredTotalPerPersonKrw: number
    groupCapPerPersonKrw: number
    byNode: Record<string, number>
  }
  blockers: PlanBlockerResponse[]
  warnings: PlanBlockerResponse[]
  uncertainties: string[]
}

export type TranscriptMessageResponse = {
  roundId: string
  seq: number
  speakerType: 'persona' | 'referee' | 'supervisor' | 'system'
  speakerId: string | null
  speakerName: string
  content: string
  refs: Record<string, unknown>
  createdAt: string
}

export type VerdictResponse = {
  winner: { candidateIds: string[]; rationale?: string }
  dissent: Array<{ userId: string; reason: string; mitigation: string | null }>
  [key: string]: unknown
}

export type TranscriptRoundResponse = {
  roundId: string
  category: string
  phase: string
  messages: TranscriptMessageResponse[]
  verdict: VerdictResponse | null
  scores: Array<{ candidateId: string; userId: string; satisfaction: number }>
}

export type TranscriptResponse = {
  roomId: string
  runId: string
  rounds: TranscriptRoundResponse[]
  fallbackRate: number
}

export type FairnessResponse = {
  roomId: string
  runId: string
  members: Array<{
    userId: string
    displayName: string
    satisfaction: number | null
    perRound: Record<string, number>
    concessionCredit: number
    concessions: Array<{ roundId: string | null; delta: number }>
  }>
  minSatisfaction: number | null
  satisfactionGap: number | null
  dissents: Array<{
    roundId: string
    userId: string
    reason: string
    mitigation: string | null
  }>
}

/* ---------------------------------------------------------------- objections */

export type ObjectionKind = 'add_condition' | 'replace_candidates' | 'redo'

export type ObjectionStatus =
  | 'submitted'
  | 'rejected'
  | 'needs_approval'
  | 'accepted'
  | 'queued'
  | 'applied'
  | 'expired'

export type ObjectionImpactResponse = {
  staleNodes: string[]
  rerunRounds: string[]
  estimatedDurationSec: number
  estimatedCostUsd: number
  bookedNodesAffected: string[]
  cancellationRisk: 'none' | 'low' | 'high'
  approvalRequired: string[]
  remainingAfterThis: { room: number; user: number }
}

export type ObjectionRecordResponse = {
  objectionId: string
  request: {
    roomId: string
    userId: string
    targetRoundId: string
    targetCategory: string
    kind: ObjectionKind
    reason: string
  }
  status: ObjectionStatus
  rejectReason: string | null
  impact: ObjectionImpactResponse | null
  runId: string | null
  submittedAt: string
  resolvedAt: string | null
  outcome: {
    changed: boolean
    minSatisfactionBefore: number | null
    minSatisfactionAfter: number | null
    budgetDeltaPerPersonKrw: number
    unresolvedReason: string | null
  } | null
  failClosedRecheck?: boolean
}

export type ObjectionQuotaResponse = {
  caps: { perRoom: number; perUser: number }
  used: { room: number; user: number }
  remaining: { room: number; user: number; canSubmit: boolean }
  objections: ObjectionRecordResponse[]
}

export type ObjectionPreviewResponse = {
  impact: ObjectionImpactResponse
  failClosedRecheck: boolean
}

/* ------------------------------------------------------------------- intake */

/** `POST /api/survey-responses` body. Mirrors `surveySubmissionSchema` (v2). */
export type SurveyIntakePayload = {
  schemaVersion: 2
  destinationId: string
  availability: {
    availableDates: string[]
    unavailableDates: string[]
    preferredNights: '1' | '2' | '3' | '4+' | null
    nightFlexibility: 'fixed' | 'plus-minus-one' | null
    weekdayFlexibility: 'weekends' | 'friday-pto' | 'weekdays' | null
    flightTimeFlexibility: 'early-morning' | 'morning-onward' | 'any-time' | null
  }
  hardConstraints: {
    budgetLimit: string
    includesFlight: boolean
    dietary: string[]
    allergies: string[]
    beliefs: string[]
    walkingDistanceKm: number | null
    mobilityNeeds: string[]
    noGoItems: string[]
  }
  travelStyles: Record<string, number | null>
  activityScores: Record<string, number | null>
  mustDo: string
  avoid: string
}

export type SurveyIntakeResponse = {
  surveyId: string
  schemaVersion: number
}
