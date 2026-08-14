import type {
  ObjectionImpactResponse,
  ObjectionKind,
  ObjectionQuotaResponse,
  ObjectionPreviewResponse,
  ObjectionRecordResponse,
} from '../../../api/backendContracts'
import { resolveDataMode } from '../../../api/dataMode'
import { requestJson } from '../../../api/httpClient'
import { demoRerunFlow, demoRerunImpact } from '../../../product/mockData'
import type { DecisionCategory, ReopenReason } from '../../../product/types'

/**
 * Re-discussion (objection) — the only path from "this decision is wrong" back
 * into a meeting.
 *
 *   submit objection -> poll progress -> reload result
 *
 * Impact is previewed before submitting because a rerun can undo work the group
 * already agreed on; without the preview the action is a gamble.
 *
 * Backend: apps/api/src/routes/objections.ts
 */

/** Which round owns a decision. Source: packages/contracts/src/rounds.ts */
const roundForCategory: Record<DecisionCategory, { roundId: string; category: string }> = {
  transport: { roundId: 'r_1a', category: 'flight' },
  stay: { roundId: 'r_2', category: 'accommodation' },
  activity: { roundId: 'r_3', category: 'activity' },
  dining: { roundId: 'r_4', category: 'dining' },
  schedule: { roundId: 'r_5', category: 'scheduler' },
}

const kindForReason = (reason: ReopenReason): ObjectionKind => {
  if (reason === 'new-constraint' || reason === 'budget-change') return 'add_condition'
  if (reason === 'other-candidate') return 'replace_candidates'
  return 'redo'
}

export type ObjectionInput = {
  roomId: string
  userId: string
  decisionId: string
  category: DecisionCategory
  reason: ReopenReason
  /** What the user said, quoted verbatim into the transcript and the rerun brief. */
  note: string
  budgetDeltaPerPersonKrw?: number
  lateConstraint?: { tag: string; kind: 'allergy' | 'dietary' | 'mobility' | 'forbidden' | 'budget'; safety: boolean }
}

export type RerunImpactSnapshot = {
  source: 'fixture' | 'live'
  affectedDecisions: Array<{ label: string; detail?: string }>
  decisionCount: number
  estimatedTimeLabel: string
  bookingImpact: string
  /** Non-empty means the host has to approve before anything reruns (INV-5). */
  approvalRequired: string[]
  remainingAfterThis: { room: number; user: number } | null
  note: string | null
}

export type RerunSubmission = {
  source: 'fixture' | 'live'
  objectionId: string | null
  status: string
  runId: string | null
  needsApproval: boolean
  /** Set when the backend refused the objection. Shown to the user as-is. */
  rejectedReason: string | null
}

export type RerunQuota = {
  caps: { perRoom: number; perUser: number }
  remaining: { room: number; user: number; canSubmit: boolean }
}

export interface RerunRepository {
  getQuota(roomId: string, userId: string): Promise<RerunQuota | null>
  preview(input: ObjectionInput): Promise<RerunImpactSnapshot>
  submit(input: ObjectionInput): Promise<RerunSubmission>
}

/* -------------------------------------------------------------------- mock */

const nodeLabels: Record<string, string> = {
  flight: '오는 길·가는 길',
  transport_policy: '현지 이동',
  accommodation_area: '체류 지역',
  accommodation: '숙소',
  transit_pass: '교통 패스',
  activity: '갈 곳·할 일',
  dining: '식사',
  schedule: '날짜별 일정',
  budget: '예산',
  booking_readiness: '예약 준비',
  validation: '최종 검증',
  document: '계획서',
  date: '여행 날짜',
}

export class MockRerunRepository implements RerunRepository {
  async getQuota(): Promise<RerunQuota> {
    return { caps: { perRoom: 3, perUser: 1 }, remaining: { room: 3, user: 1, canSubmit: true } }
  }

  async preview(): Promise<RerunImpactSnapshot> {
    return {
      source: 'fixture',
      affectedDecisions: demoRerunImpact.affectedDecisionDetails
        ?? demoRerunImpact.affectedDecisions.map((label) => ({ label })),
      decisionCount: demoRerunImpact.decisionCount,
      estimatedTimeLabel: demoRerunImpact.estimatedTimeLabel,
      bookingImpact: demoRerunImpact.bookingImpact,
      approvalRequired: [],
      remainingAfterThis: { room: 2, user: 0 },
      note: demoRerunFlow.debug.impactNote,
    }
  }

  async submit(): Promise<RerunSubmission> {
    return {
      source: 'fixture',
      objectionId: `demo-objection-${Date.now().toString(36)}`,
      status: 'queued',
      runId: null,
      needsApproval: false,
      rejectedReason: null,
    }
  }
}

/* --------------------------------------------------------------------- api */

const toRequestBody = (input: ObjectionInput) => {
  const target = roundForCategory[input.category]
  return {
    userId: input.userId,
    targetRoundId: target.roundId,
    targetCategory: target.category,
    kind: kindForReason(input.reason),
    reason: input.note.slice(0, 300),
    anchor: { claimIds: [], candidateIds: [input.decisionId], messageSeqs: [] },
    lateConstraints: input.lateConstraint ? [input.lateConstraint] : [],
    budgetDeltaPerPersonKrw: input.budgetDeltaPerPersonKrw ?? 0,
    excludeCandidateIds: input.reason === 'other-candidate' ? [input.decisionId] : [],
  }
}

const impactToSnapshot = (impact: ObjectionImpactResponse): RerunImpactSnapshot => ({
  source: 'live',
  affectedDecisions: impact.staleNodes.map((nodeId) => ({
    label: nodeLabels[nodeId] ?? nodeId,
    detail: '이 항목이 다시 계산돼요',
  })),
  decisionCount: impact.rerunRounds.length,
  estimatedTimeLabel: impact.estimatedDurationSec > 0
    ? `약 ${Math.max(1, Math.round(impact.estimatedDurationSec / 60))}분`
    : '예상 시간 정보 없음',
  bookingImpact: impact.bookedNodesAffected.length === 0
    ? '현재 예약 항목 영향 없음'
    : `${impact.bookedNodesAffected.map((nodeId) => nodeLabels[nodeId] ?? nodeId).join(' · ')} 영향 가능`,
  approvalRequired: impact.approvalRequired,
  remainingAfterThis: impact.remainingAfterThis,
  note: null,
})

export class ApiRerunRepository implements RerunRepository {
  async getQuota(roomId: string): Promise<RerunQuota> {
    const quota = await requestJson<ObjectionQuotaResponse>(
      `/api/rooms/${encodeURIComponent(roomId)}/objections`,
    )
    return { caps: quota.caps, remaining: quota.remaining }
  }

  async preview(input: ObjectionInput): Promise<RerunImpactSnapshot> {
    const preview = await requestJson<ObjectionPreviewResponse>(
      `/api/rooms/${encodeURIComponent(input.roomId)}/objections/preview`,
      { method: 'POST', body: toRequestBody(input) },
    )
    return impactToSnapshot(preview.impact)
  }

  async submit(input: ObjectionInput): Promise<RerunSubmission> {
    const record = await requestJson<ObjectionRecordResponse>(
      `/api/rooms/${encodeURIComponent(input.roomId)}/objections`,
      { method: 'POST', body: toRequestBody(input) },
    )
    return {
      source: 'live',
      objectionId: record.objectionId,
      status: record.status,
      runId: record.runId,
      needsApproval: record.status === 'needs_approval',
      rejectedReason: record.rejectReason,
    }
  }
}

export const createRerunRepository = (): RerunRepository =>
  resolveDataMode() === 'mock' ? new MockRerunRepository() : new ApiRerunRepository()

export const rerunRepository = createRerunRepository()
