/**
 * In-process Profile Cache
 *
 * The `profiles` table lives behind the DB worker, so every `getProfile()`
 * call costs one postMessage round-trip plus an FTS-aware row read. A long
 * feed scroll easily fires 100–300 such calls (one per visible card), which
 * shows up as jank on slower devices.
 *
 * This module is a tiny, bounded LRU that lives on the main thread and is
 * kept coherent by listening for `PROFILE_UPDATED_EVENT` (already dispatched
 * by `lib/nostr/metadata.ts` when a profile changes locally). It is purely
 * a read-through optimisation — every cache miss falls back to SQLite.
 */

import type { Profile } from '@/types'
import { PROFILE_UPDATED_EVENT } from '@/lib/nostr/metadata'

const PROFILE_CACHE_MAX = 512
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes — invalidation is event-driven below

interface CacheEntry {
  profile: Profile | null
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
let listenerInstalled = false

function ensureListener(): void {
  if (listenerInstalled || typeof window === 'undefined') return
  listenerInstalled = true
  window.addEventListener(PROFILE_UPDATED_EVENT, (event) => {
    const detail = (event as CustomEvent<{ pubkey?: string }>).detail
    if (detail?.pubkey) {
      cache.delete(detail.pubkey)
    } else {
      cache.clear()
    }
  })
}

function evictIfFull(): void {
  if (cache.size < PROFILE_CACHE_MAX) return
  const firstKey = cache.keys().next().value
  if (firstKey !== undefined) cache.delete(firstKey)
}

/** Synchronous lookup. Returns `undefined` on cache miss. `null` is a cached "no such profile". */
export function lookupCachedProfile(pubkey: string): Profile | null | undefined {
  ensureListener()
  const entry = cache.get(pubkey)
  if (!entry) return undefined
  if (entry.expiresAt < Date.now()) {
    cache.delete(pubkey)
    return undefined
  }
  // Reinsert to refresh LRU recency.
  cache.delete(pubkey)
  cache.set(pubkey, entry)
  return entry.profile
}

export function rememberProfile(pubkey: string, profile: Profile | null): void {
  ensureListener()
  evictIfFull()
  cache.set(pubkey, {
    profile,
    expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
  })
}

export function invalidateCachedProfile(pubkey: string): void {
  cache.delete(pubkey)
}

export function clearProfileCache(): void {
  cache.clear()
}
