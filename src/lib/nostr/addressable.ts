import { isValidHex32 } from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'

const MAX_IDENTIFIER_CHARS = 512
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/u

export interface AddressCoordinate {
  kind: number
  pubkey: string
  identifier: string
}

export function isAddressableKind(kind: number): boolean {
  return Number.isInteger(kind) && kind >= 30_000 && kind < 40_000
}

export function normalizeAddressIdentifier(identifier: string): string | null {
  if (typeof identifier !== 'string') return null
  if (identifier.length === 0 || identifier.length > MAX_IDENTIFIER_CHARS) return null
  if (CONTROL_CHARS.test(identifier)) return null
  if (identifier.trim().length === 0) return null
  return identifier
}

export function parseAddressCoordinate(value: string): AddressCoordinate | null {
  if (typeof value !== 'string') return null

  const firstColon = value.indexOf(':')
  const secondColon = value.indexOf(':', firstColon + 1)
  if (firstColon <= 0 || secondColon <= firstColon + 1) return null

  const rawKind = value.slice(0, firstColon)
  const rawPubkey = value.slice(firstColon + 1, secondColon)
  const rawIdentifier = value.slice(secondColon + 1)

  if (!/^\d{1,10}$/.test(rawKind) || !isValidHex32(rawPubkey)) return null

  const kind = Number(rawKind)
  const identifier = normalizeAddressIdentifier(rawIdentifier)
  if (!Number.isSafeInteger(kind) || !isAddressableKind(kind) || !identifier) {
    return null
  }

  return {
    kind,
    pubkey: rawPubkey,
    identifier,
  }
}

export function getEventAddressCoordinate(event: NostrEvent): string | null {
  if (!isAddressableKind(event.kind) || !isValidHex32(event.pubkey)) return null

  for (const tag of event.tags) {
    if (tag[0] !== 'd' || typeof tag[1] !== 'string') continue
    const identifier = normalizeAddressIdentifier(tag[1])
    if (!identifier) continue
    return `${event.kind}:${event.pubkey}:${identifier}`
  }

  return null
}
