import { useCallback, useEffect, useRef, useState } from 'react'
import { listLinkTimeline } from '@/lib/db/nostr'
import type { NostrEvent } from '@/types'

const PAGE_SIZE = 40

/**
 * Fetch and paginate events that mention a specific normalized URL.
 *
 * Cursor-based pagination: each `loadMore()` call passes the `created_at`
 * of the last-seen event as the exclusive `until` bound, which the SQL
 * query uses to return the next page.
 *
 * State is fully reset whenever `url` changes — no stale events leak
 * across navigations.  In-flight fetches are cancelled via a boolean
 * flag (avoids the AbortController overhead for synchronous DB calls).
 *
 * Deduplication on `loadMore` prevents duplicate rows if the DB cursor
 * overlaps due to events sharing the same `created_at`.
 */
export function useLinkTimeline(url: string | null | undefined): {
  events:   NostrEvent[]
  loading:  boolean
  loadMore: () => void
  hasMore:  boolean
} {
  const [events,  setEvents]  = useState<NostrEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  // Refs keep loadMore stable across renders without needing it in the dep array
  const oldestCreatedAtRef = useRef<number | undefined>(undefined)
  const loadingRef         = useRef(false)

  // Full reset when URL changes
  useEffect(() => {
    setEvents([])
    setLoading(false)
    setHasMore(true)
    oldestCreatedAtRef.current = undefined
    loadingRef.current = false
  }, [url])

  // Initial page load
  useEffect(() => {
    if (!url) {
      setEvents([])
      setLoading(false)
      setHasMore(false)
      return
    }

    let cancelled = false
    loadingRef.current = true
    setLoading(true)

    listLinkTimeline(url, { limit: PAGE_SIZE })
      .then((batch) => {
        if (cancelled) return
        setEvents(batch)
        if (batch.length > 0) {
          oldestCreatedAtRef.current = batch[batch.length - 1]!.created_at
        }
        setHasMore(batch.length === PAGE_SIZE)
        setLoading(false)
        loadingRef.current = false
      })
      .catch(() => {
        if (cancelled) return
        setEvents([])
        setLoading(false)
        loadingRef.current = false
        setHasMore(false)
      })

    return () => { cancelled = true }
  }, [url])

  const loadMore = useCallback(() => {
    if (!url || loadingRef.current || !hasMore) return

    const until = oldestCreatedAtRef.current
    if (until === undefined) return

    let cancelled = false
    loadingRef.current = true
    setLoading(true)

    listLinkTimeline(url, { limit: PAGE_SIZE, until })
      .then((batch) => {
        if (cancelled) return
        setEvents((prev) => {
          const seen = new Set(prev.map((e) => e.id))
          const next = batch.filter((e) => !seen.has(e.id))
          return next.length > 0 ? [...prev, ...next] : prev
        })
        if (batch.length > 0) {
          oldestCreatedAtRef.current = batch[batch.length - 1]!.created_at
        }
        setHasMore(batch.length === PAGE_SIZE)
        setLoading(false)
        loadingRef.current = false
      })
      .catch(() => {
        if (cancelled) return
        setLoading(false)
        loadingRef.current = false
      })

    return () => { cancelled = true }
  }, [url, hasMore])

  return { events, loading, loadMore, hasMore }
}
