import { useEffect, useMemo, useState } from 'react'
import { moderateContentDocuments } from '@/lib/moderation/client'
import { resolveTagrModerationDecisions } from '@/lib/moderation/tagr'
import {
  DEFAULT_MODERATION_MODEL_ID,
  MODERATION_POLICY_VERSION,
  emptyModerationScores,
  evaluateModerationScores,
} from '@/lib/moderation/policy'
import {
  buildEventModerationDocument,
  buildProfileModerationDocument,
  buildSyndicationEntryModerationDocument,
  buildSyndicationFeedModerationDocument,
  getModerationDocumentCacheKey,
} from '@/lib/moderation/content'
import { useMuteList } from '@/hooks/useMuteList'
import {
  getPersistedModerationDecisions,
  savePersistedModerationDecisions,
} from '@/lib/db/caches'
import type { ModerationDecision, ModerationDocument, NostrEvent, Profile } from '@/types'
import type { SyndicationEntry, SyndicationFeed } from '@/lib/syndication/types'

// Bounded in-memory LRU cache — evict oldest when over the limit so the
// cache doesn't grow unbounded across a long session with thousands of events.
// The SQLite-backed `moderation_decisions` table is the durable layer; this
// Map is just the per-tab hot path so we never block on a worker round-trip
// for a decision we already returned this session.
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

function documentKindFor(document: ModerationDocument): string {
  return document.kind
}

/**
 * Persist freshly-resolved decisions to SQLite without blocking the UI.
 * Errors are swallowed: the in-memory cache still holds the decision for the
 * current session, so a transient SQLite issue degrades to in-memory only.
 */
function persistDecisionsAsync(
  inputs: Array<{ documentId: string; cacheKey: string; documentKind: string; decision: ModerationDecision }>,
): void {
  if (inputs.length === 0) return
  void savePersistedModerationDecisions(inputs).catch(() => { /* non-fatal */ })
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
  options: { enabled?: boolean; failClosed?: boolean; failOpenOnError?: boolean } = {},
): UseModerationDocumentsResult {
  const enabled = options.enabled ?? true
  const failClosed = options.failClosed ?? false
  const failOpenOnError = options.failOpenOnError ?? true
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

    // Synchronously apply all in-memory cache hits so consumers see decisions
    // immediately without a loading flash. We then opportunistically check the
    // SQLite-backed cache for the remaining docs *before* paying the much more
    // expensive ML / Tagr resolution cost.
    setDecisions(nextDecisions)
    setError(null)

    if (missing.length > 0) {
      const lookupPairs = missing.map((doc) => ({
        documentId: doc.id,
        cacheKey: getModerationDocumentCacheKey(doc),
      }))

      void getPersistedModerationDecisions(lookupPairs)
        .then((persisted) => {
          if (controller.signal.aborted || persisted.size === 0) return
          const stillMissing: ModerationDocument[] = []
          const merged = new Map(nextDecisions)
          for (const doc of missing) {
            const cacheKey = getModerationDocumentCacheKey(doc)
            const decision = persisted.get(`${doc.id}:${cacheKey}`)
            if (decision) {
              cacheSetModeration(cacheKey, decision)
              merged.set(doc.id, decision)
            } else {
              stillMissing.push(doc)
            }
          }
          setDecisions(merged)
          // If SQLite filled all the gaps, we can flip loading off early.
          if (stillMissing.length === 0) setLoading(false)
        })
        .catch(() => { /* non-fatal — fall through to ML path */ })
    }

    if (missing.length === 0) {
      setLoading(false)
      // Run Tagr in the background to pick up any relay-sourced blocks without
      // gating the feed on the result (avoids loading oscillation for cached batches).
      resolveTagrModerationDecisions(documents, controller.signal)
        .then((tagrDecisions) => {
          if (controller.signal.aborted || tagrDecisions.size === 0) return
          setDecisions((previous) => {
            const merged = new Map(previous)
            for (const [id, tagrDecision] of tagrDecisions) {
              const existing = merged.get(id)
              if (!existing || existing.action !== 'block') {
                merged.set(id, tagrDecision)
              }
            }
            return merged
          })
        })
        .catch(() => { /* non-blocking — ignore Tagr errors when all docs are cached */ })
      return () => controller.abort()
    }

    setLoading(true)

    Promise.all([
      moderateContentDocuments(missing, controller.signal),
      resolveTagrModerationDecisions(documents, controller.signal).catch(() => new Map<string, ModerationDecision>()),
    ])
      .then(([results, tagrDecisions]) => {
        if (controller.signal.aborted) return

        const merged = new Map(nextDecisions)
        const toPersist: Array<{
          documentId: string
          cacheKey: string
          documentKind: string
          decision: ModerationDecision
        }> = []

        for (const decision of results) {
          const document = missing.find((entry) => entry.id === decision.id)
          if (!document) continue

          const cacheKey = getModerationDocumentCacheKey(document)
          cacheSetModeration(cacheKey, decision)
          merged.set(decision.id, decision)
          toPersist.push({
            documentId: decision.id,
            cacheKey,
            documentKind: documentKindFor(document),
            decision,
          })
        }

        for (const document of missing) {
          if (merged.has(document.id)) continue

          const decision = evaluateModerationScores(
            document.id,
            emptyModerationScores(),
            `${DEFAULT_MODERATION_MODEL_ID}:fallback-allow`,
          )
          const fallbackDecision = {
            ...decision,
            policyVersion: `${MODERATION_POLICY_VERSION}+missing-result`,
          }
          const cacheKey = getModerationDocumentCacheKey(document)
          cacheSetModeration(cacheKey, fallbackDecision)
          merged.set(decision.id, fallbackDecision)
          // Don't persist fallbacks — they're cache holes, not real decisions.
        }

        for (const [id, tagrDecision] of tagrDecisions) {
          const existing = merged.get(id)
          if (!existing || existing.action !== 'block') {
            merged.set(id, tagrDecision)
          }
        }

        setDecisions(merged)
        setLoading(false)
        persistDecisionsAsync(toPersist)
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
  }, [enabled, signature])

  const allowedIds = useMemo(
    () => getAllowedIds(documents, decisions, (!failClosed && loading) || (error !== null && failOpenOnError)),
    [documents, decisions, loading, error, failClosed, failOpenOnError],
  )

  const blockedIds = useMemo(() => {
    const blocked = new Set<string>()
    const failOpen = (!failClosed && loading) || (error !== null && failOpenOnError)

    for (const document of documents) {
      const decision = decisions.get(document.id)
      if (!decision) {
        if (!failOpen) blocked.add(document.id)
        continue
      }

      if (decision.action === 'block') blocked.add(document.id)
    }

    return blocked
  }, [documents, decisions, loading, error, failClosed, failOpenOnError])

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

export function useSyndicationFeedModeration(feed: SyndicationFeed | null): {
  feedBlocked: boolean
  filteredItems: SyndicationEntry[]
  loading: boolean
} {
  const feedSourceUrl = feed?.feedUrl ?? feed?.sourceUrl

  const feedDoc = useMemo(
    () => (feed ? buildSyndicationFeedModerationDocument(feed) : null),
    [feed],
  )

  const itemDocs = useMemo(
    () => feed
      ? feed.items
          .map((item) => buildSyndicationEntryModerationDocument(item, feedSourceUrl))
          .filter((doc): doc is ModerationDocument => doc !== null)
      : [],
    [feed, feedSourceUrl],
  )

  const allDocs = useMemo(
    () => [...(feedDoc ? [feedDoc] : []), ...itemDocs],
    [feedDoc, itemDocs],
  )

  const { blockedIds, loading } = useModerationDocuments(allDocs)
  const { mutedWords, mutedHashtags } = useMuteList()

  const feedBlocked = feedDoc !== null && blockedIds.has(feedDoc.id)

  const filteredItems = useMemo(() => {
    if (!feed) return []
    return feed.items.filter((item, index) => {
      const doc = itemDocs[index]
      if (doc && blockedIds.has(doc.id)) return false

      if (mutedWords.size > 0) {
        const text = [item.title, item.summary, item.contentText]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        for (const word of mutedWords) {
          if (text.includes(word)) return false
        }
      }

      if (mutedHashtags.size > 0 && item.tags.some((t) => mutedHashtags.has(t))) return false

      return true
    })
  }, [feed, itemDocs, blockedIds, mutedWords, mutedHashtags])

  return { feedBlocked, filteredItems, loading }
}
