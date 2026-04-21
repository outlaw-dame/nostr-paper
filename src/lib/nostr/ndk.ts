/**
 * NDK (Nostr Development Kit) Configuration
 *
 * Initializes NDK with:
 * - SQLite-backed local cache (OPFS persistent)
 * - Outbox model for NIP-65 relay selection
 * - NIP-07 browser extension signer (nos2x, Alby, etc.)
 *
 * Private keys NEVER enter this module.
 * All signing is delegated to the extension or remote signer.
 * NIP-46 remote signer support is planned for Phase 2.
 *
 * ── Relay NIPs We Depend On ───────────────────────────────────
 * NIP-01  — Basic Protocol (notes, events, subscriptions)
 * NIP-05  — User Identities & Profiles (metadata, nip05 domain)
 * NIP-09  — Event Deletion (kind:5 moderation/deletes)
 * NIP-10  — Text Notes & Threads (reply/thread tagging)
 * NIP-11  — Relay Information Document (discovers supported NIPs)
 * NIP-22  — Comments (kind:1111)
 * NIP-23  — Long-form Content (kind:30023/30024)
 * NIP-25  — Reactions (kind:7)
 * NIP-40  — Expiration Timestamp (ephemeral/story-like content)
 * NIP-50  — Full-Text Search (search filters on compatible relays)
 * NIP-51  — Lists/Sets (bookmarks, starter packs, curation sets)
 * NIP-57  — Lightning Zaps (kind:9734/9735)
 * NIP-65  — Relay List Metadata (kind:10002, outbox model)
 * NIP-89  — Handler Recommendations
 * NIP-90  — DVM Job Request/Result/Feedback
 * NIP-94  — File Metadata (kind:1063)
 *
 * ── Event Kinds Handled ──────────────────────────────────────
 * kind:0  — User Metadata (profiles)
 * kind:1  — Short Text Notes (social posts)
 * kind:7  — Reactions (emoji/text reactions)
 * kind:10002 — Relay List Metadata (NIP-65)
 * kind:10063 — File Metadata (NIP-94)
 * kind:30023/30024 — Long-form Content/Draft (NIP-23)
 */

import NDK, {
  NDKNip07Signer,
  NDKPrivateKeySigner,
  NDKRelay,
  type NDKCacheAdapter,
  type NDKCacheEntry,
  type NDKEvent,
  type NDKFilter as NDKNativeFilter,
  type NDKSubscription,
  type NDKUser,
  type NDKUserProfile,
} from '@nostr-dev-kit/ndk'
import { getStoredRelayUrls } from '@/lib/relay/relaySettings'
import { insertEvent, queryEvents, getProfile, getProfiles } from '@/lib/db/nostr'
import { isValidRelayURL } from '@/lib/security/sanitize'
import type { Profile, NostrEvent, NostrFilter } from '@/types'

// ── Default Relay Set ────────────────────────────────────────
// Tier-1 well-known, reliable relays with broad coverage and strong uptime.
// Prioritized for general event reads and caching.
// These are queried first for fast response times.
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',      // Oldest & most reliable, broad content coverage
  'wss://nos.lol',             // Very stable, excellent uptime
  'wss://nostr.wine',          // Stable, good performance
  'wss://relay.snort.social',  // Actively maintained, Snort client backed
  'wss://relay.nostr.band',    // Purpose-built for search/indexing, also good for reads
] as const

// ── Secondary Relay Set ──────────────────────────────────────
// Community/niche relays for content discovery and fallback.
// Added for broader coverage without impacting primary query latency.
// These are lazy-connected; queries don't wait for them.
const SECONDARY_RELAYS = [
  'wss://relay.mostr.pub',     // Mastodon bridge for cross-protocol content
  'wss://relay.nos.social',    // Community-run relay
  'wss://news.nos.social',     // News-focused content variant
] as const

const BLOCKED_RELAY_URLS = new Set([
  // This endpoint currently returns HTTP 200 to websocket upgrades and triggers reconnect churn.
  'wss://ditto.pub/relay/',
])

function normalizeRelayCandidate(url: string): string {
  return url.trim().replace(/\/+$/, '/')
}

function isUsableRelayUrl(url: string): boolean {
  if (!isValidRelayURL(url)) return false
  return !BLOCKED_RELAY_URLS.has(normalizeRelayCandidate(url))
}

function normalizeProxyPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return '/relay'
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function getSameOriginRelayProxyUrl(): string | null {
  if (typeof window === 'undefined') return null
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  if (!host) return null

  const configuredPath = typeof import.meta.env.VITE_SEARCH_RELAY_PROXY_PATH === 'string'
    ? import.meta.env.VITE_SEARCH_RELAY_PROXY_PATH
    : '/relay'
  const relayPath = normalizeProxyPath(configuredPath)

  return `${protocol}//${host}${relayPath}`
}

const SEARCH_RELAY_OVERRIDE = typeof import.meta.env.VITE_SEARCH_RELAY_URL === 'string'
  ? import.meta.env.VITE_SEARCH_RELAY_URL.trim()
  : ''

const SEARCH_RELAY_PRIMARY = SEARCH_RELAY_OVERRIDE || getSameOriginRelayProxyUrl() || 'ws://127.0.0.1:3301'
const SEARCH_RELAY_FALLBACKS = typeof window === 'undefined' ? ['ws://127.0.0.1:3301'] : []

// ── NIP-50 Search Relay Set ───────────────────────────────────
// Relays explicitly supporting the NIP-50 full-text search filter.
// Used by searchRelays() so search queries are routed to the best sources
// without requiring all of them to be in the general subscription pool.
// Prioritizes local search API and specialized search indices for quality.
export const SEARCH_RELAY_URLS = [
  SEARCH_RELAY_PRIMARY,
  ...SEARCH_RELAY_FALLBACKS,
  'wss://relay.nostr.band',    // Purpose-built for search/indexing, excellent quality scores
  'wss://search.nos.today',    // Dedicated NIP-50 search relay
  'wss://relay.damus.io',      // Strong NIP-50 support, broad dataset
  'wss://nostr.wine',          // Good search capability
  'wss://nos.lol',             // Solid NIP-50 implementation
  'wss://relay.snort.social',  // Good search quality
].filter((url, index, all) => isValidRelayURL(url) && all.indexOf(url) === index)

// ── NIP-65 Outbox Relays ──────────────────────────────────────
// Used for publishing and discovering relay lists (kind:10002).
// NIP-65 recommends 2-4 relays; these are well-known indexers.
const OUTBOX_RELAYS = [
  'wss://purplepag.es',         // Canonical NIP-65 relay list indexer
  'wss://pyramid.fiatjaf.com',  // Relay list indexer, good discoverability
  'wss://relay.damus.io',       // Tier-1 backbone, broadest client coverage
  'wss://nostr.band',           // Search/indexing relay, also indexes relay lists
] as const

// ── Relay NIPs Required By This App ───────────────────────────
// Used as a compatibility target when selecting relays.
// These are relay-side protocol features the app actively uses.
export const REQUIRED_RELAY_NIPS = [
  1,   // Basic protocol
  5,   // Profile metadata / nip05
  9,   // Event deletion
  10,  // Threading/reply tags
  11,  // Relay info discovery
  22,  // Comments (kind:1111)
  23,  // Long-form content
  25,  // Reactions
  40,  // Expiration tags
  50,  // Search filter
  51,  // Lists and sets
  57,  // Zaps
  65,  // Relay lists / outbox
  89,  // Handler recommendations
  90,  // DVM jobs
  94,  // File metadata
] as const

// Relay capability hints derived from known relay behavior.
// These are used for soft ranking only (never hard exclusion).
const RELAY_NIP_HINTS: Record<string, readonly number[]> = {
  'wss://relay.damus.io/': [1, 5, 9, 10, 11, 22, 23, 25, 40, 50, 51, 57, 65],
  'wss://nos.lol/': [1, 5, 9, 10, 11, 22, 23, 25, 40, 50, 51, 57, 65, 89],
  'wss://nostr.wine/': [1, 5, 9, 10, 11, 22, 23, 25, 40, 50, 51, 57, 65],
  'wss://relay.snort.social/': [1, 5, 9, 10, 11, 22, 23, 25, 50, 51],
  'wss://relay.nostr.band/': [1, 5, 9, 10, 11, 22, 23, 25, 50, 51, 65],
  'wss://search.nos.today/': [1, 11, 50],
  'wss://purplepag.es/': [1, 11, 65],
  'wss://pyramid.fiatjaf.com/': [1, 11, 65],
  'wss://nostr.band/': [1, 11, 65],
  'wss://relay.mostr.pub/': [1, 11, 25],
  'wss://relay.nos.social/': [1, 5, 11, 25],
  'wss://news.nos.social/': [1, 5, 11],
}

function getRelayNipHint(url: string): readonly number[] {
  return RELAY_NIP_HINTS[normalizeRelayCandidate(url)] ?? []
}

function scoreRelayCompatibility(url: string): number {
  const hint = getRelayNipHint(url)
  if (hint.length === 0) {
    // Unknown relays remain eligible; we keep a neutral baseline score.
    return 1
  }

  const required = new Set<number>(REQUIRED_RELAY_NIPS)
  let matchCount = 0
  for (const nip of hint) {
    if (required.has(nip)) matchCount += 1
  }

  // Prefer relays that support the two most performance-sensitive capabilities.
  if (hint.includes(50)) matchCount += 2  // NIP-50 search
  if (hint.includes(65)) matchCount += 2  // NIP-65 relay discovery/outbox

  return matchCount
}

function rankRelayUrls(urls: string[]): string[] {
  return [...urls]
    .map((url, index) => ({ url, index, score: scoreRelayCompatibility(url) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.index - b.index
    })
    .map(entry => entry.url)
}

const ENABLE_OUTBOX_MODEL = import.meta.env.PROD

export function getDefaultRelayUrls(): string[] {
  return [...DEFAULT_RELAYS]
}

export function getAllRelayUrls(): string[] {
  // Returns primary relays (fast-path) + secondary relays (lazy-connected)
  // NDK will query all but won't block on secondary relays
  return [...DEFAULT_RELAYS, ...SECONDARY_RELAYS]
}

// ── SQLite Cache Adapter ─────────────────────────────────────

class SQLiteCacheAdapter implements NDKCacheAdapter {
  // SQLite-backed local state is fast enough to be treated as a primary cache.
  // This lets NDK reuse cached relay-list events for outbox routing.
  readonly locking = true

  private readonly inflightEventWrites = new Map<string, Promise<void>>()

  async query(subscription: NDKSubscription): Promise<NDKEvent[]> {
    const filter = subscription.filter as NostrFilter
    try {
      const events = await queryEvents(filter)
      for (const rawEvent of events) {
        subscription.eventReceived(
          rawEvent as unknown as NDKEvent,
          undefined,
          true,  // fromCache = true
        )
      }
    } catch (error) {
      console.warn('[NDK cache] Query degraded:', error)
    }
    return []
  }

  async setEvent(event: NDKEvent, _filters: NDKNativeFilter[], _relay?: NDKRelay): Promise<void> {
    const rawEvent = event.rawEvent() as unknown as NostrEvent
    const existing = this.inflightEventWrites.get(rawEvent.id)
    if (existing) {
      await existing.catch(() => {})
      return
    }

    const writePromise = insertEvent(rawEvent)
      .then(() => undefined)
      .catch((error) => {
        console.warn('[NDK cache] Event write degraded:', error)
      })
      .finally(() => {
        this.inflightEventWrites.delete(rawEvent.id)
      })

    this.inflightEventWrites.set(rawEvent.id, writePromise)
    await writePromise
  }

  async fetchProfile(pubkey: string): Promise<NDKCacheEntry<NDKUserProfile> | null> {
    const profile = await getProfile(pubkey)
    if (!profile) return null
    const entry: NDKCacheEntry<NDKUserProfile> = { cachedAt: profile.updatedAt }
    if (profile.name         !== undefined) entry.name        = profile.name
    if (profile.display_name !== undefined) entry.displayName = profile.display_name
    if (profile.picture      !== undefined) entry.picture     = profile.picture
    if (profile.banner       !== undefined) entry.banner      = profile.banner
    if (profile.about        !== undefined) entry.about       = profile.about
    if (profile.website      !== undefined) entry.website     = profile.website
    if (profile.nip05Verified && profile.nip05 !== undefined) {
      entry.nip05 = profile.nip05
    }
    if (profile.lud06        !== undefined) entry.lud06       = profile.lud06
    if (profile.lud16        !== undefined) entry.lud16       = profile.lud16
    return entry
  }

  saveProfile(_pubkey: string, _profile: NDKUserProfile): void {
    // Profile saving is handled canonically via insertEvent(kind-0).
    // NDK may call this with partial/synthetic data — ignore it.
  }

  // NDK v2 extended cache methods
  async fetchProfiles(pubkeys: Set<string>): Promise<Map<string, Profile>> {
    return getProfiles([...pubkeys])
  }
}

// ── NDK Singleton ────────────────────────────────────────────

let _ndk: NDK | null = null

export function getNDK(): NDK {
  if (!_ndk) throw new Error('NDK not initialized — call initNDK() first')
  return _ndk
}

export interface InitNDKOptions {
  relays?: string[]
  signal?: AbortSignal
}

/**
 * Initialize NDK. Must be called after initDB().
 * Returns the NDK instance.
 */
export async function initNDK(options: InitNDKOptions = {}): Promise<NDK> {
  if (_ndk) return _ndk

  // Validate and filter relay URLs — use user's stored list if they've customised it
  // Includes both primary (fast-path) and secondary (lazy-connected) relays
  const storedRelays = getStoredRelayUrls()
  const relays = rankRelayUrls((options.relays ?? storedRelays ?? getAllRelayUrls())
    .filter(isUsableRelayUrl)
  ).slice(0, 20) // hard cap

  // Create signer — NIP-07 preferred, nsec localStorage fallback
  let signer: NDKNip07Signer | NDKPrivateKeySigner | undefined
  if (typeof window !== 'undefined' && 'nostr' in window) {
    try {
      signer = new NDKNip07Signer()
    } catch {
      // Extension not available or rejected — proceed unsigned
    }
  }

  // Fall back to stored nsec (set via loginWithNsec)
  if (!signer && typeof localStorage !== 'undefined') {
    const savedNsec = localStorage.getItem('nostr-paper:nsec')
    if (savedNsec) {
      try {
        signer = new NDKPrivateKeySigner(savedNsec)
      } catch {
        localStorage.removeItem('nostr-paper:nsec')
      }
    }
  }

  _ndk = new NDK({
    explicitRelayUrls:  relays,
    outboxRelayUrls:    [...OUTBOX_RELAYS],
    enableOutboxModel:  ENABLE_OUTBOX_MODEL,
    cacheAdapter:       new SQLiteCacheAdapter(),
    ...(signer !== undefined ? { signer } : {}),
    // Autoconnect is disabled — we control connection timing
    autoConnectUserRelays:  false,
  })

  // Connect with timeout
  const connectPromise = _ndk.connect(3_000)
  if (options.signal) {
    await Promise.race([
      connectPromise,
      new Promise<never>((_, reject) => {
        options.signal!.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        , { once: true })
      }),
    ])
  } else {
    await connectPromise
  }

  return _ndk
}

/**
 * Get the currently authenticated user's NDK user object.
 * Returns null if no signer is configured.
 */
export async function getCurrentUser(): Promise<NDKUser | null> {
  const ndk = getNDK()
  if (!ndk.signer) return null
  try {
    return await ndk.signer.user()
  } catch {
    return null
  }
}

// ── Identity Helpers ─────────────────────────────────────────

export const STORAGE_KEY_NSEC  = 'nostr-paper:nsec'
export const STORAGE_KEY_PUBKEY = 'nostr-paper:pubkey'

/**
 * Log in with a private key (nsec). Stores nsec in localStorage
 * and attaches a signer to the live NDK instance.
 * Returns the hex pubkey on success.
 */
export async function loginWithNsec(nsec: string): Promise<string> {
  const signer = new NDKPrivateKeySigner(nsec)
  const user = await signer.user()
  const ndk = getNDK()
  ndk.signer = signer
  localStorage.setItem(STORAGE_KEY_NSEC, nsec)
  localStorage.removeItem(STORAGE_KEY_PUBKEY)
  return user.pubkey
}

/**
 * Log in read-only with a pubkey (npub or hex).
 * No signer — profile and settings are viewable but events can't be signed.
 */
export function loginWithPubkey(pubkey: string): void {
  localStorage.setItem(STORAGE_KEY_PUBKEY, pubkey)
  localStorage.removeItem(STORAGE_KEY_NSEC)
}

/**
 * Clear all stored credentials and remove the NDK signer.
 */
export function performLogout(): void {
  localStorage.removeItem(STORAGE_KEY_NSEC)
  localStorage.removeItem(STORAGE_KEY_PUBKEY)
  if (_ndk) {
    _ndk.signer = undefined
  }
}

/**
 * Disconnect all relays and clean up.
 */
export function disconnectNDK(): void {
  if (!_ndk) return
  // NDK doesn't have a global disconnect — close pool
  _ndk.pool.relays.forEach(relay => relay.disconnect())
  _ndk = null
}

// ── Live Relay Pool Management ───────────────────────────────

/**
 * Add a relay URL to the active NDK pool and start connecting.
 * Safe to call after initNDK(). No-ops if NDK is not initialized yet.
 */
export function addRelayToPool(url: string): void {
  if (!_ndk || !isValidRelayURL(url)) return
  if (_ndk.pool.relays.has(url)) return
  const relay = new NDKRelay(url, _ndk.relayAuthDefaultPolicy, _ndk)
  _ndk.pool.addRelay(relay, true)
}

/**
 * Remove a relay URL from the active NDK pool and disconnect it.
 * Safe to call with unknown URLs (no-op if not in pool).
 */
export function removeRelayFromPool(url: string): void {
  if (!_ndk) return
  _ndk.pool.removeRelay(url)
}

/**
 * Returns the current ordered list of relay URLs in the NDK pool.
 */
export function getPoolRelayUrls(): string[] {
  if (!_ndk) return []
  return Array.from(_ndk.pool.relays.keys())
}
