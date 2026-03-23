import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import NDK, {
  NDKSubscriptionCacheUsage,
  type NDKEvent,
  type NDKSubscription,
} from '@nostr-dev-kit/ndk'
import { useApp } from '@/contexts/app-context'
import { getFollows, queryEvents } from '@/lib/db/nostr'
import { isEventExpired } from '@/lib/nostr/expiration'
import { getNDK } from '@/lib/nostr/ndk'
import {
  collectStoryGroups,
  STORY_LOOKBACK_SECONDS,
  STORY_QUERY_KINDS,
  type StoryGroup,
} from '@/lib/nostr/stories'
import { isValidEvent } from '@/lib/security/sanitize'
import type { NostrEvent, NostrFilter } from '@/types'

const MAX_STORY_EVENT_COUNT = 400
const STORY_CLOCK_TICK_MS = 60_000

function dedupeEvents(events: NostrEvent[]): NostrEvent[] {
  const map = new Map<string, NostrEvent>()
  for (const event of events) {
    map.set(event.id, event)
  }

  return [...map.values()].sort((left, right) => (
    right.created_at - left.created_at || left.id.localeCompare(right.id)
  ))
}

function buildStoriesFilter(authors: string[]): NostrFilter {
  return {
    authors,
    kinds: STORY_QUERY_KINDS,
    since: Math.floor(Date.now() / 1000) - STORY_LOOKBACK_SECONDS,
    limit: MAX_STORY_EVENT_COUNT,
  }
}

export interface UseStoriesRailResult {
  groups: StoryGroup[]
  loading: boolean
  error: string | null
}

export function useStoriesRail(enabled = true): UseStoriesRailResult {
  const { currentUser } = useApp()
  const [authors, setAuthors] = useState<string[]>([])
  const [events, setEvents] = useState<NostrEvent[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const subRef = useRef<NDKSubscription | null>(null)

  const refreshAuthors = useCallback(async () => {
    if (!enabled || !currentUser?.pubkey) {
      setAuthors([])
      return
    }

    const follows = await getFollows(currentUser.pubkey)
    setAuthors([...new Set([currentUser.pubkey, ...follows])])
  }, [currentUser?.pubkey, enabled])

  useEffect(() => {
    if (!enabled || !currentUser?.pubkey) {
      setAuthors([])
      setEvents([])
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false

    const runRefresh = async () => {
      try {
        await refreshAuthors()
      } catch (refreshError) {
        if (cancelled) return
        setError(refreshError instanceof Error ? refreshError.message : 'Failed to load followed stories.')
      }
    }

    void runRefresh()

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void runRefresh()
      }
    }

    window.addEventListener('focus', runRefresh)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      cancelled = true
      window.removeEventListener('focus', runRefresh)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [currentUser?.pubkey, enabled, refreshAuthors])

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1000))
    }, STORY_CLOCK_TICK_MS)

    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!enabled || authors.length === 0) {
      setEvents([])
      setLoading(false)
      subRef.current?.stop()
      subRef.current = null
      return
    }

    const controller = new AbortController()
    const { signal } = controller
    const filter = buildStoriesFilter(authors)

    setLoading(true)
    setError(null)

    const loadStories = async () => {
      const cached = await queryEvents(filter)
      if (signal.aborted) return
      setEvents(dedupeEvents(cached))
      setLoading(false)

      let ndk: NDK
      try {
        ndk = getNDK()
      } catch {
        return
      }

      if (signal.aborted) return

      const sub = ndk.subscribe(
        filter as Parameters<typeof ndk.subscribe>[0],
        {
          closeOnEose: false,
          cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST,
        },
      )

      subRef.current = sub

      sub.on('event', (ndkEvent: NDKEvent) => {
        if (signal.aborted) return
        const raw = ndkEvent.rawEvent() as unknown as NostrEvent
        if (!isValidEvent(raw) || isEventExpired(raw)) return

        setEvents((current) => dedupeEvents([raw, ...current]).slice(0, MAX_STORY_EVENT_COUNT))
      })
    }

    loadStories().catch((loadError) => {
      if (signal.aborted) return
      setLoading(false)
      setError(loadError instanceof Error ? loadError.message : 'Failed to load followed stories.')
    })

    return () => {
      controller.abort()
      subRef.current?.stop()
      subRef.current = null
    }
  }, [authors, enabled])

  const groups = useMemo(
    () => collectStoryGroups(events, now),
    [events, now],
  )

  return { groups, loading, error }
}
