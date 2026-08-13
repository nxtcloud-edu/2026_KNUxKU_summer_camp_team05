import type { RoomSubmissionPayload, SurveySubmissionPayload } from './formState'

type SubmissionResult = { mode: 'api' | 'local' }

async function postOrStage(
  path: string,
  storageKey: string,
  payload: RoomSubmissionPayload | SurveySubmissionPayload,
): Promise<SubmissionResult> {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '')

  if (!apiBaseUrl) {
    sessionStorage.setItem(storageKey, JSON.stringify(payload))
    return { mode: 'local' }
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) throw new Error(`Submission failed: ${response.status}`)
  return { mode: 'api' }
}

export const submitRoomDraft = (payload: RoomSubmissionPayload) =>
  postOrStage('/api/trip-rooms', 'moa-pending-room', payload)

export const submitSurveyDraft = (payload: SurveySubmissionPayload) =>
  postOrStage('/api/survey-responses', 'moa-pending-survey', payload)
