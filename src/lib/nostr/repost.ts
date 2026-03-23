import { NDKEvent } from '@nostr-dev-kit/ndk'
import { getEventReadRelayHints, insertEvent } from '@/lib/db/nostr'
import { withOptionalClientTag } from '@/lib/nostr/appHandlers'
import {
  getEventAddressCoordinate,
  parseAddressCoordinate,
} from '@/lib/nostr/addressable'
import {
  decodeAddressReference,
  decodeEventReference,
  parseNip21Reference,
} from '@/lib/nostr/nip21'
import { getDefaultRelayUrls, getNDK } from '@/lib/nostr/ndk'
import { parseVideoEvent } from '@/lib/nostr/video'
import { withRetry } from '@/lib/retry'
import {
  LIMITS,
  extractNostrURIs,
  isStructurallyValidEvent,
  isValidEvent,
  isValidHex32,
  isValidRelayURL,
  sanitizeText,
} from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

const MAX_EMBEDDED_CONTENT_BYTES = 131_072

export interface ParsedRepostEvent {
  id: string
  pubkey: string
  createdAt: number
  repostKind: typeof Kind.Repost | typeof Kind.GenericRepost
  targetEventId: string
  targetPubkey?: string
  targetKind?: number
  targetAddress?: string
  relayHint?: string
  embeddedEvent?: NostrEvent
}

export interface QuoteReference {
  key: string
  eventId?: string
  address?: string
  relayHint?: string
  authorPubkey?: string
}

function getLastTag(event: NostrEvent, name: string): string[] | undefined {
  let found: string[] | undefined
  for (const tag of event.tags) {
    if (tag[0] === name && typeof tag[1] === 'string') {
      found = tag
    }
  }
  return found
}

function normalizeRelayHint(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!isValidRelayURL(trimmed)) return undefined

  try {
    const normalized = new URL(trimmed)
    normalized.hash = ''
    normalized.username = ''
    normalized.password = ''
    if (
      (normalized.protocol === 'wss:' && normalized.port === '443') ||
      (normalized.protocol === 'ws:' && normalized.port === '80')
    ) {
      normalized.port = ''
    }
    return normalized.toString()
  } catch {
    return undefined
  }
}

function parseTargetKind(event: NostrEvent): number | undefined {
  const tag = getLastTag(event, 'k')
  if (!tag?.[1] || !/^\d{1,10}$/.test(tag[1])) return undefined
  const kind = Number(tag[1])
  return Number.isSafeInteger(kind) && kind >= 0 ? kind : undefined
}

function parseEmbeddedRepostEvent(
  content: string,
  expected: {
    repostKind: typeof Kind.Repost | typeof Kind.GenericRepost
    targetEventId: string
    targetPubkey?: string
    targetKind?: number
    targetAddress?: string
  },
): NostrEvent | undefined {
  const trimmed = content.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_EMBEDDED_CONTENT_BYTES) {
    return undefined
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return undefined
  }

  if (!isStructurallyValidEvent(parsed) || !isValidEvent(parsed)) {
    return undefined
  }

  const embedded = parsed as NostrEvent
  if (embedded.id !== expected.targetEventId) return undefined
  if (expected.targetPubkey && embedded.pubkey !== expected.targetPubkey) return undefined

  if (expected.repostKind === Kind.Repost && embedded.kind !== Kind.ShortNote) {
    return undefined
  }

  if (expected.repostKind === Kind.GenericRepost) {
    if (expected.targetKind !== undefined && embedded.kind !== expected.targetKind) {
      return undefined
    }
    if (expected.targetAddress) {
      const embeddedAddress = getEventAddressCoordinate(embedded)
      if (embeddedAddress !== expected.targetAddress) return undefined
    }
  }

  return embedded
}

function resolveTargetPubkey(event: NostrEvent, eTag: string[]): string | undefined {
  if (eTag[3] && isValidHex32(eTag[3])) return eTag[3]
  const pTag = getLastTag(event, 'p')
  return pTag?.[1] && isValidHex32(pTag[1]) ? pTag[1] : undefined
}

export function parseRepostEvent(event: NostrEvent): ParsedRepostEvent | null {
  if (event.kind !== Kind.Repost && event.kind !== Kind.GenericRepost) return null

  const eTag = getLastTag(event, 'e')
  if (!eTag?.[1] || !isValidHex32(eTag[1])) return null

  const repostKind = event.kind
  const targetPubkey = resolveTargetPubkey(event, eTag)
  const targetKind = parseTargetKind(event)
  const targetAddressTag = getLastTag(event, 'a')?.[1]
  const targetAddress = targetAddressTag && parseAddressCoordinate(targetAddressTag)
    ? targetAddressTag
    : undefined

  if (repostKind === Kind.Repost) {
    if (targetKind !== undefined && targetKind !== Kind.ShortNote) return null
  }

  const relayHint = normalizeRelayHint(eTag[2])
  const embeddedEvent = parseEmbeddedRepostEvent(event.content, {
    repostKind,
    targetEventId: eTag[1],
    ...(targetPubkey ? { targetPubkey } : {}),
    ...(targetKind !== undefined ? { targetKind } : {}),
    ...(targetAddress ? { targetAddress } : {}),
  })

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    repostKind,
    targetEventId: eTag[1],
    ...(targetPubkey ? { targetPubkey } : {}),
    ...(targetKind !== undefined ? { targetKind } : {}),
    ...(targetAddress ? { targetAddress } : {}),
    ...(relayHint ? { relayHint } : {}),
    ...(embeddedEvent ? { embeddedEvent } : {}),
  }
}

export function parseQuoteTags(event: NostrEvent): QuoteReference[] {
  const quotes: QuoteReference[] = []
  const seen = new Set<string>()

  for (const tag of event.tags) {
    if (tag[0] !== 'q' || typeof tag[1] !== 'string') continue

    const relayHint = normalizeRelayHint(tag[2])
    const authorPubkey = tag[3] && isValidHex32(tag[3]) ? tag[3] : undefined

    if (isValidHex32(tag[1])) {
      const key = `event:${tag[1]}`
      if (seen.has(key)) continue
      seen.add(key)
      quotes.push({
        key,
        eventId: tag[1],
        ...(relayHint ? { relayHint } : {}),
        ...(authorPubkey ? { authorPubkey } : {}),
      })
      continue
    }

    const address = parseAddressCoordinate(tag[1])
    if (!address) continue

    const key = `address:${tag[1]}`
    if (seen.has(key)) continue
    seen.add(key)
    quotes.push({
      key,
      address: tag[1],
      ...(relayHint ? { relayHint } : {}),
      ...(authorPubkey ? { authorPubkey } : {}),
    })
  }

  return quotes
}

const TRAILING_NIP21_REFERENCE_PATTERN = /(?:\s+)?(nostr:[a-zA-Z0-9]+)\s*$/u

export function getQuotePostBody(event: NostrEvent): string {
  const quotes = parseQuoteTags(event)
  if (quotes.length === 0) return event.content

  const quotedEventIds = new Set(quotes.flatMap((quote) => quote.eventId ? [quote.eventId] : []))
  const quotedAddresses = new Set(quotes.flatMap((quote) => quote.address ? [quote.address] : []))

  let remaining = event.content.trimEnd()

  while (remaining.length > 0) {
    const match = remaining.match(TRAILING_NIP21_REFERENCE_PATTERN)
    const reference = match?.[1]
    if (!reference) break

    const eventReference = decodeEventReference(reference)
    const addressReference = decodeAddressReference(reference)
    const addressCoordinate = addressReference
      ? `${addressReference.kind}:${addressReference.pubkey}:${addressReference.identifier}`
      : null

    const matchesQuotedTarget = (
      (eventReference && quotedEventIds.has(eventReference.eventId)) ||
      (addressCoordinate && quotedAddresses.has(addressCoordinate))
    )

    if (!matchesQuotedTarget) break

    remaining = remaining.slice(0, match.index ?? remaining.length).trimEnd()
  }

  return remaining
}

export function buildQuoteTagsFromContent(content: string): string[][] {
  const tags: string[][] = []
  const seen = new Set<string>()

  for (const uri of extractNostrURIs(content)) {
    const parsed = parseNip21Reference(uri)
    if (!parsed) continue

    if (parsed.decoded.type === 'note' || parsed.decoded.type === 'nevent') {
      const eventRef = decodeEventReference(parsed.uri)
      if (!eventRef || seen.has(`event:${eventRef.eventId}`)) continue
      seen.add(`event:${eventRef.eventId}`)
      tags.push([
        'q',
        eventRef.eventId,
        eventRef.relays[0] ?? '',
        eventRef.author ?? '',
      ])
      continue
    }

    if (parsed.decoded.type === 'naddr') {
      const addressRef = decodeAddressReference(parsed.uri)
      if (!addressRef) continue
      const coordinate = `${addressRef.kind}:${addressRef.pubkey}:${addressRef.identifier}`
      if (seen.has(`address:${coordinate}`)) continue
      seen.add(`address:${coordinate}`)
      tags.push([
        'q',
        coordinate,
        addressRef.relays[0] ?? '',
        addressRef.pubkey,
      ])
    }
  }

  return tags
}

async function resolveRelayHint(target: NostrEvent): Promise<string> {
  const relayHints = await getEventReadRelayHints(target.pubkey, 1)
  if (relayHints[0]) return relayHints[0]

  const defaultRelay = getDefaultRelayUrls()[0]
  if (!defaultRelay) {
    throw new Error('No relay hint available for repost target.')
  }
  return defaultRelay
}

export async function publishRepost(
  target: NostrEvent,
  signal?: AbortSignal,
): Promise<NostrEvent> {
  const ndk = getNDK()
  if (!ndk.signer) {
    throw new Error('No signer available — install a NIP-07 extension to publish reposts.')
  }

  const relayHint = await resolveRelayHint(target)
  const address = getEventAddressCoordinate(target)
  const serializedTarget = JSON.stringify(target)
  const isKind6 = target.kind === Kind.ShortNote
  const event = new NDKEvent(ndk)
  event.kind = isKind6 ? Kind.Repost : Kind.GenericRepost
  event.content = serializedTarget.length <= LIMITS.CONTENT_BYTES ? serializedTarget : ''
  event.tags = await withOptionalClientTag([
    ['e', target.id, relayHint, target.pubkey],
    ['p', target.pubkey, relayHint],
    ...(isKind6 ? [] : [['k', String(target.kind)]]),
    ...(!isKind6 && address ? [['a', address, relayHint, target.pubkey]] : []),
  ], signal)

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  await event.sign()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  await withRetry(
    async () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await event.publish()
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
  return rawEvent
}

function describeEmbeddedTarget(event: NostrEvent): string {
  const video = parseVideoEvent(event)

  if (event.kind === Kind.ShortNote) {
    const preview = sanitizeText(event.content).trim()
    return preview.length > 0 ? preview : 'Reposted a note'
  }
  if (event.kind === Kind.LongFormContent) {
    return 'Reposted an article'
  }
  if (video) {
    return video.isShort ? 'Reposted a short video' : 'Reposted a video'
  }
  if (event.kind === Kind.FileMetadata) {
    return 'Reposted a file'
  }
  return `Reposted kind ${event.kind}`
}

export function getRepostPreviewText(event: NostrEvent): string {
  const parsed = parseRepostEvent(event)
  if (!parsed?.embeddedEvent) {
    return parsed?.repostKind === Kind.GenericRepost ? 'Reposted an event' : 'Reposted a note'
  }

  return describeEmbeddedTarget(parsed.embeddedEvent)
}
