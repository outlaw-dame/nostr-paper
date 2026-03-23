import { useEffect, useMemo, useState } from 'react'
import { moderateContentDocuments } from '@/lib/moderation/client'
import {
  buildEventModerationDocument,
  buildProfileModerationDocument,
  getModerationDocumentCacheKey,
} from '@/lib/moderation/content'
import type { ModerationDecision, ModerationDocument, NostrEvent, Profile } from '@/types'

const inMemoryModerationCache = new Map<string, ModerationDecision>()

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
  options: { enabled?: boolean } = {},
): UseModerationDocumentsResult {
  const enabled = options.enabled ?? true
  const [decisions, setDecisions] = useState<Map<string, ModerationDecision>>(new Map())
  const [loading, setLoading] = useState(false)
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
    const nextDecisions = new Map<string, ModerationDecision>()
    const missing: ModerationDocument[] = []

    for (const document of documents) {
      const cacheKey = getModerationDocumentCacheKey(document)
      const cached = inMemoryModerationCache.get(cacheKey)
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

    moderateContentDocuments(missing, controller.signal)
      .then((results) => {
        if (controller.signal.aborted) return

        const merged = new Map(nextDecisions)
        for (const decision of results) {
          const document = missing.find((entry) => entry.id === decision.id)
          if (!document) continue

          const cacheKey = getModerationDocumentCacheKey(document)
          inMemoryModerationCache.set(cacheKey, decision)
          merged.set(decision.id, decision)
        }

        setDecisions(merged)
        setLoading(false)
      })
      .catch((moderationError: unknown) => {
        if (controller.signal.aborted) return
        setError(moderationError instanceof Error ? moderationError.message : 'Content moderation failed.')
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
    const failOpen = error !== null

    for (const document of documents) {
      const decision = decisions.get(document.id)
      if (!decision) {
        if (!failOpen) blocked.add(document.id)
        continue
      }

      if (decision.action === 'block') blocked.add(document.id)
    }

    return blocked
  }, [documents, decisions, error])

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
  options: { enabled?: boolean } = {},
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
  options: { enabled?: boolean } = {},
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
