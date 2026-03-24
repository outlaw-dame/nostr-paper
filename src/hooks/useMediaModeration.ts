import { useEffect, useMemo, useState } from 'react'
import { moderateMediaDocuments } from '@/lib/moderation/mediaClient'
import { getMediaModerationDocumentCacheKey } from '@/lib/moderation/mediaContent'
import type { MediaModerationDecision, MediaModerationDocument } from '@/types'

const inMemoryMediaModerationCache = new Map<string, MediaModerationDecision>()

interface UseMediaModerationDocumentsResult {
  decisions: Map<string, MediaModerationDecision>
  allowedIds: Set<string>
  blockedIds: Set<string>
  loading: boolean
  error: string | null
}

function getAllowedIds(
  documents: MediaModerationDocument[],
  decisions: Map<string, MediaModerationDecision>,
  failOpen: boolean,
): Set<string> {
  const allowed = new Set<string>()

  for (const document of documents) {
    const decision = decisions.get(document.id)
    if (!decision && failOpen) {
      allowed.add(document.id)
      continue
    }

    if (!decision || decision.action === 'block') continue
    allowed.add(document.id)
  }

  return allowed
}

export function useMediaModerationDocuments(
  documents: MediaModerationDocument[],
  options: { enabled?: boolean } = {},
): UseMediaModerationDocumentsResult {
  const enabled = options.enabled ?? true
  const [decisions, setDecisions] = useState<Map<string, MediaModerationDecision>>(new Map())
  // Initialize to true so the first render is fail-open (no false blocks before the effect runs)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const signature = useMemo(
    () => documents
      .map((document) => `${document.id}:${getMediaModerationDocumentCacheKey(document)}`)
      .join('|'),
    [documents],
  )

  useEffect(() => {
    if (!enabled || documents.length === 0) {
      setDecisions(new Map())
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    const nextDecisions = new Map<string, MediaModerationDecision>()
    const missing: MediaModerationDocument[] = []

    for (const document of documents) {
      const cacheKey = getMediaModerationDocumentCacheKey(document)
      const cached = inMemoryMediaModerationCache.get(cacheKey)
      if (cached) {
        nextDecisions.set(document.id, cached)
      } else {
        missing.push(document)
      }
    }

    setDecisions(nextDecisions)
    setError(null)

    if (missing.length === 0) {
      setLoading(false)
      return () => controller.abort()
    }

    setLoading(true)

    moderateMediaDocuments(missing, controller.signal)
      .then((results) => {
        if (controller.signal.aborted) return

        const merged = new Map(nextDecisions)
        for (const decision of results) {
          const document = missing.find((entry) => entry.id === decision.id)
          if (!document) continue

          const cacheKey = getMediaModerationDocumentCacheKey(document)
          inMemoryMediaModerationCache.set(cacheKey, decision)
          merged.set(decision.id, decision)
        }

        setDecisions(merged)
        setLoading(false)
      })
      .catch((moderationError: unknown) => {
        if (controller.signal.aborted) return
        setError(moderationError instanceof Error ? moderationError.message : 'Media moderation failed.')
        setLoading(false)
      })

    return () => controller.abort()
  }, [enabled, documents, signature])

  const allowedIds = useMemo(
    () => getAllowedIds(documents, decisions, error !== null),
    [documents, decisions, error],
  )

  const blockedIds = useMemo(() => {
    const blocked = new Set<string>()
    // Fail-open while loading or on error — only block after a definitive decision
    const failOpen = loading || error !== null

    for (const document of documents) {
      const decision = decisions.get(document.id)
      if (!decision) {
        if (!failOpen) blocked.add(document.id)
        continue
      }

      if (decision.action === 'block') blocked.add(document.id)
    }

    return blocked
  }, [documents, decisions, error, loading])

  return {
    decisions,
    allowedIds,
    blockedIds,
    loading,
    error,
  }
}

export function useMediaModerationDocument(
  document: MediaModerationDocument | null | undefined,
  options: { enabled?: boolean } = {},
): {
  blocked: boolean
  loading: boolean
  decision: MediaModerationDecision | null
  error: string | null
} {
  const documents = useMemo(
    () => (document ? [document] : []),
    [document],
  )
  const moderation = useMediaModerationDocuments(documents, options)
  const decision = document ? moderation.decisions.get(document.id) ?? null : null

  return {
    blocked: document ? moderation.blockedIds.has(document.id) : false,
    loading: moderation.loading,
    decision,
    error: moderation.error,
  }
}
