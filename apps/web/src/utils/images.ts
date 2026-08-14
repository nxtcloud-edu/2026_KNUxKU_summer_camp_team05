import type { SyntheticEvent } from 'react'

export function useLocalImageFallback(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.onerror = null
  event.currentTarget.src = '/assets/fukuoka.webp'
}
