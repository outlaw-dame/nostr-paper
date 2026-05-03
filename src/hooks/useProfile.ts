/**
 * useProfile
 *
 * Resolves a Nostr profile (kind 0) with cache-first strategy:
 * 1. Return cached profile from SQLite immediately
 * 2. If cache is stale (>1h) or missing, fetch from relays in background
 * 3. Validated event is inserted into SQLite, then re-read as sanitised Profile
 *
 * Background fetch uses exponential backoff.
 * AbortController cancels in-flight work on unmount or pubkey change.
 */

import { useEffect, useReducer, useRef, useCallback } from 'react'
import { getNDK } from '@/lib/nostr/ndk'
import { getProfile, insertEvent, repairStoredProfile } from '@/lib/db/nostr'
import {
  hasAttemptedProfileRepair,
  recordProfileRepairAttempt,
} from '@/lib/db/caches'
import {
  lookupCachedProfile,
  rememberProfile,
} from '@/lib/db/profileCache'
import { PROFILE_UPDATED_EVENT } from '@/lib/nostr/metadata'
import { verifyProfileNip05 } from '@/lib/nostr/nip05'
import { isValidHex32 } from '@/lib/security/sanitize'
import { withRetry } from '@/lib/retry'
import type { Profile, NostrEvent } from '@/types'
import { Kind } from '@/types'

const STALE_THRESHOLD_S = 60 * 60  // 1 hour
const PROFILE_FETCH_LIMIT = 6
const PROFILE_CACHE_SETTLE_ATTEMPTS = 4
const PROFILE_CACHE_SETTLE_DELAY_MS = 75
const inflightNip05Refreshes = new Map<string, Promise<void>>()
const inflightRelayProfileFetches = new Map<string, Promise<void>>()

/**
 * Cache-aware wrapper around `getProfile()` that consults the in-process
 * LRU before paying the worker round-trip cost. Exported via re-export of
 * the cache module; kept here as a convenience for adjacent consumers.
 */
async function readProfileWithCache(pk: string): Promise<Profile | null> {
  const cached = lookupCachedProfile(pk)
  if (cached !== undefined) return cached
  const fresh = await getProfile(pk)
  rememberProfile(pk, fresh)
  return fresh
}
// Used at module load by adjacent hooks; keep a reference so tree-shaking
// doesn't drop it before its planned consumers land.
export const __readProfileWithCache = readProfileWithCache

interface ProfileState {
  profile: Profile | null
  loading: boolean
  error:   string | null
}

type ProfileAction =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_HIT';  payload: Profile }
  | { type: 'LOAD_MISS' }
  | { type: 'UPDATE';    payload: Profile }
  | { type: 'ERROR';     payload: string }

function reducer(state: ProfileState, action: ProfileAction): ProfileState {
  switch (action.type) {
    case 'LOAD_START': return { ...state, loading: true, error: null }
    case 'LOAD_HIT':   return { loading: false, error: null, profile: action.payload }
    case 'LOAD_MISS':  return { ...state, loading: false }
    case 'UPDATE':     return { ...state, profile: action.payload }
    case 'ERROR':      return { ...state, loading: false, error: action.payload }
    default:           return state
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'))
  }

  return new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort)
      resolve()
    }, ms)

    const handleAbort = () => {
      globalThis.clearTimeout(timeoutId)
      reject(new DOMException('Aborted', 'AbortError'))
    }

    signal.addEventListener('abort', handleAbort, { once: true })
  })
}

function compareReplaceableMetadataEvents(a: NostrEvent, b: NostrEvent): number {
  if (a.created_at !== b.created_at) return b.created_at - a.created_at
  return a.id.localeCompare(b.id)
}

function isProfileFreshEnough(
  profile: Profile | null,
  expected: NostrEvent | null,
): boolean {
  if (!profile) return false
  if (!expected) return true
  if (profile.eventId === expected.id) return true
  return profile.updatedAt >= expected.created_at
}

function shouldAttemptLocalProfileRepair(profile: Profile | null): boolean {
  if (!profile?.eventId) return false
  return !profile.picture || !profile.banner
}

export function useProfile(
  pubkey: string | null | undefined,
  options: UseProfileOptions = {},
) {
  return useProfileWithOptions(pubkey, options)
}

export interface UseProfileOptions {
  background?: boolean
}

export function useProfileWithOptions(
  pubkey: string | null | undefined,
  options: UseProfileOptions = {},
) {
  const [state, dispatch] = useReducer(reducer, {
    profile: null,
    loading: false,
    error:   null,
  })
  const background = options.background ?? true

  const abortRef = useRef<AbortController | null>(null)

  const refreshNip05 = useCallback(async (pk: string, signal: AbortSignal) => {
    const existing = inflightNip05Refreshes.get(pk)
    if (existing) {
      await existing.catch(() => {})
    } else {
      const promise = (async () => {
        const status = await verifyProfileNip05(pk, signal)
        if (signal.aborted || status === 'skipped') return
      })().finally(() => {
        inflightNip05Refreshes.delete(pk)
      })

      inflightNip05Refreshes.set(pk, promise)
      await promise.catch(() => {})
    }

    if (signal.aborted) return
    const fresh = await getProfile(pk)
    if (fresh && !signal.aborted) {
      dispatch({ type: 'UPDATE', payload: fresh })
    }
  }, [])

  /**
   * Fetch the signed kind-0 event for `pk` from relays, insert it into SQLite,
   * then dispatch an UPDATE with the sanitised profile read back from the DB.
   *
   * Uses withRetry for transient relay failures with a 2-attempt cap so the
   * background refresh does not spin for a long time.
   */
  const fetchFromRelay = useCallback(async (pk: string, signal: AbortSignal, bg: boolean) => {
    const existing = inflightRelayProfileFetches.get(pk)
    if (existing) {
      await existing.catch(() => {})
      if (signal.aborted) return
      const fresh = await getProfile(pk)
      if (fresh && !signal.aborted) {
        dispatch({ type: 'UPDATE', payload: fresh })
      }
      return
    }

    let ndk
    try { ndk = getNDK() } catch { return }

    if (signal.aborted) return

    const promise = withRetry(
      async () => {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

        const eventSet = await ndk.fetchEvents({
          kinds:   [Kind.Metadata],
          authors: [pk],
          limit:   PROFILE_FETCH_LIMIT,
        })

        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

        const fetchedEvents = [...eventSet]
          .map((event) => event.rawEvent() as unknown as NostrEvent)
          .filter((event) => event.kind === Kind.Metadata && event.pubkey === pk)
          .sort(compareReplaceableMetadataEvents)

        const freshestEvent = fetchedEvents[0] ?? null

        let fresh = await getProfile(pk)
        if (!isProfileFreshEnough(fresh, freshestEvent)) {
          for (let attempt = 0; attempt < PROFILE_CACHE_SETTLE_ATTEMPTS; attempt += 1) {
            await sleep(PROFILE_CACHE_SETTLE_DELAY_MS, signal)
            fresh = await getProfile(pk)
            if (isProfileFreshEnough(fresh, freshestEvent)) break
          }
        }

        if (!isProfileFreshEnough(fresh, freshestEvent) && fetchedEvents.length > 0) {
          for (const event of [...fetchedEvents].reverse()) {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
            await insertEvent(event)
          }
          fresh = await getProfile(pk)
        }

        if (fresh && !signal.aborted) {
          dispatch({ type: 'UPDATE', payload: fresh })
          if (bg && fresh.nip05) {
            await refreshNip05(pk, signal)
          }
        }
      },
      {
        maxAttempts: 2,
        baseDelayMs: 2_000,
        signal,
      },
    ).finally(() => {
      inflightRelayProfileFetches.delete(pk)
    })

    inflightRelayProfileFetches.set(pk, promise)
    await promise
  }, [refreshNip05])

  useEffect(() => {
    if (!pubkey || !isValidHex32(pubkey)) {
      dispatch({ type: 'LOAD_MISS' })
      return
    }

    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    dispatch({ type: 'LOAD_START' })

    getProfile(pubkey)
      .then(async (cached) => {
        if (signal.aborted) return

        // Prime the in-process LRU so adjacent components don't re-read.
        rememberProfile(pubkey, cached)

        if (cached) {
          let displayProfile = cached

          if (shouldAttemptLocalProfileRepair(cached) && cached.eventId) {
            const alreadyAttempted = await hasAttemptedProfileRepair(
              pubkey,
              cached.eventId,
              'metadata-fields',
            )
            if (!alreadyAttempted) {
              await recordProfileRepairAttempt(pubkey, cached.eventId, 'metadata-fields')
              await repairStoredProfile(pubkey)
              const repaired = await getProfile(pubkey)
              if (repaired) {
                displayProfile = repaired
                rememberProfile(pubkey, repaired)
              }
            }
          }

          dispatch({ type: 'LOAD_HIT', payload: displayProfile })
          if (background && displayProfile.nip05) {
            refreshNip05(pubkey, signal).catch(() => {})
          }
          // Background refresh when the cache is stale or the row predates
          // the event-id-aware kind-0 schema.
          const ageSeconds = Math.floor(Date.now() / 1000) - displayProfile.updatedAt
          if (background && (ageSeconds > STALE_THRESHOLD_S || !displayProfile.eventId)) {
            fetchFromRelay(pubkey, signal, background).catch(() => {})
          }
        } else {
          dispatch({ type: 'LOAD_MISS' })
          fetchFromRelay(pubkey, signal, background).catch((err: unknown) => {
            if (signal.aborted) return
            dispatch({
              type:    'ERROR',
              payload: err instanceof Error ? err.message : 'Profile fetch failed',
            })
          })
        }
      })
      .catch((err: unknown) => {
        if (signal.aborted) return
        dispatch({
          type:    'ERROR',
          payload: err instanceof Error ? err.message : 'Cache read failed',
        })
      })

    return () => abortRef.current?.abort()
  }, [background, pubkey, fetchFromRelay, refreshNip05])

  useEffect(() => {
    if (!background || !pubkey || typeof window === 'undefined') return

    const handleProfileUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ pubkey?: string }>).detail
      if (detail?.pubkey !== pubkey) return

      getProfile(pubkey)
        .then((fresh) => {
          if (!fresh) return
          rememberProfile(pubkey, fresh)
          dispatch({ type: 'UPDATE', payload: fresh })
          if (fresh.nip05) {
            const controller = new AbortController()
            void refreshNip05(pubkey, controller.signal).catch(() => {})
          }
        })
        .catch(() => {})
    }

    window.addEventListener(PROFILE_UPDATED_EVENT, handleProfileUpdated as EventListener)
    return () => {
      window.removeEventListener(PROFILE_UPDATED_EVENT, handleProfileUpdated as EventListener)
    }
  }, [background, pubkey, refreshNip05])

  return state
}
