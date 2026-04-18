/**
 * useTopicClusters
 *
 * Runs incremental centroid clustering on the current feed events and exposes
 * stable topic assignments that can be used to filter or group feed content.
 *
 * - Runs incrementally while events stream in.
 * - Debounced (800 ms) so rapid event additions don't thrash the worker.
 * - Non-blocking: the worker runs in the background; the feed renders normally
 *   while clustering is in progress.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { clusterSemanticDocuments } from '@/lib/semantic/client'
import { eventToSemanticText } from '@/lib/semantic/text'
import type { NostrEvent, TopicAssignment } from '@/types'

const DEBOUNCE_MS = 800
/** Minimum cluster size to show as a filter option in the UI. */
const MIN_DISPLAY_SIZE = 1
/** How many events to send for clustering at once (avoids huge IDB writes). */
const MAX_CLUSTER_BATCH = 200
/** If semantic clustering takes longer than this, fall back to lexical. */
const SEMANTIC_TIMEOUT_MS = 4000

const FALLBACK_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'is', 'are', 'to', 'of', 'in', 'on', 'for',
  'with', 'this', 'that', 'it', 'you', 'we', 'they', 'http', 'https', 'www',
])

function tokenizeForFallback(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((value) => value.length > 2 && !FALLBACK_STOP_WORDS.has(value))
}

function buildFallbackAssignments(docs: Array<{ id: string; text: string }>): TopicAssignment[] {
  if (docs.length === 0) return []

  const byToken = new Map<string, string[]>()
  for (const doc of docs) {
    const tokens = tokenizeForFallback(doc.text)
    const token = tokens[0] ?? 'general'
    const list = byToken.get(token) ?? []
    list.push(doc.id)
    byToken.set(token, list)
  }

  const assignments: TopicAssignment[] = []
  for (const [token, ids] of byToken) {
    for (const id of ids) {
      assignments.push({
        id,
        topicId: `fallback:${token}`,
        keywords: [token],
      })
    }
  }

  return assignments
}

export interface TopicCluster {
  id: string
  keywords: string[]
  count: number
}

export interface UseTopicClustersResult {
  /** All clusters above MIN_DISPLAY_SIZE, sorted by count descending. */
  topics: TopicCluster[]
  /** The currently active topic filter, or null for "All". */
  topicFilter: string | null
  /** Set the active topic filter. Pass null to show all. */
  setTopicFilter: (id: string | null) => void
  /**
   * Given an event id, returns whether it passes the current topic filter.
   * Always returns true when topicFilter is null.
   */
  eventPassesFilter: (eventId: string) => boolean
  /** True while the initial clustering pass is in progress. */
  clustering: boolean
}

export function useTopicClusters(
  events: NostrEvent[],
  enabled: boolean,
): UseTopicClustersResult {
  const [assignments, setAssignments] = useState<TopicAssignment[]>([])
  const [clustering, setClustering] = useState(false)
  const [topicFilter, setTopicFilter] = useState<string | null>(null)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Stable event id list — only triggers clustering when the set changes.
  const eventIds = useMemo(() => events.map(e => e.id), [events])
  const eventIdsKey = eventIds.slice(0, MAX_CLUSTER_BATCH).join(',')

  useEffect(() => {
    if (!enabled || events.length === 0) return

    // Debounce without starvation: once scheduled, let the pending run fire
    // even if new events keep arriving.
    if (timerRef.current !== null) return

    timerRef.current = setTimeout(() => {
      timerRef.current = null
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const docs = events
        .slice(0, MAX_CLUSTER_BATCH)
        .flatMap(event => {
          const text = eventToSemanticText(event)
          if (!text) return []
          return [{
            id: event.id,
            kind: 'event' as const,
            text,
            updatedAt: event.created_at,
          }]
        })

      if (docs.length === 0) return

      setClustering(true)
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), SEMANTIC_TIMEOUT_MS),
      )
      Promise.race([clusterSemanticDocuments(docs, controller.signal), timeout])
        .then(results => {
          if (controller.signal.aborted) return
          if (results.length > 0) {
            setAssignments(results)
            return
          }

          setAssignments(buildFallbackAssignments(docs))
        })
        .catch(() => {
          if (controller.signal.aborted) return
          setAssignments(buildFallbackAssignments(docs))
        })
        .finally(() => {
          if (!controller.signal.aborted) setClustering(false)
        })
    }, DEBOUNCE_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, eventIdsKey])

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      abortRef.current?.abort()
    }
  }, [])

  // Build a topicId → eventId set map for O(1) filter lookups.
  const topicToEventIds = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const a of assignments) {
      let set = map.get(a.topicId)
      if (!set) { set = new Set(); map.set(a.topicId, set) }
      set.add(a.id)
    }
    return map
  }, [assignments])

  // Collapsed topic list for the UI.
  const topics = useMemo<TopicCluster[]>(() => {
    const clusters = new Map<string, { keywords: string[]; count: number }>()
    for (const a of assignments) {
      const existing = clusters.get(a.topicId)
      if (existing) {
        existing.count++
      } else {
        clusters.set(a.topicId, { keywords: a.keywords, count: 1 })
      }
    }
    return [...clusters.entries()]
      .filter(([, c]) => c.count >= MIN_DISPLAY_SIZE)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([id, c]) => ({ id, keywords: c.keywords, count: c.count }))
  }, [assignments])

  // Clear filter if the active topic disappears (e.g. after a feed section change).
  useEffect(() => {
    if (topicFilter !== null && !topics.some(t => t.id === topicFilter)) {
      setTopicFilter(null)
    }
  }, [topics, topicFilter])

  const eventPassesFilter = useCallback((eventId: string): boolean => {
    if (topicFilter === null) return true
    return topicToEventIds.get(topicFilter)?.has(eventId) ?? false
  }, [topicFilter, topicToEventIds])

  return { topics, topicFilter, setTopicFilter, eventPassesFilter, clustering }
}
