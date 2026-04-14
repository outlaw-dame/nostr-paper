import { useEffect, useMemo, useState } from 'react'
import { moderateContentDocuments } from '@/lib/moderation/client'
import { resolveTagrModerationDecisions } from '@/lib/moderation/tagr'
import {
  buildEventModerationDocument,
  buildProfileModerationDocument,
  getModerationDocumentCacheKey,
} from '@/lib/moderation/content'
import type { ModerationDecision, ModerationDocument, NostrEvent, Profile } from '@/types'

// Bounded in-memory LRU cache — evict oldest when over the limit so the
// cache doesn't grow unbounded across a long session with thousands of events.
const MODERATION_CACHE_MAX = 1_000
const inMemoryModerationCache = new Map<string, ModerationDecision>()

function cacheSetModeration(key: string, value: ModerationDecision): void {
  if (inMemoryModerationCache.size >= MODERATION_CACHE_MAX) {
    // Map preserves insertion order; the first key is the oldest.
    const firstKey = inMemoryModerationCache.keys().next().value
    if (firstKey !== undefined) inMemoryModerationCache.delete(firstKey)
  }
  inMemoryModerationCache.set(key, value)
}

interface UseModerationDocumentsResult {
  decisions: Map<string, ModerationDecision>
  allowedIds: Set<string>
  blockedIds: Set<string>
  loading: boolean
  error: string | null
}

function getAllowedIds(
  documents: ModerationDocument[],
  decisions: Map<string, ModerationDecision>,
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

export function useModerationDocuments(
  documents: ModerationDocument[],
  options: { enabled?: boolean; failClosed?: boolean } = {},
): UseModerationDocumentsResult {
  const enabled = options.enabled ?? true
  const failClosed = options.failClosed ?? false
  const [decisions, setDecisions] = useState<Map<string, ModerationDecision>>(new Map())
  // Start loading:true so consumers don't render undecided events before
  // the first decision batch arrives (prevents feed flicker).
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const signature = useMemo(
    () => documents
      .map((document) => `${document.id}:${getModerationDocumentCacheKey(document)}`)
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
    const missing: ModerationDocument[] = []

    for (const document of documents) {
      const cacheKey = getModerationDocumentCacheKey(document)
      const cached = inMemoryModerationCache.get(cacheKey)
      if (!cached) {
        missing.push(document)
      }
    }

    setError(null)
    setLoading(true)

    Promise.all([
      missing.length > 0
        ? moderateContentDocuments(missing, controller.signal)
        : Promise.resolve([]),
      resolveTagrModerationDecisions(documents, controller.signal).catch(() => new Map<string, ModerationDecision>()),
    ])
      .then(([results, tagrDecisions]) => {
        if (controller.signal.aborted) return

        setDecisions((previous) => {
          const merged = new Map<string, ModerationDecision>()

          for (const document of documents) {
            const cacheKey = getModerationDocumentCacheKey(document)
            const cached = inMemoryModerationCache.get(cacheKey)

            if (cached) {
              merged.set(document.id, cached)
              continue
            }

            const priorDecision = previous.get(document.id)
            if (priorDecision) {
              merged.set(document.id, priorDecision)
            }
          }

          for (const decision of results) {
            const document = missing.find((entry) => entry.id === decision.id)
            if (!document) continue

            const cacheKey = getModerationDocumentCacheKey(document)
            cacheSetModeration(cacheKey, decision)
            merged.set(decision.id, decision)
          }

          for (const [id, tagrDecision] of tagrDecisions) {
            const existing = merged.get(id)
            if (!existing || existing.action !== 'block') {
              merged.set(id, tagrDecision)
            }
          }

          return merged
        })
        setLoading(false)
      })
      .catch((moderationError: unknown) => {
        if (controller.signal.aborted) return
        setError(moderationError instanceof Error ? moderationError.message : 'Content moderation failed.')
        setLoading(false)
      })

    return () => controller.abort()
    // `documents` is intentionally excluded: `signature` encodes all document
    // content, so reference-only changes (same array content, new object) do not
    // re-trigger a relay fetch. Including `documents` caused a Tagr relay query
    // on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, signature])

  const allowedIds = useMemo(
    () => getAllowedIds(documents, decisions, !failClosed && error !== null),
    [documents, decisions, error, failClosed],
  )

  const blockedIds = useMemo(() => {
    const blocked = new Set<string>()
    const failOpen = !failClosed && error !== null

    for (const document of documents) {
      const decision = decisions.get(document.id)
      if (!decision) {
        if (!failOpen) blocked.add(document.id)
        continue
      }

      if (decision.action === 'block') blocked.add(document.id)
    }

    return blocked
  }, [documents, decisions, error, failClosed])

  return {
    decisions,
    allowedIds,
    blockedIds,
    loading,
    error,
  }
}

export function useEventModeration(
  event: NostrEvent | null | undefined,
  options: { enabled?: boolean; failClosed?: boolean } = {},
): {
  blocked: boolean
  loading: boolean
  decision: ModerationDecision | null
  error: string | null
} {
  const documents = useMemo(
    () => (event ? [buildEventModerationDocument(event)].filter((document): document is ModerationDocument => document !== null) : []),
    [event],
  )
  const moderation = useModerationDocuments(documents, options)
  const decision = event ? moderation.decisions.get(event.id) ?? null : null

  return {
    blocked: event ? moderation.blockedIds.has(event.id) : false,
    loading: moderation.loading,
    decision,
    error: moderation.error,
  }
}

export function useProfileModeration(
  profile: Profile | null | undefined,
  options: { enabled?: boolean; failClosed?: boolean } = {},
): {
  blocked: boolean
  loading: boolean
  decision: ModerationDecision | null
  error: string | null
} {
  const documents = useMemo(
    () => (profile ? [buildProfileModerationDocument(profile)].filter((document): document is ModerationDocument => document !== null) : []),
    [profile],
  )
  const moderation = useModerationDocuments(documents, options)
  const decision = profile ? moderation.decisions.get(profile.pubkey) ?? null : null

  return {
    blocked: profile ? moderation.blockedIds.has(profile.pubkey) : false,
    loading: moderation.loading,
    decision,
    error: moderation.error,
  }
}
