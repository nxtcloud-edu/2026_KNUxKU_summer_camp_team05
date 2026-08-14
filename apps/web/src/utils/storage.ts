export type BrowserStorageKind = 'local' | 'session'

function getStorage(kind: BrowserStorageKind): Storage | null {
  if (typeof window === 'undefined') return null

  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

export function readStorage(kind: BrowserStorageKind, key: string): string | null {
  try {
    return getStorage(kind)?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function writeStorage(kind: BrowserStorageKind, key: string, value: string): boolean {
  try {
    const storage = getStorage(kind)
    if (!storage) return false
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeStorage(kind: BrowserStorageKind, key: string): void {
  try {
    getStorage(kind)?.removeItem(key)
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}
