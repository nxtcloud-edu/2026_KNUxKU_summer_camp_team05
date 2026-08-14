/**
 * Where the product screens read their data from.
 *
 * `mock` keeps the demo runnable while the backend is not merged or not running.
 * `api` talks to the MOA backend only. The browser never calls a travel, map,
 * transit, weather or LLM provider directly — every live fact arrives through
 * our own API.
 *
 * Selection order:
 *   1. `VITE_MOA_DATA_MODE` (`mock` | `api`) — explicit wins.
 *   2. `VITE_API_BASE_URL` present -> `api`, absent -> `mock`.
 */
export type DataMode = 'mock' | 'api'

export const apiBaseUrl = (): string | null => {
  const raw = import.meta.env.VITE_API_BASE_URL
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().replace(/\/$/, '')
  return trimmed.length > 0 ? trimmed : null
}

export function resolveDataMode(): DataMode {
  const explicit = import.meta.env.VITE_MOA_DATA_MODE
  if (explicit === 'mock' || explicit === 'api') return explicit
  return apiBaseUrl() ? 'api' : 'mock'
}

export const isMockMode = (): boolean => resolveDataMode() === 'mock'

/**
 * Feature level override. Keeps `VITE_USE_MOCK_SURVEY` working for the survey,
 * which shipped before the shared mode existed.
 */
export function resolveFeatureDataMode(override: string | boolean | undefined): DataMode {
  if (override === 'true' || override === true) return 'mock'
  if (override === 'false' || override === false) return 'api'
  return resolveDataMode()
}
