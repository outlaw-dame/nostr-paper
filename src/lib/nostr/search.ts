/**
 * NIP-50 Full-Text Search — Query Parsing & Relay Forwarding
 *
 * The NIP-50 `search` field is a human-readable query string plus optional
 * standardized `key:value` extensions. This module keeps two views of that
 * input:
 *
 * - `relayQuery`: the original trimmed query forwarded to relays
 * - `localQuery`: a sanitized SQLite FTS5 expression for local search
 *
 * Deliberate inference from the spec:
 * only the standardized extension keys are treated specially (`domain`,
 * `include`, `language`, `sentiment`, `nsfw`). Other `key:value` text remains
 * searchable locally so ordinary content such as URLs or `nostr:` URIs is not
 * discarded accidentally.
 */

import { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { getNDK, SEARCH_RELAY_URLS } from '@/lib/nostr/ndk'
import { normalizeDomain, isValidEvent } from '@/lib/security/sanitize'
import type { NostrEvent, NostrFilter } from '@/types'

const MAX_SEARCH_QUERY_CHARS = 512
const STANDARD_EXTENSION_KEYS = new Set([
  'domain',
  'include',
  'language',
  'sentiment',
  'nsfw',
])
const UNSUPPORTED_LOCAL_EXTENSION_KEYS = new Set([
  'include',
  'language',
  'sentiment',
  'nsfw',
])
const FTS5_UNSAFE_RE = /[^\p{L}\p{N}_\s]+/gu

type SearchToken =
  | { type: 'phrase'; value: string }
  | { type: 'term'; value: string }

export interface SearchExtension {
  key: string
  value: string
}

export interface ParsedSearchQuery {
  relayQuery: string | null
  localQuery: string | null
  domains: string[]
  unsupportedExtensions: SearchExtension[]
}

function normalizeRelaySearchQuery(raw: string): string | null {
  if (typeof raw !== 'string') return null
  const query = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_SEARCH_QUERY_CHARS)
  return query.length > 0 ? query : null
}

function tokenizeLocalSearchInput(input: string): SearchToken[] {
  const tokens: SearchToken[] = []
  let i = 0

  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i]!)) i++
    if (i >= input.length) break

    if (input[i] === '"') {
      i++
      const start = i
      while (i < input.length && input[i] !== '"') i++
      const phrase = input.slice(start, i)
      if (i < input.length) i++
      tokens.push({ type: 'phrase', value: phrase })
      continue
    }

    const start = i
    while (i < input.length && !/[\s"]/.test(input[i]!)) i++
    tokens.push({ type: 'term', value: input.slice(start, i) })
  }

  return tokens
}

function sanitizeLocalPhrase(value: string): string | null {
  const normalized = value
    .normalize('NFKC')
    .replace(FTS5_UNSAFE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return normalized.length > 0 ? `"${normalized.replace(/"/g, '')}"` : null
}

function sanitizeLocalTerm(value: string): string[] {
  const normalized = value
    .normalize('NFKC')
    .replace(FTS5_UNSAFE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) return []

  return normalized
    .split(' ')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => /^(AND|OR|NOT)$/i.test(part) ? `"${part.replace(/"/g, '')}"` : part)
}

/**
 * Parse a NIP-50 query into a relay-safe raw string and a local FTS5 query.
 *
 * Locally supported standardized extension:
 * - `domain:<domain>` → restrict matches to events/profiles whose valid NIP-05
 *   domain equals `<domain>`
 *
 * Relay-only standardized extensions are preserved in `relayQuery` but removed
 * from `localQuery`, and reported via `unsupportedExtensions`.
 */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const relayQuery = normalizeRelaySearchQuery(raw)
  if (!relayQuery) {
    return {
      relayQuery: null,
      localQuery: null,
      domains: [],
      unsupportedExtensions: [],
    }
  }

  const parts: string[] = []
  const domains = new Set<string>()
  const unsupportedExtensions: SearchExtension[] = []

  for (const token of tokenizeLocalSearchInput(relayQuery)) {
    if (token.type === 'phrase') {
      const clean = sanitizeLocalPhrase(token.value)
      if (clean) parts.push(clean)
      continue
    }

    const extensionMatch = token.value.match(/^([a-z][a-z0-9_-]*):(.*)$/i)
    if (extensionMatch) {
      const rawKey = extensionMatch[1]
      const rawValue = extensionMatch[2]
      if (!rawKey || rawValue === undefined) {
        parts.push(...sanitizeLocalTerm(token.value))
        continue
      }

      const key = rawKey.toLowerCase()
      const value = rawValue.trim()

      if (STANDARD_EXTENSION_KEYS.has(key) && value.length > 0) {
        if (key === 'domain') {
          const domain = normalizeDomain(value)
          if (domain) domains.add(domain)
          else unsupportedExtensions.push({ key, value })
        } else if (UNSUPPORTED_LOCAL_EXTENSION_KEYS.has(key)) {
          unsupportedExtensions.push({ key, value })
        }
        continue
      }
    }

    parts.push(...sanitizeLocalTerm(token.value))
  }

  return {
    relayQuery,
    localQuery: parts.length > 0 ? parts.join(' ') : null,
    domains: [...domains],
    unsupportedExtensions,
  }
}

/** Backwards-compatible helper for modules that only need the local FTS query. */
export function sanitizeFts5Query(raw: string): string | null {
  return parseSearchQuery(raw).localQuery
}

// ── Relay Search (NIP-50) ─────────────────────────────────────

export interface RelaySearchOptions {
  /** NIP-01 filter fields to combine with the search term */
  kinds?: number[]
  authors?: string[]
  since?: number
  until?: number
  limit?: number
  /** AbortSignal to cancel the relay subscription early */
  signal?: AbortSignal
}

// Maximum time to wait for relay search results before returning whatever arrived.
const RELAY_SEARCH_TIMEOUT_MS = 7_000

/**
 * Pre-warm WebSocket connections to NIP-50 search relays so the first
 * search doesn't pay the full connection-setup cost. Call this when the
 * user navigates to any search surface.
 */
export function warmSearchRelays(): void {
  let ndk
  try { ndk = getNDK() } catch { return }
  // fromRelayUrls with connect=true kicks off WebSocket connections in the
  // background and adds the relays to the NDK pool for future fetchEvents calls.
  NDKRelaySet.fromRelayUrls(SEARCH_RELAY_URLS, ndk, true)
}

/**
 * Forward a NIP-50 search filter to all connected relays via NDK.
 *
 * Results are signature-validated, inserted into the local SQLite cache, and
 * returned in relay order. Callers may rerank them locally after insert.
 */
export async function searchRelays(
  query: string,
  opts: RelaySearchOptions = {},
): Promise<NostrEvent[]> {
  const parsed = parseSearchQuery(query)
  if (!parsed.relayQuery) return []
  if (opts.signal?.aborted) return []

  let ndk
  try { ndk = getNDK() } catch { return [] }

  const filter: NostrFilter = {
    search: parsed.relayQuery,
    limit: opts.limit ?? 50,
    ...(opts.kinds !== undefined ? { kinds: opts.kinds } : {}),
    ...(opts.authors !== undefined ? { authors: opts.authors } : {}),
    ...(opts.since !== undefined ? { since: opts.since } : {}),
    ...(opts.until !== undefined ? { until: opts.until } : {}),
  }

  // Route search to NIP-50-capable relays specifically, connecting them if needed.
  // This gives better coverage than the general pool without keeping all search
  // relays open for non-search subscriptions.
  const searchRelaySet = NDKRelaySet.fromRelayUrls(SEARCH_RELAY_URLS, ndk, true)

  const seen = new Set<string>()
  const results: NostrEvent[] = []

  try {
    const abortPromise = new Promise<Set<never>>((resolve) => {
      opts.signal?.addEventListener('abort', () => resolve(new Set()), { once: true })
    })
    const timeoutPromise = new Promise<Set<never>>((resolve) => {
      setTimeout(() => resolve(new Set()), RELAY_SEARCH_TIMEOUT_MS)
    })

    const ndkEvents = await Promise.race([
      ndk.fetchEvents(filter, undefined, searchRelaySet),
      abortPromise,
      timeoutPromise,
    ])

    for (const ndkEvent of ndkEvents) {
      const raw = ndkEvent.rawEvent() as NostrEvent
      if (!raw.id || seen.has(raw.id) || !isValidEvent(raw)) continue

      seen.add(raw.id)
      results.push(raw)
    }
  } catch (err) {
    // Network errors, relay rejections, timeout — non-fatal
    console.warn('[search] Relay search error:', err)
  }

  return results
}
