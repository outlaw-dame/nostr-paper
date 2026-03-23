import type { NostrEvent } from '@/types'

const EXPIRATION_PATTERN = /^\d{1,12}$/

export function normalizeExpiration(value: number | string | null | undefined): number | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined
  }

  if (typeof value !== 'string' || !EXPIRATION_PATTERN.test(value)) return undefined

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

export function buildExpirationTag(expiresAt: number | string | null | undefined): string[] | null {
  const normalized = normalizeExpiration(expiresAt)
  return normalized !== undefined ? ['expiration', String(normalized)] : null
}

export function getEventExpiration(event: NostrEvent): number | undefined {
  for (const tag of event.tags) {
    if (tag[0] !== 'expiration') continue
    const expiration = normalizeExpiration(tag[1])
    if (expiration !== undefined) return expiration
  }

  return undefined
}

export function hasEventExpiration(event: NostrEvent): boolean {
  return getEventExpiration(event) !== undefined
}

export function isEventExpired(
  event: NostrEvent,
  now = Math.floor(Date.now() / 1000),
): boolean {
  const expiration = getEventExpiration(event)
  return expiration !== undefined && expiration <= now
}
