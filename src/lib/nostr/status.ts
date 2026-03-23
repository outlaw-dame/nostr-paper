import { NDKEvent, type NDKFilter } from '@nostr-dev-kit/ndk'
import { naddrEncode } from 'nostr-tools/nip19'
import { getLatestAddressableEvent, insertEvent } from '@/lib/db/nostr'
import { withOptionalClientTag } from '@/lib/nostr/appHandlers'
import { parseAddressCoordinate } from '@/lib/nostr/addressable'
import {
  decodeAddressReference,
  decodeEventReference,
  decodeProfileReference,
  getNip21Route,
} from '@/lib/nostr/nip21'
import { getNDK } from '@/lib/nostr/ndk'
import { buildExpirationTag, getEventExpiration, isEventExpired, normalizeExpiration } from '@/lib/nostr/expiration'
import { withRetry } from '@/lib/retry'
import {
  isValidHex32,
  sanitizeText,
} from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

const BLOCKED_URI_SCHEMES = new Set(['javascript', 'data', 'file', 'vbscript'])
const CUSTOM_URI_PATTERN = /^([a-z][a-z0-9+.-]*):([^\s]*)$/i
const MAX_STATUS_CONTENT_CHARS = 280
const DEFAULT_STATUS_IDENTIFIER = 'general'
export const USER_STATUS_UPDATED_EVENT = 'nostr-paper:user-status-updated'

export interface ParsedUserStatusEvent {
  event: NostrEvent
  id: string
  pubkey: string
  createdAt: number
  identifier: string
  content: string
  isCleared: boolean
  isExpired: boolean
  expiresAt?: number
  referenceUri?: string
  targetEventId?: string
  targetAddress?: string
  targetPubkey?: string
}

export interface PublishMusicStatusOptions {
  content: string
  reference?: string | null
  expiresAt?: number | null
  signal?: AbortSignal
}

function dispatchUserStatusUpdated(pubkey: string, identifier: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(USER_STATUS_UPDATED_EVENT, {
    detail: { pubkey, identifier },
  }))
}

function normalizeIdentifier(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function getIdentifier(event: NostrEvent): string | null {
  for (const tag of event.tags) {
    if (tag[0] !== 'd') continue
    const identifier = normalizeIdentifier(tag[1])
    if (identifier) return identifier
  }
  return null
}

function getReferenceUri(event: NostrEvent): string | undefined {
  for (const tag of event.tags) {
    if (tag[0] !== 'r' || typeof tag[1] !== 'string') continue
    const normalized = normalizeStatusReferenceUri(tag[1])
    if (normalized) return normalized
  }
  return undefined
}

function getTargetEventId(event: NostrEvent): string | undefined {
  for (const tag of event.tags) {
    if (tag[0] !== 'e' || !isValidHex32(tag[1] ?? '')) continue
    return tag[1]
  }
  return undefined
}

function getTargetAddress(event: NostrEvent): string | undefined {
  for (const tag of event.tags) {
    if (tag[0] !== 'a' || typeof tag[1] !== 'string') continue
    if (parseAddressCoordinate(tag[1])) return tag[1]
  }
  return undefined
}

function getTargetPubkey(event: NostrEvent): string | undefined {
  for (const tag of event.tags) {
    if (tag[0] !== 'p' || !isValidHex32(tag[1] ?? '')) continue
    return tag[1]
  }
  return undefined
}

function normalizeStatusContent(value: string | undefined): string {
  if (typeof value !== 'string') return ''
  return sanitizeText(value).replace(/\r\n?/g, '\n').trim().slice(0, MAX_STATUS_CONTENT_CHARS)
}

export function normalizeStatusReferenceUri(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || /[\u0000-\u001f\u007f\s]/u.test(trimmed)) return null

  let parsedScheme: string | null = null
  const customMatch = trimmed.match(CUSTOM_URI_PATTERN)
  if (customMatch?.[1]) {
    parsedScheme = customMatch[1].toLowerCase()
  }

  if (!parsedScheme) return null
  if (BLOCKED_URI_SCHEMES.has(parsedScheme)) return null

  if (parsedScheme === 'http' || parsedScheme === 'https') {
    try {
      const normalized = new URL(trimmed)
      normalized.hash = ''
      normalized.username = ''
      normalized.password = ''
      return normalized.toString()
    } catch {
      return null
    }
  }

  return trimmed
}

export function parseUserStatusEvent(
  event: NostrEvent,
  now = Math.floor(Date.now() / 1000),
): ParsedUserStatusEvent | null {
  if (event.kind !== Kind.UserStatus) return null

  const identifier = getIdentifier(event)
  if (!identifier) return null

  const content = normalizeStatusContent(event.content)
  const expiresAt = getEventExpiration(event)
  const isExpired = isEventExpired(event, now)
  const referenceUri = getReferenceUri(event)
  const targetEventId = getTargetEventId(event)
  const targetAddress = getTargetAddress(event)
  const targetPubkey = getTargetPubkey(event)

  return {
    event,
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    identifier,
    content,
    isCleared: content.length === 0,
    isExpired,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(referenceUri ? { referenceUri } : {}),
    ...(targetEventId ? { targetEventId } : {}),
    ...(targetAddress ? { targetAddress } : {}),
    ...(targetPubkey ? { targetPubkey } : {}),
  }
}

export function isActiveUserStatus(status: ParsedUserStatusEvent | null | undefined): status is ParsedUserStatusEvent {
  return Boolean(status && !status.isCleared && !status.isExpired)
}

export function getUserStatusLabel(status: ParsedUserStatusEvent): string {
  if (status.identifier === 'music') {
    return status.content.length > 0 ? `Listening to ${status.content}` : 'Listening status cleared'
  }
  return status.content.length > 0 ? status.content : `${status.identifier} status cleared`
}

export function getUserStatusExternalHref(status: ParsedUserStatusEvent): string | null {
  if (status.referenceUri?.startsWith('nostr:')) return null
  return status.referenceUri ?? null
}

function buildAddressRoute(address: string): string | null {
  const parsed = parseAddressCoordinate(address)
  if (!parsed) return null
  try {
    const naddr = naddrEncode({
      kind: parsed.kind,
      pubkey: parsed.pubkey,
      identifier: parsed.identifier,
    })
    return `/a/${encodeURIComponent(naddr)}`
  } catch {
    return null
  }
}

export function getUserStatusRoute(status: ParsedUserStatusEvent): string | null {
  if (status.targetAddress) {
    return buildAddressRoute(status.targetAddress)
  }
  if (status.targetEventId) {
    return `/note/${status.targetEventId}`
  }
  if (status.targetPubkey) {
    return `/profile/${encodeURIComponent(status.targetPubkey)}`
  }
  if (status.referenceUri?.startsWith('nostr:')) {
    return getNip21Route(status.referenceUri)
  }
  return null
}

export function buildStatusReferenceTags(reference: string | null | undefined): string[][] {
  const trimmed = reference?.trim()
  if (!trimmed) return []

  const decodedEvent = decodeEventReference(trimmed)
  if (decodedEvent) {
    const tags: string[][] = [
      decodedEvent.relays[0]
        ? ['e', decodedEvent.eventId, decodedEvent.relays[0]]
        : ['e', decodedEvent.eventId],
    ]
    if (decodedEvent.author && isValidHex32(decodedEvent.author)) {
      tags.push(['p', decodedEvent.author])
    }
    return tags
  }

  const decodedAddress = decodeAddressReference(trimmed)
  if (decodedAddress) {
    const coordinate = `${decodedAddress.kind}:${decodedAddress.pubkey}:${decodedAddress.identifier}`
    const tags: string[][] = [
      decodedAddress.relays[0]
        ? ['a', coordinate, decodedAddress.relays[0]]
        : ['a', coordinate],
      ['p', decodedAddress.pubkey],
    ]
    return tags
  }

  const explicitProfileReference = trimmed.startsWith('nostr:')
    || trimmed.startsWith('npub1')
    || trimmed.startsWith('nprofile1')
  const decodedProfile = explicitProfileReference ? decodeProfileReference(trimmed) : null
  if (decodedProfile) {
    return [
      decodedProfile.relays[0]
        ? ['p', decodedProfile.pubkey, decodedProfile.relays[0]]
        : ['p', decodedProfile.pubkey],
    ]
  }

  const coordinate = parseAddressCoordinate(trimmed)
  if (coordinate) {
    return [
      ['a', `${coordinate.kind}:${coordinate.pubkey}:${coordinate.identifier}`],
      ['p', coordinate.pubkey],
    ]
  }

  if (isValidHex32(trimmed)) {
    return [['e', trimmed]]
  }

  const uri = normalizeStatusReferenceUri(trimmed)
  if (!uri) {
    throw new Error('Status references must be a safe streaming URI or a valid NIP-21/event reference.')
  }

  return [['r', uri]]
}

async function publishUserStatusEvent(
  identifier: string,
  content: string,
  reference: string | null | undefined,
  expiresAt: number | null | undefined,
  signal?: AbortSignal,
): Promise<NostrEvent> {
  const ndk = getNDK()
  if (!ndk.signer) {
    throw new Error('No signer available — install a NIP-07 extension to publish user status.')
  }

  const normalizedContent = normalizeStatusContent(content)
  const tags: string[][] = [
    ['d', identifier],
    ...buildStatusReferenceTags(reference),
  ]

  if (expiresAt !== null && expiresAt !== undefined) {
    const normalizedExpiration = normalizeExpiration(expiresAt)
    if (
      normalizedExpiration === undefined ||
      normalizedExpiration <= Math.floor(Date.now() / 1000)
    ) {
      throw new Error('Status expiration must be a future Unix timestamp.')
    }
    const expirationTag = buildExpirationTag(normalizedExpiration)
    if (expirationTag) tags.push(expirationTag)
  }

  const event = new NDKEvent(ndk)
  event.kind = Kind.UserStatus
  event.content = normalizedContent
  event.tags = await withOptionalClientTag(tags, signal)

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  await event.sign()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  await withRetry(
    async () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await event.publishReplaceable()
    },
    {
      maxAttempts: 2,
      baseDelayMs: 750,
      maxDelayMs: 2_500,
      ...(signal ? { signal } : {}),
    },
  )

  const rawEvent = event.rawEvent() as unknown as NostrEvent
  await insertEvent(rawEvent)
  dispatchUserStatusUpdated(rawEvent.pubkey, identifier)
  return rawEvent
}

export async function publishMusicStatus({
  content,
  reference,
  expiresAt,
  signal,
}: PublishMusicStatusOptions): Promise<NostrEvent> {
  const normalizedContent = normalizeStatusContent(content)
  if (normalizedContent.length === 0) {
    throw new Error('Music status content cannot be empty. Publish a clear event instead.')
  }

  return publishUserStatusEvent('music', normalizedContent, reference, expiresAt ?? null, signal)
}

export async function clearMusicStatus(signal?: AbortSignal): Promise<NostrEvent> {
  return publishUserStatusEvent('music', '', null, null, signal)
}

export async function getLatestUserStatus(
  pubkey: string,
  identifier = DEFAULT_STATUS_IDENTIFIER,
): Promise<ParsedUserStatusEvent | null> {
  const event = await getLatestAddressableEvent(pubkey, Kind.UserStatus, identifier)
  const parsed = event ? parseUserStatusEvent(event) : null
  return isActiveUserStatus(parsed) ? parsed : null
}

export async function fetchFreshUserStatus(
  pubkey: string,
  identifier = DEFAULT_STATUS_IDENTIFIER,
  signal?: AbortSignal,
): Promise<void> {
  const ndk = getNDK()
  const filter = {
    authors: [pubkey],
    kinds: [Kind.UserStatus as unknown as number],
    '#d': [identifier],
    limit: 10,
  } as unknown as NDKFilter

  await withRetry(
    async () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await ndk.fetchEvents(filter, { closeOnEose: true })
    },
    {
      maxAttempts: 2,
      baseDelayMs: 1_000,
      maxDelayMs: 3_000,
      ...(signal ? { signal } : {}),
    },
  )
}
