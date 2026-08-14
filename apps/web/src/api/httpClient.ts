import { apiBaseUrl } from './dataMode'

/**
 * The single place the browser is allowed to talk to the network from.
 *
 * `credentials: 'include'` is required: the backend issues an unsigned
 * continuity cookie (`moa_uid`) in `apps/api/src/routes/session.ts`, and a
 * participant who loses it becomes a different person on refresh.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string | null
  readonly body: unknown

  constructor(status: number, code: string | null, message: string, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.body = body
  }
}

export class ApiNotConfiguredError extends Error {
  constructor() {
    super('백엔드 주소가 설정되지 않았어요. VITE_API_BASE_URL을 확인해 주세요.')
    this.name = 'ApiNotConfiguredError'
  }
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Survey and objection intake identify the room through this header. */
  roomId?: string
  signal?: AbortSignal
}

const readErrorCode = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null) return null
  const error = (body as Record<string, unknown>)['error']
  return typeof error === 'string' ? error : null
}

const readErrorMessage = (body: unknown, fallback: string): string => {
  if (typeof body !== 'object' || body === null) return fallback
  const message = (body as Record<string, unknown>)['message']
  return typeof message === 'string' && message.length > 0 ? message : fallback
}

async function readJson(response: Response): Promise<unknown> {
  if (response.status === 204) return null
  const text = await response.text()
  if (text.length === 0) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ApiError(response.status, null, '서버 응답을 읽지 못했어요.', text)
  }
}

export async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const baseUrl = apiBaseUrl()
  if (!baseUrl) throw new ApiNotConfiguredError()

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.roomId) headers['x-room-id'] = options.roomId

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.signal ? { signal: options.signal } : {}),
  })

  const body = await readJson(response)
  if (!response.ok) {
    throw new ApiError(
      response.status,
      readErrorCode(body),
      readErrorMessage(body, `요청이 실패했어요 (${response.status})`),
      body,
    )
  }
  return body as T
}

export const isNotFound = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 404
