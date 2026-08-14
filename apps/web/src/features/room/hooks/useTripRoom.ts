import { useCallback, useEffect, useRef, useState } from 'react'
import { resolveDataMode } from '../../../api/dataMode'
import type { Participant } from '../../../product/types'
import {
  ensureUserId,
  readStoredRoomId,
  writeRoomSession,
} from '../../../session/roomSession'
import { readRoomIdFromUrl, writeRoomIdToUrl } from '../../../utils/navigation'
import { toParticipant } from '../adapters/participantAdapter'
import { roomRepository, type RoomSnapshot } from '../api/roomRepository'

/**
 * The room a participant is actually in.
 *
 * The id comes from the URL first (invite links are real links), then from
 * storage (a plain reload). Members are polled while the lobby is open so a
 * host can see the room fill up without refreshing.
 */
const LOBBY_POLL_MS = 5000

export type TripRoomState = {
  roomId: string | null
  userId: string | null
  room: RoomSnapshot | null
  participants: Participant[]
  loading: boolean
  error: string | null
}

const message = (error: unknown, fallback: string) =>
  error instanceof Error && error.message.length > 0 ? error.message : fallback

export function useTripRoom(pollMembers: boolean) {
  const [state, setState] = useState<TripRoomState>({
    roomId: readRoomIdFromUrl() ?? readStoredRoomId(),
    userId: null,
    room: null,
    participants: [],
    loading: false,
    error: null,
  })
  const roomIdRef = useRef(state.roomId)
  roomIdRef.current = state.roomId

  // Learn our participant id once. In api mode the backend owns it.
  useEffect(() => {
    let active = true
    void ensureUserId()
      .then((userId) => { if (active) setState((current) => ({ ...current, userId })) })
      .catch(() => { /* the room screens surface this on the next request */ })
    return () => { active = false }
  }, [])

  const refresh = useCallback(async (roomId: string | null = roomIdRef.current) => {
    if (!roomId) return
    setState((current) => ({ ...current, loading: true }))
    try {
      const [room, members] = await Promise.all([
        roomRepository.getRoom(roomId),
        roomRepository.listMembers(roomId),
      ])
      setState((current) => ({
        ...current,
        room,
        participants: members.map((member) => toParticipant(member)),
        loading: false,
        error: null,
      }))
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: message(error, '여행 방 정보를 불러오지 못했어요.'),
      }))
    }
  }, [])

  /** Create a room for a destination and make its id part of the address. */
  const createRoom = useCallback(async (destinationId: string): Promise<string | null> => {
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const created = await roomRepository.createRoom(destinationId)
      writeRoomSession({ roomId: created.roomId, destinationId })
      writeRoomIdToUrl(created.roomId)
      roomIdRef.current = created.roomId
      setState((current) => ({ ...current, roomId: created.roomId, loading: false }))
      await refresh(created.roomId)
      return created.roomId
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: message(error, '여행 방을 만들지 못했어요.'),
      }))
      return null
    }
  }, [refresh])

  /** Join an existing room (invite link). Re-joining does not add a row. */
  const joinRoom = useCallback(async (roomId: string, role: 'host' | 'member' = 'member') => {
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      await roomRepository.joinRoom(roomId, role)
      writeRoomSession({ roomId })
      writeRoomIdToUrl(roomId)
      roomIdRef.current = roomId
      setState((current) => ({ ...current, roomId, loading: false }))
      await refresh(roomId)
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: message(error, '여행 방에 들어가지 못했어요.'),
      }))
    }
  }, [refresh])

  const confirmPersona = useCallback(async () => {
    const roomId = roomIdRef.current
    if (!roomId) throw new Error('여행 방 정보가 없어요.')
    await roomRepository.confirmPersona(roomId)
    await refresh(roomId)
  }, [refresh])

  // Keep the room id in the URL whenever we know it.
  useEffect(() => {
    if (state.roomId && readRoomIdFromUrl() !== state.roomId) writeRoomIdToUrl(state.roomId)
  }, [state.roomId])

  useEffect(() => {
    if (!state.roomId) return
    void refresh(state.roomId)
    if (!pollMembers) return
    const timer = window.setInterval(() => { void refresh(state.roomId) }, LOBBY_POLL_MS)
    return () => window.clearInterval(timer)
  }, [pollMembers, refresh, state.roomId])

  return {
    ...state,
    source: state.room?.source ?? (resolveDataMode() === 'mock' ? 'fixture' as const : 'live' as const),
    createRoom,
    joinRoom,
    confirmPersona,
    refresh,
  }
}
