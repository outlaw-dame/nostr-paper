import {
  decodeNostrURI,
  naddrEncode,
  neventEncode,
  type AddressPointer,
  type EventPointer,
  type ProfilePointer,
} from 'nostr-tools/nip19'
import { getEventAddressCoordinate, parseAddressCoordinate } from '@/lib/nostr/addressable'
import { isValidHex32 } from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'

type DecodedNip21 =
  | { type: 'npub'; data: string }
  | { type: 'note'; data: string }
  | { type: 'nprofile'; data: ProfilePointer }
  | { type: 'nevent'; data: EventPointer }
  | { type: 'naddr'; data: AddressPointer }

export interface Nip21Reference {
  uri: `nostr:${string}`
  value: string
  decoded: DecodedNip21
}

export interface DecodedEventReference {
  eventId: string
  relays: string[]
  author?: string
  kind?: number
  bech32?: string
}

export interface DecodedProfileReference {
  pubkey: string
  relays: string[]
  bech32?: string
}

export interface DecodedAddressReference {
  pubkey: string
  kind: number
  identifier: string
  relays: string[]
  bech32?: string
}

function trimReference(value: string): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isDecodedNip21(value: ReturnType<typeof decodeNostrURI>): value is DecodedNip21 {
  return (
    value.type === 'npub' ||
    value.type === 'note' ||
    value.type === 'nprofile' ||
    value.type === 'nevent' ||
    value.type === 'naddr'
  )
}

export function parseNip21Reference(value: string): Nip21Reference | null {
  const trimmed = trimReference(value)
  if (!trimmed) return null

  const decoded = decodeNostrURI(trimmed)
  if (!isDecodedNip21(decoded)) return null

  const bech32 = trimmed.startsWith('nostr:') ? trimmed.slice(6) : trimmed
  if (bech32.length === 0) return null

  return {
    uri: `nostr:${bech32}`,
    value: bech32,
    decoded,
  }
}

export function isNip21Uri(value: string): value is `nostr:${string}` {
  return parseNip21Reference(value)?.uri === value
}

export function formatNip21Reference(value: string, maxChars = 26): string {
  const parsed = parseNip21Reference(value)
  const normalized = parsed?.uri ?? trimReference(value) ?? value

  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(8, maxChars - 1))}…`
}

export function getNip21Route(value: string): string | null {
  const parsed = parseNip21Reference(value)
  if (!parsed) return null

  switch (parsed.decoded.type) {
    case 'npub':
    case 'nprofile':
      return `/profile/${encodeURIComponent(parsed.value)}`
    case 'note':
    case 'nevent':
      return `/note/${encodeURIComponent(parsed.value)}`
    case 'naddr':
      return `/a/${encodeURIComponent(parsed.value)}`
  }
}

export function decodeEventReference(value: string | null | undefined): DecodedEventReference | null {
  if (!value) return null
  if (isValidHex32(value)) {
    return {
      eventId: value,
      relays: [],
    }
  }

  const parsed = parseNip21Reference(value)
  if (!parsed) return null

  if (parsed.decoded.type === 'note') {
    return {
      eventId: parsed.decoded.data,
      relays: [],
      bech32: parsed.value,
    }
  }

  if (parsed.decoded.type === 'nevent') {
    return {
      eventId: parsed.decoded.data.id,
      relays: parsed.decoded.data.relays ?? [],
      ...(parsed.decoded.data.author ? { author: parsed.decoded.data.author } : {}),
      ...(parsed.decoded.data.kind !== undefined ? { kind: parsed.decoded.data.kind } : {}),
      bech32: parsed.value,
    }
  }

  return null
}

export function decodeProfileReference(value: string | null | undefined): DecodedProfileReference | null {
  if (!value) return null
  if (isValidHex32(value)) {
    return {
      pubkey: value,
      relays: [],
    }
  }

  const parsed = parseNip21Reference(value)
  if (!parsed) return null

  if (parsed.decoded.type === 'npub') {
    return {
      pubkey: parsed.decoded.data,
      relays: [],
      bech32: parsed.value,
    }
  }

  if (parsed.decoded.type === 'nprofile') {
    return {
      pubkey: parsed.decoded.data.pubkey,
      relays: parsed.decoded.data.relays ?? [],
      bech32: parsed.value,
    }
  }

  return null
}

export function decodeAddressReference(value: string | null | undefined): DecodedAddressReference | null {
  const parsed = value ? parseNip21Reference(value) : null
  if (!parsed || parsed.decoded.type !== 'naddr') return null

  return {
    pubkey: parsed.decoded.data.pubkey,
    kind: parsed.decoded.data.kind,
    identifier: parsed.decoded.data.identifier,
    relays: parsed.decoded.data.relays ?? [],
    bech32: parsed.value,
  }
}

export function buildEventReferenceValue(
  event: Pick<NostrEvent, 'id' | 'pubkey' | 'kind' | 'tags'>,
  relayHints: string[] = [],
): string | null {
  if (!isValidHex32(event.id) || !isValidHex32(event.pubkey)) return null

  const relays = [...new Set(relayHints.filter(Boolean))]
  const address = getEventAddressCoordinate(event as NostrEvent)

  if (address) {
    const parsed = parseAddressCoordinate(address)
    if (!parsed) return null

    return naddrEncode({
      kind: parsed.kind,
      pubkey: parsed.pubkey,
      identifier: parsed.identifier,
      ...(relays.length > 0 ? { relays } : {}),
    })
  }

  return neventEncode({
    id: event.id,
    author: event.pubkey,
    kind: event.kind,
    ...(relays.length > 0 ? { relays } : {}),
  })
}

export function buildEventReferenceUri(
  event: Pick<NostrEvent, 'id' | 'pubkey' | 'kind' | 'tags'>,
  relayHints: string[] = [],
): `nostr:${string}` | null {
  const value = buildEventReferenceValue(event, relayHints)
  return value ? `nostr:${value}` : null
}
