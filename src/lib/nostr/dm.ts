import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
import { insertEvent, queryEvents } from '@/lib/db/nostr'
import { withOptionalClientTag } from '@/lib/nostr/appHandlers'
import { getFreshNip51ListEvent, parseNip51ListEvent } from '@/lib/nostr/lists'
import { getCurrentUser, getDefaultRelayUrls, getNDK } from '@/lib/nostr/ndk'
import { decryptNip04, encryptNip04, hasNip04Support } from '@/lib/nostr/nip04'
import { decryptNip44, encryptNip44, hasNip44Support } from '@/lib/nostr/nip44'
import { withRetry } from '@/lib/retry'
import { isValidHex32, isValidRelayURL, sanitizeText } from '@/lib/security/sanitize'
import type { NostrEvent, NostrFilter } from '@/types'
import { Kind } from '@/types'

export const NIP44_DM_ENVELOPE_KINDS = {
  Seal: 13,
  ChatMessage: 14,
  GiftWrap: 1059,
} as const

export type DirectMessageEncryption = 'nip44' | 'nip04'
export type DirectMessageProtocol = 'kind4-nip44' | 'kind4-nip04' | 'nip44-envelope-planned'

export interface ParsedDirectMessage {
  id: string
  pubkey: string
  createdAt: number
  recipientPubkey: string
  counterpartyPubkey: string
  direction: 'inbound' | 'outbound'
  ciphertext: string
  encryption: DirectMessageEncryption | 'unknown'
  protocol: DirectMessageProtocol
}

export interface DecryptedDirectMessage extends ParsedDirectMessage {
  plaintext: string
}

export interface PublishDirectMessageOptions {
  recipientPubkey: string
  plaintext: string
  encryption?: DirectMessageEncryption | 'auto'
  signal?: AbortSignal
}

export interface LoadDirectMessageOptions {
  currentUserPubkey: string
  counterpartyPubkey?: string
  limit?: number
  signal?: AbortSignal
}

const MAX_DM_CONTENT_CHARS = 8_000
const MAX_DM_RELAYS = 12
const DM_FETCH_LIMIT = 200
const DM_FETCH_TIMEOUT_MS = 5_000

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

function getRecipientPubkey(event: Pick<NostrEvent, 'tags'>): string | null {
  const tag = event.tags.find((candidate) => candidate[0] === 'p' && isValidHex32(candidate[1] ?? ''))
  return tag?.[1] ?? null
}

function detectEncryption(event: NostrEvent): DirectMessageEncryption | 'unknown' {
  const explicit = event.tags.find((tag) => tag[0] === 'encrypted')?.[1]
  if (explicit === 'nip44' || explicit === 'nip04') return explicit
  if (event.content.includes('?iv=') || event.content.includes('&iv=')) return 'nip04'
  if (event.content.trim().length > 0) return 'nip44'
  return 'unknown'
}

function uniqueRelayUrls(urls: string[]): string[] {
  const unique: string[] = []
  const seen = new Set<string>()

  for (const url of urls) {
    const normalized = url.trim()
    if (!isValidRelayURL(normalized) || seen.has(normalized)) continue
    seen.add(normalized)
    unique.push(normalized)
    if (unique.length >= MAX_DM_RELAYS) break
  }

  return unique
}

async function getDmRelayUrls(pubkey: string, signal?: AbortSignal): Promise<string[]> {
  if (!isValidHex32(pubkey)) return []

  const event = await getFreshNip51ListEvent(pubkey, Kind.DmRelays, {
    ...(signal ? { signal } : {}),
  })
  const parsed = event ? parseNip51ListEvent(event) : null
  if (!parsed) return []

  return parsed.publicItems
    .filter((item) => item.tagName === 'relay')
    .map((item) => item.values[0] ?? '')
    .filter(isValidRelayURL)
}

export async function getDmRelayUrlsForConversation(
  currentUserPubkey: string,
  counterpartyPubkey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const [ownRelays, counterpartyRelays] = await Promise.all([
    getDmRelayUrls(currentUserPubkey, signal),
    getDmRelayUrls(counterpartyPubkey, signal),
  ])

  return uniqueRelayUrls([
    ...counterpartyRelays,
    ...ownRelays,
    ...getDefaultRelayUrls(),
  ])
}

export function getDirectMessageCapability(): {
  canEncrypt: boolean
  preferredEncryption: DirectMessageEncryption | null
} {
  if (hasNip44Support()) {
    return { canEncrypt: true, preferredEncryption: 'nip44' }
  }
  if (hasNip04Support()) {
    return { canEncrypt: true, preferredEncryption: 'nip04' }
  }
  return { canEncrypt: false, preferredEncryption: null }
}

export function parseDirectMessageEvent(
  event: NostrEvent,
  viewerPubkey: string,
): ParsedDirectMessage | null {
  if (event.kind !== Kind.EncryptedDm) return null
  if (!isValidHex32(viewerPubkey)) return null
  if (!isValidHex32(event.pubkey)) return null

  const recipientPubkey = getRecipientPubkey(event)
  if (!recipientPubkey) return null

  const isOutbound = event.pubkey === viewerPubkey
  const isInbound = recipientPubkey === viewerPubkey
  if (!isOutbound && !isInbound) return null

  const encryption = detectEncryption(event)

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    recipientPubkey,
    counterpartyPubkey: isOutbound ? recipientPubkey : event.pubkey,
    direction: isOutbound ? 'outbound' : 'inbound',
    ciphertext: event.content,
    encryption,
    protocol: encryption === 'nip04' ? 'kind4-nip04' : 'kind4-nip44',
  }
}

export async function decryptDirectMessage(
  event: NostrEvent,
  viewerPubkey: string,
): Promise<DecryptedDirectMessage | null> {
  const parsed = parseDirectMessageEvent(event, viewerPubkey)
  if (!parsed) return null

  const decryptWith = parsed.encryption === 'nip04'
    ? decryptNip04
    : decryptNip44

  const plaintext = await decryptWith(parsed.counterpartyPubkey, parsed.ciphertext)

  return {
    ...parsed,
    plaintext,
  }
}

function buildDirectMessageTags(
  recipientPubkey: string,
  encryption: DirectMessageEncryption,
): string[][] {
  return [
    ['p', recipientPubkey],
    ['encrypted', encryption],
  ]
}

function pickEncryption(requested: DirectMessageEncryption | 'auto' | undefined): DirectMessageEncryption {
  if (requested === 'nip44') {
    if (!hasNip44Support()) throw new Error('Your signer does not expose NIP-44 encryption.')
    return 'nip44'
  }

  if (requested === 'nip04') {
    if (!hasNip04Support()) throw new Error('Your signer does not expose NIP-04 encryption.')
    return 'nip04'
  }

  const capability = getDirectMessageCapability()
  if (!capability.preferredEncryption) {
    throw new Error('Your signer does not expose NIP-44 or NIP-04 encryption.')
  }
  return capability.preferredEncryption
}

export async function publishDirectMessage({
  recipientPubkey,
  plaintext,
  encryption: requestedEncryption = 'auto',
  signal,
}: PublishDirectMessageOptions): Promise<NostrEvent> {
  if (!isValidHex32(recipientPubkey)) {
    throw new Error('Direct messages require a valid recipient pubkey.')
  }

  const message = sanitizeText(plaintext).trim().slice(0, MAX_DM_CONTENT_CHARS)
  if (!message) {
    throw new Error('Direct messages require a non-empty message.')
  }

  const ndk = getNDK()
  if (!ndk.signer) {
    throw new Error('No signer available. Connect a signer before sending a DM.')
  }

  const currentUser = await getCurrentUser()
  if (!currentUser?.pubkey) {
    throw new Error('No signer user available. Reconnect your signer before sending a DM.')
  }

  const encryption = pickEncryption(requestedEncryption)
  throwIfAborted(signal)

  const ciphertext = encryption === 'nip44'
    ? await encryptNip44(recipientPubkey, message)
    : await encryptNip04(recipientPubkey, message)

  throwIfAborted(signal)

  const event = new NDKEvent(ndk)
  event.kind = Kind.EncryptedDm
  event.content = ciphertext
  event.tags = await withOptionalClientTag(
    buildDirectMessageTags(recipientPubkey, encryption),
    signal,
  )

  throwIfAborted(signal)
  await event.sign()
  throwIfAborted(signal)

  const relayUrls = await getDmRelayUrlsForConversation(currentUser.pubkey, recipientPubkey, signal)
  const relaySet = NDKRelaySet.fromRelayUrls(relayUrls, ndk, true)

  await withRetry(
    async () => {
      throwIfAborted(signal)
      await event.publish(relaySet)
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

export function buildDirectMessageFilters(
  currentUserPubkey: string,
  counterpartyPubkey?: string,
  limit = DM_FETCH_LIMIT,
): NostrFilter[] {
  if (!isValidHex32(currentUserPubkey)) return []
  const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), DM_FETCH_LIMIT)

  if (counterpartyPubkey && isValidHex32(counterpartyPubkey)) {
    return [
      {
        kinds: [Kind.EncryptedDm],
        authors: [counterpartyPubkey],
        '#p': [currentUserPubkey],
        limit: normalizedLimit,
      },
      {
        kinds: [Kind.EncryptedDm],
        authors: [currentUserPubkey],
        '#p': [counterpartyPubkey],
        limit: normalizedLimit,
      },
    ]
  }

  return [
    {
      kinds: [Kind.EncryptedDm],
      '#p': [currentUserPubkey],
      limit: normalizedLimit,
    },
    {
      kinds: [Kind.EncryptedDm],
      authors: [currentUserPubkey],
      limit: normalizedLimit,
    },
  ]
}

async function waitWithTimeout<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T | null> {
  if (signal?.aborted) return null

  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let abortHandler: (() => void) | null = null

  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), DM_FETCH_TIMEOUT_MS)
  })

  const abort = new Promise<null>((resolve) => {
    abortHandler = () => resolve(null)
    signal?.addEventListener('abort', abortHandler, { once: true })
  })

  try {
    return await Promise.race([promise, timeout, abort])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
    if (abortHandler) signal?.removeEventListener('abort', abortHandler)
  }
}

export async function loadDirectMessageEvents({
  currentUserPubkey,
  counterpartyPubkey,
  limit = DM_FETCH_LIMIT,
  signal,
}: LoadDirectMessageOptions): Promise<NostrEvent[]> {
  const filters = buildDirectMessageFilters(currentUserPubkey, counterpartyPubkey, limit)
  if (filters.length === 0) return []

  const loadLocal = async () => {
    const resultSets = await Promise.all(filters.map((filter) => queryEvents(filter)))
    const byId = new Map<string, NostrEvent>()
    for (const event of resultSets.flat()) {
      if (parseDirectMessageEvent(event, currentUserPubkey)) {
        byId.set(event.id, event)
      }
    }
    return [...byId.values()].sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
  }

  let ndk
  try {
    ndk = getNDK()
  } catch {
    return loadLocal()
  }

  const relayUrls = counterpartyPubkey
    ? await getDmRelayUrlsForConversation(currentUserPubkey, counterpartyPubkey, signal)
    : uniqueRelayUrls(getDefaultRelayUrls())
  const relaySet = NDKRelaySet.fromRelayUrls(relayUrls, ndk, true)

  await Promise.all(filters.map(async (filter) => {
    const fetched = await waitWithTimeout(
      ndk.fetchEvents(filter as Parameters<typeof ndk.fetchEvents>[0], undefined, relaySet),
      signal,
    )
    if (!fetched) return

    for (const ndkEvent of fetched) {
      const raw = (ndkEvent as { rawEvent: () => NostrEvent }).rawEvent()
      await insertEvent(raw)
    }
  })).catch(() => undefined)

  return loadLocal()
}
