import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
import { getEventReadRelayHints, getEventWriteRelayHints } from '@/lib/db/nostr'
import { getCurrentUser, getDefaultRelayUrls, getNDK, getOutboxRelayUrls } from '@/lib/nostr/ndk'
import { publishCurrentUserRelayList } from '@/lib/nostr/relayList'
import { withRetry } from '@/lib/retry'
import { isValidHex32, isValidRelayURL } from '@/lib/security/sanitize'
import { Kind } from '@/types'

const MAX_AUTHOR_WRITE_RELAYS = 6
const MAX_TAGGED_READ_RELAYS_PER_USER = 3
const MAX_PUBLISH_RELAY_FANOUT = 24

const TRANSIENT_PUBLISH_ERROR_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /network/i,
  /socket/i,
  /temporar/i,
  /too many requests/i,
  /rate limit/i,
  /\b429\b/,
  /\b5\d\d\b/,
]

const PERMANENT_PUBLISH_ERROR_PATTERNS = [
  /invalid/i,
  /malformed/i,
  /signature/i,
  /forbidden/i,
  /permission/i,
  /unauthori[sz]ed/i,
  /auth/i,
  /duplicate/i,
  /already exists/i,
]

function normalizeErrorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function shouldRetryNostrPublishError(error: unknown): boolean {
  const message = normalizeErrorText(error)

  if (PERMANENT_PUBLISH_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return false
  }

  if (TRANSIENT_PUBLISH_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return true
  }

  return true
}

function uniqueRelayUrls(relayUrls: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const relayUrl of relayUrls) {
    const normalized = relayUrl.trim()
    if (!isValidRelayURL(normalized) || seen.has(normalized)) continue
    seen.add(normalized)
    unique.push(normalized)
    if (unique.length >= MAX_PUBLISH_RELAY_FANOUT) break
  }

  return unique
}

function extractTaggedPubkeys(tags: string[][], authorPubkey: string): string[] {
  const pubkeys = new Set<string>()

  for (const tag of tags) {
    if (tag[0] !== 'p') continue
    const taggedPubkey = tag[1]
    if (typeof taggedPubkey !== 'string') continue
    if (!isValidHex32(taggedPubkey) || taggedPubkey === authorPubkey) continue
    pubkeys.add(taggedPubkey)
  }

  return [...pubkeys]
}

export async function resolveNip65PublishRelays(event: NDKEvent): Promise<string[]> {
  const ndk = getNDK()
  const currentUser = await getCurrentUser()
  const authorPubkey = currentUser?.pubkey ?? event.pubkey

  const authorWriteRelays = isValidHex32(authorPubkey)
    ? await getEventWriteRelayHints(authorPubkey, MAX_AUTHOR_WRITE_RELAYS)
    : []

  const taggedPubkeys = extractTaggedPubkeys(event.tags, authorPubkey)
  const taggedReadRelayGroups = await Promise.all(
    taggedPubkeys.map((pubkey) => getEventReadRelayHints(pubkey, MAX_TAGGED_READ_RELAYS_PER_USER)),
  )
  const taggedReadRelays = taggedReadRelayGroups.flat()

  const poolRelays = [...ndk.pool.relays.values()].map((relay) => relay.url)

  return uniqueRelayUrls([
    ...authorWriteRelays,
    ...taggedReadRelays,
    ...poolRelays,
    ...getDefaultRelayUrls(),
    ...getOutboxRelayUrls(),
  ])
}

export async function publishEventWithNip65Outbox(
  event: NDKEvent,
  signal?: AbortSignal,
): Promise<void> {
  const ndk = getNDK()
  const resolvedRelayUrls = await resolveNip65PublishRelays(event)
  const relayUrls = resolvedRelayUrls.length > 0
    ? resolvedRelayUrls
    : uniqueRelayUrls([
      ...getDefaultRelayUrls(),
      ...getOutboxRelayUrls(),
      ...[...ndk.pool.relays.values()].map((relay) => relay.url),
    ])

  if (relayUrls.length === 0) {
    throw new Error('No writable relays available for publish fanout.')
  }

  const relaySet = NDKRelaySet.fromRelayUrls(relayUrls, ndk, true)

  await withRetry(
    async () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await event.publish(relaySet)
    },
    {
      maxAttempts: 2,
      baseDelayMs: 750,
      maxDelayMs: 2_500,
      shouldRetry: (error) => shouldRetryNostrPublishError(error),
      ...(signal ? { signal } : {}),
    },
  )

  // NIP-65 discoverability: spread the author's kind-10002 event to relays where
  // the current event was published so peers can discover the outbox map.
  if (event.kind !== Kind.RelayList) {
    try {
      await publishCurrentUserRelayList({
        ...(signal ? { signal } : {}),
        force: true,
        publishRelayUrls: relayUrls,
      })
    } catch (error) {
      console.warn('[outbox] Kind-10002 relay-list republish degraded:', error)
    }
  }
}