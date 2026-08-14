import type { SessionResponse } from '../api/backendContracts'
import { resolveDataMode } from '../api/dataMode'
import { requestJson } from '../api/httpClient'
import { readStorage, removeStorage, writeStorage } from '../utils/storage'

/**
 * The identifiers a trip actually needs to survive a refresh: which room we are
 * in, who we are, and which run produced the result on screen.
 *
 * The room id also lives in the URL (`utils/navigation.ts`) so an invite link is
 * a real link. Storage is the fallback for a plain reload of `/`.
 */
const ROOM_ID_KEY = 'moa-room-id'
const USER_ID_KEY = 'moa-user-id'
const DESTINATION_KEY = 'moa-room-destination'
const RUN_ID_KEY = 'moa-run-id'

export type RoomSession = {
  roomId: string | null
  userId: string | null
  destinationId: string | null
}

const clean = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

export const readStoredRoomId = (): string | null => clean(readStorage('local', ROOM_ID_KEY))
export const readStoredUserId = (): string | null => clean(readStorage('local', USER_ID_KEY))
export const readStoredDestinationId = (): string | null => clean(readStorage('local', DESTINATION_KEY))
export const readStoredRunId = (): string | null => clean(readStorage('local', RUN_ID_KEY))

export function writeRoomSession(session: Partial<RoomSession>): void {
  if (session.roomId !== undefined) {
    if (session.roomId) writeStorage('local', ROOM_ID_KEY, session.roomId)
    else removeStorage('local', ROOM_ID_KEY)
  }
  if (session.userId !== undefined) {
    if (session.userId) writeStorage('local', USER_ID_KEY, session.userId)
    else removeStorage('local', USER_ID_KEY)
  }
  if (session.destinationId !== undefined) {
    if (session.destinationId) writeStorage('local', DESTINATION_KEY, session.destinationId)
    else removeStorage('local', DESTINATION_KEY)
  }
}

export function writeRunId(runId: string | null): void {
  if (runId) writeStorage('local', RUN_ID_KEY, runId)
  else removeStorage('local', RUN_ID_KEY)
}

export function clearRoomSession(): void {
  removeStorage('local', ROOM_ID_KEY)
  removeStorage('local', DESTINATION_KEY)
  removeStorage('local', RUN_ID_KEY)
}

/**
 * Our participant id. In `api` mode the backend owns it (unsigned continuity
 * cookie); we only cache what it tells us because the objection payload has to
 * carry `userId` explicitly.
 */
export async function ensureUserId(): Promise<string> {
  const cached = readStoredUserId()
  if (resolveDataMode() === 'mock') {
    if (cached) return cached
    const generated = `demo-${Math.random().toString(36).slice(2, 10)}`
    writeRoomSession({ userId: generated })
    return generated
  }

  const session = await requestJson<SessionResponse>('/api/session')
  writeRoomSession({ userId: session.userId })
  return session.userId
}
