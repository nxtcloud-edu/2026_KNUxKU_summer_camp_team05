import type {
  CreateRoomResponse,
  MemberResponse,
  RoomDetailResponse,
  RoomStatus,
  StartCheckResponse,
} from '../../../api/backendContracts'
import { resolveDataMode } from '../../../api/dataMode'
import { requestJson } from '../../../api/httpClient'
import { demoParticipants } from '../../../product/mockData'
import { readStorage, writeStorage } from '../../../utils/storage'
import { readStoredUserId } from '../../../session/roomSession'

/**
 * Room lifecycle: create, read, join, confirm persona, ask whether the meeting
 * may start. Screens never call `fetch` — they call this interface, and the
 * factory decides whether it is backed by fixtures or by the API.
 *
 * Backend: apps/api/src/routes/intake.ts · rooms.ts
 */
export type MemberSnapshot = {
  userId: string
  role: 'host' | 'member'
  surveySubmitted: boolean
  personaConfirmedAt: string | null
  joinedAt: string
  /** Display name when we have one. The backend has no name column yet. */
  displayName?: string
}

export type RoomSnapshot = {
  roomId: string
  packId: string
  status: RoomStatus
  deadlineAt: string | null
  memberCount: number
  surveyDone: number
  personaConfirmed: number
  me: {
    userId: string
    role: 'host' | 'member'
    surveySubmitted: boolean
    personaConfirmedAt: string | null
  } | null
  pendingApprovals: number
  source: 'fixture' | 'live'
}

export interface RoomRepository {
  createRoom(destinationId: string): Promise<{ roomId: string; status: RoomStatus }>
  getRoom(roomId: string): Promise<RoomSnapshot | null>
  listMembers(roomId: string): Promise<MemberSnapshot[]>
  joinRoom(roomId: string, role?: 'host' | 'member'): Promise<MemberSnapshot>
  confirmPersona(roomId: string): Promise<MemberSnapshot>
  getStartCheck(roomId: string): Promise<StartCheckResponse | null>
}

/* -------------------------------------------------------------------- mock */

const MOCK_ROOM_KEY = 'moa-mock-room'

type MockRoomState = {
  roomId: string
  packId: string
  status: RoomStatus
  surveySubmitted: boolean
  personaConfirmedAt: string | null
  joinedAt: string
}

const mockUserId = () => readStoredUserId() ?? 'demo-host'

const readMockRoom = (): MockRoomState | null => {
  const raw = readStorage('local', MOCK_ROOM_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as MockRoomState
  } catch {
    return null
  }
}

const writeMockRoom = (state: MockRoomState) => {
  writeStorage('local', MOCK_ROOM_KEY, JSON.stringify(state))
  return state
}

const mockRoomFor = (roomId: string, packId = 'demo-pack'): MockRoomState => {
  const existing = readMockRoom()
  if (existing?.roomId === roomId) return existing
  return writeMockRoom({
    roomId,
    packId,
    status: 'COLLECTING',
    surveySubmitted: false,
    personaConfirmedAt: null,
    joinedAt: new Date().toISOString(),
  })
}

/** Demo participants become members so the lobby keeps its shape offline. */
const mockMembers = (roomId: string, state: MockRoomState): MemberSnapshot[] =>
  demoParticipants.map((participant) => participant.isHost
    ? {
        userId: mockUserId(),
        role: 'host' as const,
        surveySubmitted: state.surveySubmitted,
        personaConfirmedAt: state.personaConfirmedAt,
        joinedAt: state.joinedAt,
        displayName: participant.name,
      }
    : {
        userId: `${roomId}:${participant.id}`,
        role: 'member' as const,
        surveySubmitted: participant.state === 'complete',
        personaConfirmedAt: participant.state === 'complete' ? state.joinedAt : null,
        joinedAt: state.joinedAt,
        displayName: participant.name,
      })

export class MockRoomRepository implements RoomRepository {
  async createRoom(destinationId: string) {
    const roomId = `demo-room-${Math.random().toString(36).slice(2, 8)}`
    const state = writeMockRoom({
      roomId,
      packId: destinationId,
      status: 'COLLECTING',
      surveySubmitted: false,
      personaConfirmedAt: null,
      joinedAt: new Date().toISOString(),
    })
    return { roomId: state.roomId, status: state.status }
  }

  async getRoom(roomId: string): Promise<RoomSnapshot> {
    const state = mockRoomFor(roomId)
    const members = mockMembers(roomId, state)
    return {
      roomId,
      packId: state.packId,
      status: state.status,
      deadlineAt: null,
      memberCount: members.length,
      surveyDone: members.filter((member) => member.surveySubmitted).length,
      personaConfirmed: members.filter((member) => member.personaConfirmedAt !== null).length,
      me: {
        userId: mockUserId(),
        role: 'host',
        surveySubmitted: state.surveySubmitted,
        personaConfirmedAt: state.personaConfirmedAt,
      },
      pendingApprovals: 0,
      source: 'fixture',
    }
  }

  async listMembers(roomId: string) {
    return mockMembers(roomId, mockRoomFor(roomId))
  }

  async joinRoom(roomId: string, role: 'host' | 'member' = 'host') {
    const state = mockRoomFor(roomId)
    return {
      userId: mockUserId(),
      role,
      surveySubmitted: state.surveySubmitted,
      personaConfirmedAt: state.personaConfirmedAt,
      joinedAt: state.joinedAt,
      displayName: demoParticipants.find((participant) => participant.isHost)?.name,
    }
  }

  /** Mock survey submission is recorded here so the persona gate behaves. */
  async markSurveySubmitted(roomId: string) {
    const state = mockRoomFor(roomId)
    writeMockRoom({ ...state, surveySubmitted: true })
  }

  async confirmPersona(roomId: string) {
    const state = mockRoomFor(roomId)
    const confirmedAt = new Date().toISOString()
    writeMockRoom({ ...state, surveySubmitted: true, personaConfirmedAt: confirmedAt })
    return {
      userId: mockUserId(),
      role: 'host' as const,
      surveySubmitted: true,
      personaConfirmedAt: confirmedAt,
      joinedAt: state.joinedAt,
    }
  }

  async getStartCheck(): Promise<StartCheckResponse | null> {
    return null
  }
}

/* --------------------------------------------------------------------- api */

const toMemberSnapshot = (member: MemberResponse): MemberSnapshot => ({
  userId: member.userId,
  role: member.role,
  surveySubmitted: member.surveySubmitted,
  personaConfirmedAt: member.personaConfirmedAt,
  joinedAt: member.joinedAt,
})

export class ApiRoomRepository implements RoomRepository {
  async createRoom(destinationId: string) {
    const created = await requestJson<CreateRoomResponse>('/api/trip-rooms', {
      method: 'POST',
      body: { schemaVersion: 1, destinationId },
    })
    return { roomId: created.roomId, status: created.status }
  }

  async getRoom(roomId: string): Promise<RoomSnapshot | null> {
    const detail = await requestJson<RoomDetailResponse>(`/api/rooms/${encodeURIComponent(roomId)}`)
    return {
      roomId: detail.roomId,
      packId: detail.packId,
      status: detail.status,
      deadlineAt: detail.deadlineAt,
      memberCount: detail.memberCount,
      surveyDone: detail.surveyDone,
      personaConfirmed: detail.personaConfirmed,
      me: detail.me,
      pendingApprovals: detail.pendingApprovals,
      source: 'live',
    }
  }

  async listMembers(roomId: string) {
    const response = await requestJson<{ members: MemberResponse[] }>(
      `/api/rooms/${encodeURIComponent(roomId)}/members`,
    )
    return response.members.map(toMemberSnapshot)
  }

  async joinRoom(roomId: string, role: 'host' | 'member' = 'member') {
    const member = await requestJson<MemberResponse>(
      `/api/rooms/${encodeURIComponent(roomId)}/members`,
      { method: 'POST', body: { role } },
    )
    return toMemberSnapshot(member)
  }

  async confirmPersona(roomId: string) {
    const member = await requestJson<MemberResponse>(
      `/api/rooms/${encodeURIComponent(roomId)}/persona/confirm`,
      { method: 'POST', body: {} },
    )
    return toMemberSnapshot(member)
  }

  async getStartCheck(roomId: string) {
    return requestJson<StartCheckResponse>(`/api/rooms/${encodeURIComponent(roomId)}/start-check`)
  }
}

export const createRoomRepository = (): RoomRepository =>
  resolveDataMode() === 'mock' ? new MockRoomRepository() : new ApiRoomRepository()

export const roomRepository = createRoomRepository()

/** Records a mock survey submission so the persona gate is reachable offline. */
export async function recordMockSurveySubmission(roomId: string): Promise<void> {
  if (roomRepository instanceof MockRoomRepository) await roomRepository.markSurveySubmitted(roomId)
}
