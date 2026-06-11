import { getEvent } from '@/lib/db/nostr'
import { addRelayToPool, getNDK, waitForCachedEvents } from '@/lib/nostr/ndk'
import { decodeEventReference, type DecodedEventReference } from '@/lib/nostr/nip21'
import { withRetry } from '@/lib/retry'
import { isValidEvent, isValidHex32, isValidRelayURL } from '@/lib/security/sanitize'
import type { NostrEvent, NostrFilter } from '@/types'

export type EventEmbedResolutionState =
  | 'idle'
  | 'decoding-reference'
  | 'cache-hit'
  | 'selecting-relays'
  | 'fetching-event'
  | 'verifying-event'
  | 'ready'
  | 'not-found'
  | 'invalid-reference'
  | 'invalid-event'
  | 'error'

export type EventEmbedVerificationFailure =
  | 'invalid-structure-or-signature'
  | 'requested-id-mismatch'
  | 'requested-author-mismatch'
  | 'requested-kind-mismatch'

export type EventEmbedVerificationResult =
  | { ok: true }
  | { ok: false; reason: EventEmbedVerificationFailure }

export interface ResolveNostrEventEmbedOptions {
  signal?: AbortSignal
  maxRelayHints?: number
  retryAttempts?: number
}

export interface ResolvedNostrEventEmbed {
  reference: DecodedEventReference | null
  relayHints: string[]
  event: NostrEvent | null
  state: EventEmbedResolutionState
  error: string | null
  fromCache: boolean
}

const DEFAULT_MAX_RELAY_HINTS = 8
const DEFAULT_RETRY_ATTEMPTS = 2

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
}

function normalizeRelayHintUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!isValidRelayURL(trimmed)) return null

  try {
    const parsed = new URL(trimmed)
    // Embed lookups can be triggered by passive reading. Avoid silently adding
    // cleartext relays to the shared pool from a pasted third-party reference.
    if (parsed.protocol !== 'wss:') return null

    parsed.hash = ''
    parsed.username = ''
    parsed.password = ''
    if (parsed.port === '443') parsed.port = ''

    const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/g, '')
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`
  } catch {
    return null
  }
}

function decodeEventReferenceSafely(value: string): DecodedEventReference | null {
  try {
    return decodeEventReference(value)
  } catch {
    return null
  }
}

export function normalizeEmbedRelayHints(
  relays: readonly string[] | null | undefined,
  maxRelayHints = DEFAULT_MAX_RELAY_HINTS,
): string[] {
  if (!Array.isArray(relays) || maxRelayHints <= 0) return []

  const normalized: string[] = []
  const seen = new Set<string>()
  for (const relay of relays) {
    if (typeof relay !== 'string') continue
    const candidate = normalizeRelayHintUrl(relay)
    if (!candidate || seen.has(candidate)) continue
    seen.add(candidate)
    normalized.push(candidate)
    if (normalized.length >= maxRelayHints) break
  }
  return normalized
}

export function normalizeEventEmbedReference(
  input: string | DecodedEventReference | null | undefined,
  maxRelayHints = DEFAULT_MAX_RELAY_HINTS,
): DecodedEventReference | null {
  const decoded = typeof input === 'string' ? decodeEventReferenceSafely(input) : input
  if (!decoded || !isValidHex32(decoded.eventId)) return null
  if (decoded.author !== undefined && !isValidHex32(decoded.author)) return null
  if (decoded.kind !== undefined && (!Number.isInteger(decoded.kind) || decoded.kind < 0)) return null

  return {
    eventId: decoded.eventId,
    relays: normalizeEmbedRelayHints(decoded.relays, maxRelayHints),
    ...(decoded.author !== undefined ? { author: decoded.author } : {}),
    ...(decoded.kind !== undefined ? { kind: decoded.kind } : {}),
    ...(decoded.bech32 !== undefined ? { bech32: decoded.bech32 } : {}),
  }
}

export function buildEmbedFetchFilter(reference: DecodedEventReference): NostrFilter {
  return {
    ids: [reference.eventId],
    ...(reference.author !== undefined ? { authors: [reference.author] } : {}),
    ...(reference.kind !== undefined ? { kinds: [reference.kind] } : {}),
    limit: 1,
  }
}

export function verifyEmbedEvent(
  event: unknown,
  reference: DecodedEventReference,
): EventEmbedVerificationResult {
  if (!isValidEvent(event)) {
    return { ok: false, reason: 'invalid-structure-or-signature' }
  }

  if (event.id !== reference.eventId) {
    return { ok: false, reason: 'requested-id-mismatch' }
  }
  if (reference.author !== undefined && event.pubkey !== reference.author) {
    return { ok: false, reason: 'requested-author-mismatch' }
  }
  if (reference.kind !== undefined && event.kind !== reference.kind) {
    return { ok: false, reason: 'requested-kind-mismatch' }
  }

  return { ok: true }
}

export function getEmbedVerificationErrorMessage(reason: EventEmbedVerificationFailure): string {
  switch (reason) {
    case 'invalid-structure-or-signature':
      return 'Event failed structural or cryptographic verification.'
    case 'requested-id-mismatch':
      return 'Relay returned an event that does not match the requested id.'
    case 'requested-author-mismatch':
      return 'Relay returned an event from a different author than the requested reference.'
    case 'requested-kind-mismatch':
      return 'Relay returned an event with a different kind than the requested reference.'
  }
}

function addRelayHintsToSharedPool(relayHints: readonly string[]): void {
  for (const relay of relayHints) {
    addRelayToPool(relay)
  }
}

async function fetchEventFromRelays(
  reference: DecodedEventReference,
  signal: AbortSignal | undefined,
  retryAttempts: number,
): Promise<void> {
  const ndk = getNDK()
  const filter = buildEmbedFetchFilter(reference)

  await withRetry(
    async () => {
      throwIfAborted(signal)
      await ndk.fetchEvents(filter)
    },
    {
      maxAttempts: Math.max(1, retryAttempts),
      baseDelayMs: 1_000,
      signal,
    },
  )
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback
}

export async function resolveNostrEventEmbed(
  input: string | DecodedEventReference | null | undefined,
  options: ResolveNostrEventEmbedOptions = {},
): Promise<ResolvedNostrEventEmbed> {
  const reference = normalizeEventEmbedReference(input, options.maxRelayHints)
  if (!reference) {
    return {
      reference: null,
      relayHints: [],
      event: null,
      state: 'invalid-reference',
      error: 'Invalid Nostr event reference.',
      fromCache: false,
    }
  }

  const relayHints = reference.relays
  throwIfAborted(options.signal)

  const cached = await getEvent(reference.eventId)
  throwIfAborted(options.signal)
  if (cached) {
    const verified = verifyEmbedEvent(cached, reference)
    if (!verified.ok) {
      return {
        reference,
        relayHints,
        event: null,
        state: 'invalid-event',
        error: getEmbedVerificationErrorMessage(verified.reason),
        fromCache: true,
      }
    }

    return {
      reference,
      relayHints,
      event: cached,
      state: 'cache-hit',
      error: null,
      fromCache: true,
    }
  }

  try {
    addRelayHintsToSharedPool(relayHints)
    await fetchEventFromRelays(reference, options.signal, options.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS)
    throwIfAborted(options.signal)
    await waitForCachedEvents([reference.eventId])
  } catch (error: unknown) {
    throwIfAborted(options.signal)
    return {
      reference,
      relayHints,
      event: null,
      state: 'error',
      error: errorMessage(error, 'Event relay fetch failed.'),
      fromCache: false,
    }
  }

  const fetched = await getEvent(reference.eventId)
  throwIfAborted(options.signal)
  if (!fetched) {
    return {
      reference,
      relayHints,
      event: null,
      state: 'not-found',
      error: 'Event not found.',
      fromCache: false,
    }
  }

  const verified = verifyEmbedEvent(fetched, reference)
  if (!verified.ok) {
    return {
      reference,
      relayHints,
      event: null,
      state: 'invalid-event',
      error: getEmbedVerificationErrorMessage(verified.reason),
      fromCache: false,
    }
  }

  return {
    reference,
    relayHints,
    event: fetched,
    state: 'ready',
    error: null,
    fromCache: false,
  }
}
