import { useEffect, useMemo, useState } from 'react'
import { listSemanticEventCandidates } from '@/lib/db/nostr'
import {
  buildTagTimelineSemanticQuery,
  matchesTagTimeline,
  type TagTimelineSpec,
} from '@/lib/feed/tagTimeline'
import { rankSemanticDocuments } from '@/lib/semantic/client'
import { eventToSemanticText } from '@/lib/semantic/text'
import type { NostrEvent, SemanticDocument } from '@/types'

const MAX_SEMANTIC_CANDIDATES = 180
const MIN_RANKED_RESULTS = 60
const MAX_RANKED_RESULTS = 120

function eventToDocument(event: NostrEvent): SemanticDocument | null {
  const text = eventToSemanticText(event)
  if (!text) return null

  return {
    id: event.id,
    kind: 'event',
    text,
    updatedAt: event.created_at,
  }
}

export function useTagTimelineSemanticFeed(
  spec: TagTimelineSpec | null,
  kinds: number[] | undefined,
) {
  const [events, setEvents] = useState<NostrEvent[]>([])
  const [scores, setScores] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const semanticQuery = useMemo(
    () => buildTagTimelineSemanticQuery(spec),
    [spec],
  )
  const kindsKey = useMemo(
    () => JSON.stringify(kinds ?? []),
    [kinds],
  )
  const normalizedKinds = useMemo(
    () => (kinds && kinds.length > 0 ? [...kinds] : []),
    [kindsKey],
  )
  const specKey = useMemo(
    () => JSON.stringify(spec),
    [spec],
  )

  useEffect(() => {
    if (!spec || !semanticQuery) {
      setEvents([])
      setScores(new Map())
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const candidates = await listSemanticEventCandidates(semanticQuery, {
          ...(normalizedKinds.length > 0 ? { kinds: normalizedKinds } : {}),
          limit: MAX_SEMANTIC_CANDIDATES,
        })
        if (controller.signal.aborted) return

        const documents = candidates
          .map((event) => {
            const document = eventToDocument(event)
            return document ? { event, document } : null
          })
          .filter((entry): entry is { event: NostrEvent; document: SemanticDocument } => entry !== null)

        if (documents.length === 0) {
          setEvents([])
          setScores(new Map())
          setLoading(false)
          return
        }

        const matches = await rankSemanticDocuments(
          semanticQuery,
          documents.map((entry) => entry.document),
          Math.min(Math.max(spec.includeTags.length * 30, MIN_RANKED_RESULTS), MAX_RANKED_RESULTS),
          controller.signal,
        )
        if (controller.signal.aborted) return

        const scoreMap = new Map(matches.map((match) => [match.id, match.score]))
        const matchedEvents = documents
          .map((entry) => entry.event)
          .filter((event) => matchesTagTimeline(event, spec, {
            semanticScore: scoreMap.get(event.id) ?? null,
          }))
          .sort((a, b) => {
            const scoreDelta = (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0)
            if (scoreDelta !== 0) return scoreDelta
            return b.created_at - a.created_at
          })

        setEvents(matchedEvents)
        setScores(scoreMap)
        setLoading(false)
      } catch (error) {
        if (controller.signal.aborted) return
        setEvents([])
        setScores(new Map())
        setLoading(false)
        setError(error instanceof Error ? error.message : 'Semantic context unavailable')
      }
    })()

    return () => {
      controller.abort()
    }
  }, [kindsKey, normalizedKinds, semanticQuery, spec, specKey])

  return {
    events,
    scores,
    loading,
    error,
    semanticQuery,
  }
}
