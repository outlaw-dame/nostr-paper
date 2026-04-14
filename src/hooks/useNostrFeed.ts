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
import { getNDK, waitForCachedEvents } from '@/lib/nostr/ndk'
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
  | { type: 'NEW_EVENTS'; payload: NostrEvent[] }
  | { type: 'EOSE' }
  | { type: 'ERROR';  payload: string }
  | { type: 'RESET' }

const MAX_FEED_SIZE = 200  // cap in-memory feed to prevent unbounded growth

function mergeFeedEvents(current: NostrEvent[], incoming: NostrEvent[]): NostrEvent[] {
  if (incoming.length === 0) return current

  const merged = new Map<string, NostrEvent>()
  for (const event of current) {
    merged.set(event.id, event)
  }
  for (const event of incoming) {
    const existing = merged.get(event.id)
    if (!existing || event.created_at > existing.created_at) {
      merged.set(event.id, event)
    }
  }

  return [...merged.values()]
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, MAX_FEED_SIZE)
}

function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loading: true, error: null }

    case 'LOAD_CACHE':
      return { ...state, loading: false, events: action.payload }

    case 'NEW_EVENT': {
      if (state.events.some(e => e.id === action.payload.id)) return state
      const events = mergeFeedEvents(state.events, [action.payload])
      return { ...state, events }
    }

    case 'NEW_EVENTS': {
      const events = mergeFeedEvents(state.events, action.payload)
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
  const pendingEventsRef = useRef<NostrEvent[]>([])
  const flushTimerRef = useRef<number | null>(null)

  /**
   * Stabilise the filter object so it does not trigger the effect on every render.
   * section.filter is declared as a constant in DEFAULT_SECTIONS but TypeScript
   * cannot guarantee object identity across renders when passed via props.
   * We serialise to JSON as the stable dependency key.
   */
  const filterKey = JSON.stringify(section.filter)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableFilter = useMemo<NostrFilter>(() => section.filter, [filterKey])

  const stopActiveSubscription = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    subRef.current?.stop()
    subRef.current = null
    pendingEventsRef.current = []

    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
  }, [])

  const loadFromCache = useCallback(async (filter: NostrFilter, signal: AbortSignal) => {
    try {
      const cached = await queryEvents({
        ...filter,
        limit: Math.min(filter.limit ?? MAX_FEED_SIZE, MAX_FEED_SIZE),
      })
      if (signal.aborted) return
      dispatch({ type: 'LOAD_CACHE', payload: cached })
    } catch (err) {
      if (signal.aborted) return
      dispatch({
        type:    'ERROR',
        payload: err instanceof Error ? err.message : 'Cache load failed',
      })
    }
  }, [])

  const subscribe = useCallback(
    async (filter: NostrFilter, signal: AbortSignal) => {
      const scheduleFlush = () => {
        if (flushTimerRef.current !== null) return
        flushTimerRef.current = window.setTimeout(() => {
          flushTimerRef.current = null
          void flushPendingEvents()
        }, 96)
      }

      const flushPendingEvents = async () => {
        if (signal.aborted || pendingEventsRef.current.length === 0) return

        const pendingEvents = pendingEventsRef.current
        pendingEventsRef.current = []

        try {
          const eventIds = [...new Set(pendingEvents.map((event) => event.id))]
          await waitForCachedEvents(eventIds)
          if (signal.aborted) return

          const persistedEvents = await queryEvents({
            ids: eventIds,
            limit: Math.min(eventIds.length, MAX_FEED_SIZE),
          })

          if (signal.aborted) return
          if (persistedEvents.length > 0) {
            dispatch({ type: 'NEW_EVENTS', payload: persistedEvents })
          }
        } catch {
          if (signal.aborted) return
          dispatch({ type: 'NEW_EVENTS', payload: pendingEvents })
        } finally {
          if (!signal.aborted && pendingEventsRef.current.length > 0) {
            scheduleFlush()
          }
        }
      }

      // 1. Populate from SQLite immediately — local-first UX
      await loadFromCache(filter, signal)

      // 2. Connect to live relay stream if NDK is available
      let ndk: NDK
      try {
        ndk = getNDK()
      } catch {
        // NDK not initialised — cache-only mode, not an error
        if (!signal.aborted) {
          dispatch({ type: 'EOSE' })
        }
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
          pendingEventsRef.current.push(raw)
          scheduleFlush()
        }
      })

      sub.on('eose', () => {
        if (signal.aborted) return
        if (flushTimerRef.current !== null) {
          window.clearTimeout(flushTimerRef.current)
          flushTimerRef.current = null
        }
        void flushPendingEvents().finally(() => {
          if (!signal.aborted) {
            dispatch({ type: 'EOSE' })
          }
        })
      })
    },
    [loadFromCache],
  )

  useEffect(() => {
    if (!enabled) return

    stopActiveSubscription()
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
      stopActiveSubscription()
    }
  }, [section.id, enabled, stableFilter, stopActiveSubscription, subscribe])

  const refresh = useCallback(async () => {
    stopActiveSubscription()
    dispatch({ type: 'RESET' })
    const controller = new AbortController()
    abortRef.current = controller

    try {
      await subscribe(stableFilter, controller.signal)
    } catch (err) {
      if (controller.signal.aborted) return
      dispatch({
        type:    'ERROR',
        payload: err instanceof Error ? err.message : 'Subscription failed',
      })
    }
  }, [stableFilter, stopActiveSubscription, subscribe])

  return { ...state, refresh }
}
