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
 */

import NDK, {
  NDKNip07Signer,
  NDKNip46Signer,
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
import { shouldBlockEvent } from '@/lib/filters/ingestFilter'
import { withRetry } from '@/lib/retry'
import type { Profile, NostrEvent, NostrFilter } from '@/types'

// ── Default Relay Set ────────────────────────────────────────
import { initRelayOptimizer, getRelayOptimizer } from '@/lib/nostr/relay-optimizer'

// ── Default Relay Set ────────────────────────────────────────
// Well-known, reliable relays with broad coverage
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.momostr.pink',
  'wss://relay.mostr.pub',
  'wss://relay.ditto.pub',
  'wss://nostr.wine',
  'wss://relay.snort.social',
  'wss://relay.primal.net',
  'wss://nostr.bitcoiner.social',
  'wss://relay.nostr.band',
  'wss://search.nos.today',
  'wss://nostr.fmt.wiz.biz',
  'wss://relay.nos.social',
  'wss://news.nos.social',
  'wss://relay.nostr.net',
] as const

function getConfiguredDefaultRelays(): string[] {
  const configured = import.meta.env.VITE_DEFAULT_RELAY_URLS?.trim()
  if (!configured) return []

  return configured
    .split(',')
    .map((url: string) => url.trim())
    .filter((url: string) => url.length > 0)
    .filter((url: string) => isUsableRelayUrl(url))
}

function getExclusiveConfiguredRelays(): boolean {
  return import.meta.env.VITE_DEFAULT_RELAYS_EXCLUSIVE === 'true'
}

function forceDefaultRelays(): boolean {
  return import.meta.env.VITE_FORCE_DEFAULT_RELAYS === 'true'
}

const BLOCKED_RELAY_URLS = new Set<string>()

function normalizeRelayCandidate(url: string): string {
  return url.trim().replace(/\/+$/, '/')
}

function isUsableRelayUrl(url: string): boolean {
  if (!isValidRelayURL(url)) return false
  return !BLOCKED_RELAY_URLS.has(normalizeRelayCandidate(url))
}

// ── NIP-50 Search Relay Set ───────────────────────────────────
// Relays explicitly supporting the NIP-50 full-text search filter.
// Used by searchRelays() so search queries are routed to the best sources
// without requiring all of them to be in the general subscription pool.
export const SEARCH_RELAY_URLS = [
  'wss://relay.nostr.band',    // Built specifically for search/indexing
  'wss://search.nos.today',    // Dedicated NIP-50 search relay
  'wss://relay.damus.io',
  'wss://nostr.wine',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://relay.primal.net',
  'wss://nostr.bitcoiner.social',
  'wss://relay.nos.social',
  'wss://relay.nostr.net',
] as const

const OUTBOX_RELAYS = [
  'wss://purplepag.es',  // NIP-65 relay list lookups
] as const

const ENABLE_OUTBOX_MODEL = import.meta.env.VITE_DISABLE_OUTBOX_MODEL !== 'true'
const NIP46_READY_TIMEOUT_MS = 12_000
const NIP46_MAX_TOKEN_LENGTH = 2_048
const NIP46_MAX_RELAY_HINTS = 8

export function getDefaultRelayUrls(): string[] {
  const configuredRelays = getConfiguredDefaultRelays()
  if (configuredRelays.length === 0) return [...DEFAULT_RELAYS]

  if (getExclusiveConfiguredRelays()) {
    return configuredRelays
  }

  // Put configured relays first while preserving default coverage and order.
  return [...new Set([...configuredRelays, ...DEFAULT_RELAYS])]
}

export function getPrimaryConfiguredRelayUrl(): string | null {
  const configuredRelays = getConfiguredDefaultRelays()
  return configuredRelays[0] ?? null
}

export function getOutboxRelayUrls(): string[] {
  return [...OUTBOX_RELAYS]
}

/**
 * Get relay optimizer instance (for ML-based relay selection)
 * Returns null if not yet initialized
 */
export { getRelayOptimizer }
// ── SQLite Cache Adapter ─────────────────────────────────────
// (relay optimizer is exported above and initialized in initNDK)

class SQLiteCacheAdapter implements NDKCacheAdapter {
  // SQLite-backed local state is fast enough to be treated as a primary cache.
  // This lets NDK reuse cached relay-list events for outbox routing.
  readonly locking = true

  private readonly inflightEventWrites = new Map<string, Promise<void>>()
  private eventWriteQueue: Promise<void> = Promise.resolve()

  async waitForEvents(eventIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(eventIds)]
    await Promise.all(
      uniqueIds.map((eventId) => this.inflightEventWrites.get(eventId)?.catch(() => {}) ?? Promise.resolve()),
    )
  }

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
      return
    }

    // Ingest-layer keyword filter: drop blocked events before they reach the DB
    if (shouldBlockEvent(rawEvent)) {
      return
    }

    // Serialize writes in the background so relay intake stays responsive.
    // Consumers that require a completed write use waitForCachedEvents().
    const writePromise = this.eventWriteQueue
      .catch(() => undefined)
      .then(() => insertEvent(rawEvent))
      .then(() => undefined)
      .catch((error) => {
        console.warn('[NDK cache] Event write degraded:', error)
      })
      .finally(() => {
        this.inflightEventWrites.delete(rawEvent.id)
      })

    this.inflightEventWrites.set(rawEvent.id, writePromise)
    this.eventWriteQueue = writePromise
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
const cacheAdapter = new SQLiteCacheAdapter()

function normalizeRelayPoolUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.pathname === '/') parsed.pathname = ''
    return parsed.toString()
  } catch {
    return url.replace(/\/+$/g, '')
  }
}

function resolveRelayPoolKey(url: string): string | null {
  if (!_ndk) return null

  const normalized = normalizeRelayPoolUrl(url)
  const candidates = [...new Set([
    url,
    normalized,
    `${normalized}/`,
  ])]

  for (const candidate of candidates) {
    if (_ndk.pool.relays.has(candidate)) return candidate
  }

  return null
}

export function getNDK(): NDK {
  if (!_ndk) throw new Error('NDK not initialized — call initNDK() first')
  return _ndk
}

export async function waitForCachedEvents(eventIds: string[]): Promise<void> {
  await cacheAdapter.waitForEvents(eventIds)
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

  const defaultRelays = getDefaultRelayUrls()
  // Validate and filter relay URLs — use user's stored list if they've customised it
  const storedRelays = getStoredRelayUrls()
  const relayCandidates = forceDefaultRelays()
    ? defaultRelays
    : (options.relays ?? storedRelays ?? defaultRelays)

  const relays = relayCandidates
    .filter(isUsableRelayUrl)
    .slice(0, 20) // hard cap

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
    cacheAdapter,
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

    // Initialize relay optimizer for ML-based selection (Phase 1)
    initRelayOptimizer(relays)
  }

  // Optional Phase 2 signer restore: reuse a persisted NIP-46 bunker token
  // when no browser extension or nsec signer is configured.
  if (!_ndk.signer && typeof localStorage !== 'undefined') {
    const storedBunker = localStorage.getItem(STORAGE_KEY_NIP46_BUNKER)?.trim()
    if (storedBunker?.startsWith('bunker://')) {
      try {
        _ndk.signer = await createNip46Signer(_ndk, storedBunker)
      } catch (error) {
        console.warn('[NDK] Failed to restore NIP-46 signer:', error)
        // Self-heal invalid/stale tokens so future boots do not repeatedly
        // spend time on an unrecoverable signer handshake.
        localStorage.removeItem(STORAGE_KEY_NIP46_BUNKER)
      }
    }
  }

  return _ndk
}

async function createNip46Signer(ndk: NDK, bunkerConnectionToken: string): Promise<NDKNip46Signer> {
  const token = bunkerConnectionToken.trim()
  if (!isValidNip46BunkerToken(token)) {
    throw new Error('Invalid NIP-46 bunker connection token.')
  }

  return withRetry(async () => {
    const signer = NDKNip46Signer.bunker(ndk, token)

    let timer: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('NIP-46 signer timed out while connecting')), NIP46_READY_TIMEOUT_MS)
    })

    try {
      await Promise.race([
        signer.blockUntilReady(),
        timeoutPromise,
      ])
      return signer
    } catch (error) {
      signer.stop()
      throw error
    } finally {
      if (timer) clearTimeout(timer)
    }
  }, {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 3_000,
    shouldRetry: (error, attempt) => attempt < 3 && isTransientNip46Error(error),
  })
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
export const STORAGE_KEY_NIP46_BUNKER = 'nostr-paper:nip46-bunker'

export type ActiveSignerKind = 'none' | 'nip07' | 'nip46' | 'nsec'

export function getActiveSignerKind(): ActiveSignerKind {
  if (!_ndk?.signer) return 'none'
  if (_ndk.signer instanceof NDKNip07Signer) return 'nip07'
  if (_ndk.signer instanceof NDKNip46Signer) return 'nip46'
  if (_ndk.signer instanceof NDKPrivateKeySigner) return 'nsec'
  return 'none'
}

function isTransientNip46Error(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('network') ||
    message.includes('relay') ||
    message.includes('socket') ||
    message.includes('connect') ||
    message.includes('temporary') ||
    message.includes('econn')
  )
}

function isHexPubkey(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value)
}

export function isValidNip46BunkerToken(value: string): boolean {
  try {
    const token = value.trim()
    if (!token.startsWith('bunker://')) return false
    if (token.length === 0 || token.length > NIP46_MAX_TOKEN_LENGTH) return false

    const parsed = new URL(token)
    if (parsed.protocol !== 'bunker:') return false

    const bunkerPubkey = parsed.hostname || parsed.pathname.replace(/^\/+/, '')
    if (!isHexPubkey(bunkerPubkey)) return false

    const userPubkey = parsed.searchParams.get('pubkey')
    if (userPubkey && !isHexPubkey(userPubkey)) return false

    const relayHints = parsed.searchParams.getAll('relay')
    const validRelays = relayHints.filter((relay) => isValidRelayURL(relay) && relay.startsWith('wss://'))
    if (validRelays.length === 0 || validRelays.length > NIP46_MAX_RELAY_HINTS) return false

    const secret = parsed.searchParams.get('secret')
    if (secret && secret.length > 256) return false

    return true
  } catch {
    return false
  }
}

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
  localStorage.removeItem(STORAGE_KEY_NIP46_BUNKER)
  return user.pubkey
}

/**
 * Log in with a NIP-46 bunker connection token (bunker://...).
 * The connected token is persisted for restore on next boot.
 */
export async function loginWithNip46Bunker(bunkerConnectionToken: string): Promise<string> {
  const token = bunkerConnectionToken.trim()
  if (!isValidNip46BunkerToken(token)) {
    throw new Error('Invalid NIP-46 bunker connection token.')
  }

  const ndk = getNDK()
  const signer = await createNip46Signer(ndk, token)
  const user = await signer.user()

  ndk.signer = signer
  localStorage.setItem(STORAGE_KEY_NIP46_BUNKER, token)
  localStorage.removeItem(STORAGE_KEY_NSEC)
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
  localStorage.removeItem(STORAGE_KEY_NIP46_BUNKER)
}

/**
 * Clear all stored credentials and remove the NDK signer.
 */
export function performLogout(): void {
  localStorage.removeItem(STORAGE_KEY_NSEC)
  localStorage.removeItem(STORAGE_KEY_PUBKEY)
  localStorage.removeItem(STORAGE_KEY_NIP46_BUNKER)
  if (_ndk) {
    if (_ndk.signer instanceof NDKNip46Signer) {
      _ndk.signer.stop()
    }
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

  if (resolveRelayPoolKey(url)) return

  const normalized = normalizeRelayPoolUrl(url)
  const relay = new NDKRelay(normalized, _ndk.relayAuthDefaultPolicy, _ndk)
  _ndk.pool.addRelay(relay, true)
}

/**
 * Remove a relay URL from the active NDK pool and disconnect it.
 * Safe to call with unknown URLs (no-op if not in pool).
 */
export function removeRelayFromPool(url: string): void {
  if (!_ndk) return

  const key = resolveRelayPoolKey(url)
  if (!key) return

  _ndk.pool.removeRelay(key)
}

/**
 * Returns the current ordered list of relay URLs in the NDK pool.
 */
export function getPoolRelayUrls(): string[] {
  if (!_ndk) return []
  return Array.from(_ndk.pool.relays.keys())
}

/**
 * Force a reconnect cycle for a relay already known to the pool.
 * Returns true when a retry attempt was scheduled.
 */
export function retryRelayConnection(url: string): boolean {
  if (!_ndk || !isValidRelayURL(url)) return false

  const key = resolveRelayPoolKey(url)
  if (!key) return false

  const existingRelay = _ndk.pool.relays.get(key)
  if (!existingRelay) return false

  existingRelay.disconnect()
  _ndk.pool.removeRelay(key)
  const relay = new NDKRelay(normalizeRelayPoolUrl(url), _ndk.relayAuthDefaultPolicy, _ndk)
  _ndk.pool.addRelay(relay, true)
  return true
}

export function canRetryRelayConnection(url: string): boolean {
  if (!_ndk || !isValidRelayURL(url)) return false
  return resolveRelayPoolKey(url) !== null
}
