/**
 * useNostrFeed
 *
 * Subscribes to Nostr events via NDK, writes validated events
 * to SQLite, and returns a reactive event list from the local DB.
 *
 * Architecture:
 *   Relay → NDK → validate → SQLite → query → UI
 *
 * - NDK handles relay pool management and deduplication at the wire level
 * - We re-validate every event before inserting (never trust relay data)
 * - UI reads exclusively from SQLite (offline-first)
 * - Subscription is cleaned up on unmount via AbortController
 * - section.filter is stabilised via useMemo to prevent infinite effect loops
 */

import { useEffect, useReducer, useRef, useCallback, useMemo } from 'react'
import type NDK from '@nostr-dev-kit/ndk';
import {
  NDKSubscriptionCacheUsage,
  type NDKEvent,
  type NDKSubscription,
} from '@nostr-dev-kit/ndk'
import { getNDK } from '@/lib/nostr/ndk'
import { queryEvents } from '@/lib/db/nostr'
import { isEventExpired } from '@/lib/nostr/expiration'
import { isValidEvent } from '@/lib/security/sanitize'
import type { NostrEvent, NostrFilter, FeedSection } from '@/types'

export interface FeedState {
  events:  NostrEvent[]
  loading: boolean
  eose:    boolean   // End of stored events received from relays
  error:   string | null
}

type FeedAction =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_CACHE'; payload: NostrEvent[] }
  | { type: 'NEW_EVENT';  payload: NostrEvent }
  | { type: 'EOSE' }
  | { type: 'ERROR';  payload: string }
  | { type: 'RESET' }

const MAX_FEED_SIZE = 200  // cap in-memory feed to prevent unbounded growth

function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loading: true, error: null }

    case 'LOAD_CACHE':
      return { ...state, loading: false, events: action.payload }

    case 'NEW_EVENT': {
      if (state.events.some(e => e.id === action.payload.id)) return state
      const events = [action.payload, ...state.events]
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, MAX_FEED_SIZE)
      return { ...state, events }
    }

    case 'EOSE':
      return { ...state, eose: true }

    case 'ERROR':
      return { ...state, loading: false, error: action.payload }

    case 'RESET':
      return { events: [], loading: true, eose: false, error: null }

    default:
      return state
  }
}

const initialState: FeedState = {
  events:  [],
  loading: true,
  eose:    false,
  error:   null,
}

// ── Hook ─────────────────────────────────────────────────────

export interface UseNostrFeedOptions {
  section:  FeedSection
  enabled?: boolean
}

export function useNostrFeed({ section, enabled = true }: UseNostrFeedOptions) {
  const [state, dispatch] = useReducer(feedReducer, initialState)
  const subRef   = useRef<NDKSubscription | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  /**
   * Stabilise the filter object so it does not trigger the effect on every render.
   * section.filter is declared as a constant in DEFAULT_SECTIONS but TypeScript
   * cannot guarantee object identity across renders when passed via props.
   * We serialise to JSON as the stable dependency key.
   */
  const filterKey = JSON.stringify(section.filter)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableFilter = useMemo<NostrFilter>(() => section.filter, [filterKey])

  const loadFromCache = useCallback(async (filter: NostrFilter) => {
    try {
      const cached = await queryEvents({ ...filter, limit: MAX_FEED_SIZE })
      dispatch({ type: 'LOAD_CACHE', payload: cached })
    } catch (err) {
      dispatch({
        type:    'ERROR',
        payload: err instanceof Error ? err.message : 'Cache load failed',
      })
    }
  }, [])

  const subscribe = useCallback(
    async (filter: NostrFilter, signal: AbortSignal) => {
      // 1. Populate from SQLite immediately — local-first UX
      await loadFromCache(filter)

      // 2. Connect to live relay stream if NDK is available
      let ndk: NDK
      try {
        ndk = getNDK()
      } catch {
        // NDK not initialised — cache-only mode, not an error
        return
      }

      if (signal.aborted) return

      const sub = ndk.subscribe(
        filter as Parameters<typeof ndk.subscribe>[0],
        {
          closeOnEose:    false,
          cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST,
        },
      )

      subRef.current = sub

      sub.on('event', (ndkEvent: NDKEvent) => {
        if (signal.aborted) return
        const raw = ndkEvent.rawEvent() as unknown as NostrEvent
        if (!signal.aborted && isValidEvent(raw) && !isEventExpired(raw)) {
          dispatch({ type: 'NEW_EVENT', payload: raw })
        }
      })

      sub.on('eose', () => {
        if (!signal.aborted) dispatch({ type: 'EOSE' })
      })
    },
    [loadFromCache],
  )

  useEffect(() => {
    if (!enabled) return

    dispatch({ type: 'RESET' })
    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    subscribe(stableFilter, signal).catch((err: unknown) => {
      if (signal.aborted) return
      dispatch({
        type:    'ERROR',
        payload: err instanceof Error ? err.message : 'Subscription failed',
      })
    })

    return () => {
      abortRef.current?.abort()
      subRef.current?.stop()
      subRef.current = null
    }
  }, [section.id, enabled, subscribe, stableFilter])

  const refresh = useCallback(() => {
    abortRef.current?.abort()
    dispatch({ type: 'RESET' })
    abortRef.current = new AbortController()
    subscribe(stableFilter, abortRef.current.signal).catch(() => {})
  }, [stableFilter, subscribe])

  return { ...state, refresh }
}
