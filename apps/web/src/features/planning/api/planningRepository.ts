import type {
  DateResolutionResponse,
  RoomProgressResponse,
  RoomStatus,
  RunStatus,
  StartCheckResponse,
  StartRunResponse,
  StartTriggerId,
} from '../../../api/backendContracts'
import { resolveDataMode } from '../../../api/dataMode'
import { ApiError, requestJson } from '../../../api/httpClient'
import { readStorage, writeStorage } from '../../../utils/storage'

/**
 * Date resolution and the planning run.
 *
 * The planning screen is a **reader**: it starts a run once and then polls
 * progress. Nothing here invents a percentage — an unknown state stays unknown
 * and a stopped run reports why it stopped.
 *
 * Backend: apps/api/src/routes/rooms.ts (start) · results.ts (progress, plan)
 */

export type PlanningStepState = 'done' | 'active' | 'pending' | 'failed'

export type PlanningStepView = {
  id: string
  label: string
  state: PlanningStepState
}

export type PlanningSnapshot = {
  source: 'fixture' | 'live'
  roomStatus: RoomStatus | null
  runId: string | null
  runStatus: RunStatus | null
  /** 0–100 as reported by the backend. Never smoothed on the client. */
  percent: number
  steps: PlanningStepView[]
  /** Why the run stopped. Null while it is healthy. */
  failureReason: string | null
  /** Progress is blocked until the host answers these (INV-5). */
  pendingApprovals: number
  finished: boolean
  startedAt: string | null
  finishedAt: string | null
}

export type DateResolutionOption = {
  id: string
  code: string
  rangeLabel: string
  start: string | null
  end: string | null
  attendeeLabel: string
  detail: string
  recommended?: boolean
}

export type DateResolutionSnapshot = {
  source: 'fixture' | 'live'
  /** `resolved` has a range · `choice-required` has options · `unavailable` has a reason. */
  status: 'resolved' | 'choice-required' | 'unavailable'
  reason: string | null
  resolved: { start: string | null; end: string | null; label: string; detail: string } | null
  options: DateResolutionOption[]
}

export interface PlanningRepository {
  getDateResolution(roomId: string): Promise<DateResolutionSnapshot>
  chooseDate(roomId: string, option: DateResolutionOption): Promise<DateResolutionSnapshot>
  /** Idempotent from the screen's point of view: returns the live run if one exists. */
  startRun(roomId: string, trigger?: StartTriggerId): Promise<PlanningSnapshot>
  getProgress(roomId: string): Promise<PlanningSnapshot | null>
}

/**
 * Why a meeting cannot start yet, in the user's words.
 * Codes: `triggerRejectionReasons` in packages/contracts/src/result.ts
 */
const triggerRejectionMessages: Record<string, string> = {
  already_running: '이미 회의가 진행 중이에요.',
  not_enough_members: '참여자가 더 필요해요.',
  survey_incomplete: '아직 설문을 마치지 않은 참여자가 있어요.',
  persona_unconfirmed: '아직 여행 기준을 확인하지 않은 참여자가 있어요.',
  not_host: '방장만 회의를 먼저 시작할 수 있어요.',
  deadline_not_set: '마감 기한이 설정되지 않았어요.',
  deadline_not_reached: '마감 기한에 도달하지 않았어요.',
  not_enough_attendees: '회의에 설 수 있는 참여자가 부족해요.',
}

/**
 * The queue is off (`ENABLE_QUEUE=false`) or Redis is unreachable. The API
 * answers 503 and deliberately does not move the room to QUEUED, so the screen
 * must not show a room that is waiting for a result nobody will produce.
 */
const queueOfflineMessage =
  '회의가 큐에 등록되지 않았어요. 워커 큐가 꺼져 있으면(ENABLE_QUEUE=false) 결과가 만들어지지 않아요.'

/** Round groups as the backend numbers them (packages/contracts/src/rounds.ts). */
const roundGroups: Array<{ id: string; label: string; roundIds: string[] }> = [
  { id: 'prep', label: '회의 순서 정리', roundIds: ['r_0'] },
  { id: 'transport', label: '오는 길·가는 길', roundIds: ['r_1a', 'r_1b'] },
  { id: 'stay', label: '체류 거점·숙소', roundIds: ['r_2'] },
  { id: 'activity', label: '갈 곳·할 일', roundIds: ['r_3'] },
  { id: 'dining', label: '식사', roundIds: ['r_4'] },
  { id: 'schedule', label: '날짜별 일정·현지 이동', roundIds: ['r_5'] },
  { id: 'budget', label: '최종 확인', roundIds: ['r_6'] },
]

/* -------------------------------------------------------------------- mock */

const MOCK_RUN_KEY = 'moa-mock-run'
const mockStepLabels = [
  '오는 길·가는 길',
  '체류 거점·숙소',
  '갈 곳·할 일',
  '식사',
  '날짜별 일정·현지 이동',
  '최종 확인',
]
/** How long a fixture "meeting" takes before the demo result is available. */
const MOCK_STEP_MS = 2600

type MockRun = { roomId: string; runId: string; startedAt: number }

const readMockRun = (roomId: string): MockRun | null => {
  const raw = readStorage('local', MOCK_RUN_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as MockRun
    return parsed.roomId === roomId ? parsed : null
  } catch {
    return null
  }
}

function mockSnapshot(run: MockRun): PlanningSnapshot {
  const elapsed = Date.now() - run.startedAt
  const completed = Math.min(mockStepLabels.length, Math.floor(elapsed / MOCK_STEP_MS))
  const finished = completed >= mockStepLabels.length
  return {
    source: 'fixture',
    roomStatus: finished ? 'COMPLETED' : 'RUNNING',
    runId: run.runId,
    runStatus: finished ? 'COMPLETED' : 'RUNNING',
    percent: Math.round((completed / mockStepLabels.length) * 100),
    steps: mockStepLabels.map((label, index) => ({
      id: `mock-step-${index}`,
      label,
      state: index < completed ? 'done' : index === completed ? 'active' : 'pending',
    })),
    failureReason: null,
    pendingApprovals: 0,
    finished,
    startedAt: new Date(run.startedAt).toISOString(),
    finishedAt: finished ? new Date(run.startedAt + mockStepLabels.length * MOCK_STEP_MS).toISOString() : null,
  }
}

export class MockPlanningRepository implements PlanningRepository {
  async getDateResolution(): Promise<DateResolutionSnapshot> {
    return {
      source: 'fixture',
      status: 'choice-required',
      reason: '이 날짜 비교는 프론트엔드 데모 데이터입니다. 실제 중복 계산은 서버의 참여자 응답이 필요해요.',
      resolved: null,
      options: [
        { id: 'full', code: 'A', rangeLabel: '10/15–10/18', start: '2026-10-15', end: '2026-10-18', attendeeLabel: '4명 참여 가능', detail: '선호한 3박 4일 유지' },
        { id: 'shorter', code: 'B', rangeLabel: '10/15–10/17', start: '2026-10-15', end: '2026-10-17', attendeeLabel: '5명 모두 가능', detail: '1박 단축 · 모두 함께', recommended: true },
      ],
    }
  }

  async chooseDate(_roomId: string, option: DateResolutionOption): Promise<DateResolutionSnapshot> {
    return {
      source: 'fixture',
      status: 'resolved',
      reason: null,
      resolved: {
        start: option.start,
        end: option.end,
        label: option.rangeLabel,
        detail: `${option.attendeeLabel} · ${option.detail}`,
      },
      options: [],
    }
  }

  async startRun(roomId: string): Promise<PlanningSnapshot> {
    const existing = readMockRun(roomId)
    const run = existing ?? { roomId, runId: `demo-run-${Date.now().toString(36)}`, startedAt: Date.now() }
    if (!existing) writeStorage('local', MOCK_RUN_KEY, JSON.stringify(run))
    return mockSnapshot(run)
  }

  async getProgress(roomId: string): Promise<PlanningSnapshot | null> {
    const run = readMockRun(roomId)
    return run ? mockSnapshot(run) : null
  }
}

/* --------------------------------------------------------------------- api */

const formatIsoDate = (value: string | null): string => {
  if (!value) return ''
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(date)
}

export function progressToSnapshot(progress: RoomProgressResponse): PlanningSnapshot {
  const settled = new Set(progress.rounds.filter((round) => round.settled).map((round) => round.roundId))
  const failed = new Set(progress.rounds.filter((round) => round.phase === 'FAILED').map((round) => round.roundId))
  const running = new Set(
    progress.rounds
      .filter((round) => !round.settled && round.phase !== 'FAILED' && round.phase !== 'PENDING')
      .map((round) => round.roundId),
  )

  const steps: PlanningStepView[] = roundGroups.map((group) => {
    const state: PlanningStepState = group.roundIds.some((id) => failed.has(id))
      ? 'failed'
      : group.roundIds.every((id) => settled.has(id))
        ? 'done'
        : group.roundIds.some((id) => running.has(id))
          ? 'active'
          : 'pending'
    return { id: group.id, label: group.label, state }
  })

  return {
    source: 'live',
    roomStatus: progress.roomStatus,
    runId: progress.runId,
    runStatus: progress.runStatus,
    percent: progress.percent,
    steps,
    failureReason: progress.failureReason,
    pendingApprovals: progress.pendingApprovals,
    finished: progress.runStatus === 'COMPLETED' || progress.runStatus === 'FAILED',
    startedAt: progress.startedAt,
    finishedAt: progress.finishedAt,
  }
}

/** Nothing is known yet. Used only to carry a failure reason to the screen. */
const emptySnapshot = (): PlanningSnapshot => ({
  source: 'live',
  roomStatus: null,
  runId: null,
  runStatus: null,
  percent: 0,
  steps: roundGroups.map((group) => ({ id: group.id, label: group.label, state: 'pending' })),
  failureReason: null,
  pendingApprovals: 0,
  finished: false,
  startedAt: null,
  finishedAt: null,
})

export class ApiPlanningRepository implements PlanningRepository {
  private toDateSnapshot(response: DateResolutionResponse): DateResolutionSnapshot {
    if (response.data === null) {
      return {
        source: 'live',
        status: 'unavailable',
        reason: response.reason ?? '아직 확정된 여행 날짜가 없어요.',
        resolved: null,
        options: [],
      }
    }

    const chosen = response.data.chosen
    if (response.status === 'VERIFIED' && chosen !== null) {
      return {
        source: 'live',
        status: 'resolved',
        reason: null,
        resolved: {
          start: chosen.start,
          end: chosen.end,
          label: `${formatIsoDate(chosen.start)} – ${formatIsoDate(chosen.end)}`,
          detail: `${chosen.nights}박 ${chosen.nights + 1}일 · ${chosen.attendees.length}명 참여`,
        },
        options: [],
      }
    }

    if (response.status !== 'NEEDS_USER_CHOICE') {
      return {
        source: 'live',
        status: 'unavailable',
        reason: response.reason ?? response.data.reason,
        resolved: null,
        options: [],
      }
    }

    return {
      source: 'live',
      status: 'choice-required',
      reason: response.reason ?? response.data.reason,
      resolved: null,
      options: response.data.windows.map((window, index) => ({
        id: `${window.start}:${window.end}`,
        code: String.fromCharCode(65 + index),
        rangeLabel: `${formatIsoDate(window.start)} – ${formatIsoDate(window.end)}`,
        start: window.start,
        end: window.end,
        attendeeLabel: `${window.attendees.length}명 참여 가능`,
        detail: window.absentees.length === 0
          ? `${window.nights}박 · 전원 참여`
          : `${window.nights}박 · ${window.absentees.length}명 불참`,
        recommended: index === 0,
      })),
    }
  }

  async getDateResolution(roomId: string): Promise<DateResolutionSnapshot> {
    const response = await requestJson<DateResolutionResponse>(
      `/api/rooms/${encodeURIComponent(roomId)}/date-resolution`,
    )
    return this.toDateSnapshot(response)
  }

  async chooseDate(roomId: string, option: DateResolutionOption): Promise<DateResolutionSnapshot> {
    if (option.start === null || option.end === null) {
      throw new ApiError(400, 'invalid_date_choice', '선택한 날짜 범위를 확인해 주세요.', null)
    }
    const response = await requestJson<DateResolutionResponse>(
      `/api/rooms/${encodeURIComponent(roomId)}/date-resolution/choice`,
      { method: 'POST', body: { start: option.start, end: option.end } },
    )
    return this.toDateSnapshot(response)
  }

  /**
   * Which trigger this user is actually allowed to fire. Asking first means a
   * member who is not the host sees "we are still waiting for two people"
   * instead of a rejected request.
   */
  private async allowedTrigger(roomId: string): Promise<{ trigger: StartTriggerId | null; reason: string | null }> {
    const check = await requestJson<StartCheckResponse>(`/api/rooms/${encodeURIComponent(roomId)}/start-check`)
    const order: StartTriggerId[] = ['all_done', 'host', 'deadline']
    for (const candidate of order) {
      if (check.triggers[candidate]?.allowed) return { trigger: candidate, reason: null }
    }
    const rejection = order
      .map((candidate) => check.triggers[candidate]?.reason)
      .find((reason): reason is string => typeof reason === 'string' && reason.length > 0)
    return { trigger: null, reason: rejection ? triggerRejectionMessages[rejection] ?? rejection : null }
  }

  async startRun(roomId: string, trigger?: StartTriggerId): Promise<PlanningSnapshot> {
    const current = await this.getProgress(roomId)
    // A run already exists: never queue a second meeting for the same room.
    if (current?.runId) return current

    let chosen = trigger ?? null
    if (chosen === null) {
      const decision = await this.allowedTrigger(roomId)
      if (decision.trigger === null) {
        const snapshot = current ?? (await this.getProgress(roomId))
        if (snapshot) return { ...snapshot, failureReason: decision.reason }
        throw new ApiError(409, 'not_startable', decision.reason ?? '아직 회의를 시작할 수 없어요.', null)
      }
      chosen = decision.trigger
    }

    try {
      const started = await requestJson<StartRunResponse>(`/api/rooms/${encodeURIComponent(roomId)}/start`, {
        method: 'POST',
        body: { trigger: chosen },
      })
      // 202 with enqueued=false should not happen, but if it does the room is
      // not waiting for anything and must not look like it is.
      if (!started.enqueued) {
        const snapshot = await this.getProgress(roomId)
        return { ...(snapshot ?? emptySnapshot()), failureReason: queueOfflineMessage }
      }
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      // 503: the API accepted the request but the job never reached the queue
      // (ENABLE_QUEUE=false, or Redis is down). Waiting for a result is futile.
      if (error.status === 503) {
        const snapshot = await this.getProgress(roomId)
        return { ...(snapshot ?? emptySnapshot()), failureReason: queueOfflineMessage }
      }
      // 409 carries the rejection reason (survey incomplete, persona unconfirmed…).
      if (error.status !== 409) throw error
      const snapshot = await this.getProgress(roomId)
      if (snapshot) return { ...snapshot, failureReason: error.message }
      throw error
    }
    const started = await this.getProgress(roomId)
    if (!started) throw new ApiError(500, null, '회의를 시작했지만 진행 상태를 읽지 못했어요.', null)
    return started
  }

  async getProgress(roomId: string): Promise<PlanningSnapshot | null> {
    const progress = await requestJson<RoomProgressResponse>(
      `/api/rooms/${encodeURIComponent(roomId)}/progress`,
    )
    return progressToSnapshot(progress)
  }
}

export const createPlanningRepository = (): PlanningRepository =>
  resolveDataMode() === 'mock' ? new MockPlanningRepository() : new ApiPlanningRepository()

export const planningRepository = createPlanningRepository()
