import { NDKEvent } from '@nostr-dev-kit/ndk'
import {
  getEventAddressCoordinate,
  parseAddressCoordinate,
} from '@/lib/nostr/addressable'
import { getEventReadRelayHints, insertEvent } from '@/lib/db/nostr'
import { withOptionalClientTag } from '@/lib/nostr/appHandlers'
import { getDefaultRelayUrls, getNDK } from '@/lib/nostr/ndk'
import { publishEventWithNip65Outbox } from '@/lib/nostr/outbox'
import { buildQuoteTagsFromContent } from '@/lib/nostr/repost'
import {
  isValidHex32,
  sanitizeText,
} from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

const MAX_REASON_CHARS = 500

export interface ParsedDeletionEvent {
  id: string
  pubkey: string
  createdAt: number
  eventIds: string[]
  coordinates: string[]
  kinds: number[]
  reason?: string
}

export interface PublishDeletionRequestOptions {
  reason?: string
}

function normalizeReason(value: string | undefined): string {
  if (typeof value !== 'string') return ''
  return sanitizeText(value).trim().slice(0, MAX_REASON_CHARS)
}

function getRequestedEventIds(event: NostrEvent): string[] {
  const seen = new Set<string>()
  const eventIds: string[] = []

  for (const tag of event.tags) {
    const eventId = tag[0] === 'e' ? tag[1] : undefined
    if (!eventId || !isValidHex32(eventId) || seen.has(eventId)) continue
    seen.add(eventId)
    eventIds.push(eventId)
  }

  return eventIds
}

function getRequestedCoordinates(event: NostrEvent): string[] {
  const seen = new Set<string>()
  const coordinates: string[] = []

  for (const tag of event.tags) {
    if (tag[0] !== 'a' || typeof tag[1] !== 'string') continue
    const parsed = parseAddressCoordinate(tag[1])
    if (!parsed || parsed.pubkey !== event.pubkey || seen.has(tag[1])) continue
    seen.add(tag[1])
    coordinates.push(tag[1])
  }

  return coordinates
}

function getRequestedKinds(event: NostrEvent): number[] {
  const seen = new Set<number>()
  const kinds: number[] = []

  for (const tag of event.tags) {
    if (tag[0] !== 'k' || !/^\d{1,10}$/.test(tag[1] ?? '')) continue
    const kind = Number(tag[1])
    if (!Number.isSafeInteger(kind) || kind < 0 || seen.has(kind)) continue
    seen.add(kind)
    kinds.push(kind)
  }

  return kinds
}

async function resolveRelayHint(target: NostrEvent): Promise<string> {
  const relayHints = await getEventReadRelayHints(target.pubkey, 1)
  if (relayHints[0]) return relayHints[0]

  const defaultRelay = getDefaultRelayUrls()[0]
  if (!defaultRelay) {
    throw new Error('No relay hint available for deletion target.')
  }
  return defaultRelay
}

export function parseDeletionEvent(event: NostrEvent): ParsedDeletionEvent | null {
  if (event.kind !== Kind.EventDeletion) return null

  const eventIds = getRequestedEventIds(event)
  const coordinates = getRequestedCoordinates(event)
  if (eventIds.length === 0 && coordinates.length === 0) return null

  const reason = normalizeReason(event.content)

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    eventIds,
    coordinates,
    kinds: getRequestedKinds(event),
    ...(reason ? { reason } : {}),
  }
}

export async function publishDeletionRequest(
  target: NostrEvent,
  options: PublishDeletionRequestOptions = {},
  signal?: AbortSignal,
): Promise<NostrEvent> {
  if (target.kind === Kind.EventDeletion) {
    throw new Error('Deletion requests against kind-5 events have no effect.')
  }

  const ndk = getNDK()
  if (!ndk.signer) {
    throw new Error('No signer available — install a NIP-07 extension to publish deletion requests.')
  }

  const relayHint = await resolveRelayHint(target)
  const address = getEventAddressCoordinate(target)
  const event = new NDKEvent(ndk)
  event.kind = Kind.EventDeletion
  const reason = normalizeReason(options.reason)
  event.content = reason
  event.tags = await withOptionalClientTag([
    ['e', target.id, relayHint, target.pubkey],
    ['k', String(target.kind)],
    ...(address ? [['a', address, relayHint]] : []),
    ...buildQuoteTagsFromContent(reason),
  ], signal)

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  await event.sign()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  await publishEventWithNip65Outbox(event, signal)

  const rawEvent = event.rawEvent() as unknown as NostrEvent
  await insertEvent(rawEvent)
  return rawEvent
}
