/**
 * useEventCombinedModeration
 *
 * Unified moderation API for a single event.  Combines all four active
 * moderation subsystems into one hook so page components don't have to wire
 * them together manually:
 *
 *   1. ML + Tagr  — text classification via ONNX worker + community reports
 *   2. Keyword    — synchronous text-based filter rules stored in IndexedDB
 *   3. Semantic   — async cosine-similarity filter via sentence-embedding worker
 *   4. Mute list  — NIP-51 kind 10000 author / word / hashtag mutes
 *
 * Media moderation (images) is not included here because it requires per-URL
 * resolution and is handled at render time by useMediaModeration.
 */

import { useMemo } from 'react'
import { mergeResults, useEventFilterCheck, useSemanticFiltering } from '@/hooks/useKeywordFilters'
import { useEventModeration } from '@/hooks/useModeration'
import { useMuteList } from '@/hooks/useMuteList'
import type { ModerationDecision } from '@/types'
import type { FilterCheckResult } from '@/lib/filters/types'
import type { NostrEvent, Profile } from '@/types'

export interface EventCombinedModerationResult {
  /** ML model + Tagr community verdict */
  mlBlocked:     boolean
  mlLoading:     boolean
  mlDecision:    ModerationDecision | null
  mlError:       string | null

  /** Merged keyword + semantic filter result */
  keywordResult: FilterCheckResult

  /** Whether the author is on the local NIP-51 mute list */
  isMutedAuthor:    boolean
  muteListLoading:  boolean

  /**
   * Aggregate blocked flag: true when mlBlocked OR isMutedAuthor.
   * Does NOT fold in keywordResult — keyword gating (warn vs hide) is
   * rendered separately so the page can show a collapsible warning.
   */
  blocked: boolean

  /**
   * True while any async subsystem is still loading its initial data.
   * Safe to use as a gate before rendering the page's <head> meta tags.
   */
  loading: boolean
}

/**
 * @param event   The event to assess. Pass null/undefined while loading.
 * @param profile Optional author profile — improves keyword-filter accuracy
 *                by checking profile fields (display name, bio, NIP-05).
 */
export function useEventCombinedModeration(
  event: NostrEvent | null | undefined,
  profile?: Profile | null,
): EventCombinedModerationResult {
  // ── Subsystem 1 + 2: ML worker + Tagr ─────────────────────────────────────
  const {
    blocked:  mlBlocked,
    loading:  mlLoading,
    decision: mlDecision,
    error:    mlError,
  } = useEventModeration(event)

  // ── Subsystem 3: synchronous keyword filter rules ──────────────────────────
  const checkEvent = useEventFilterCheck()

  // ── Subsystem 4: async semantic embedding filter ───────────────────────────
  const semanticResults = useSemanticFiltering(event ? [event] : [])

  // Merge synchronous + semantic results
  const keywordResult = useMemo<FilterCheckResult>(() => {
    if (!event) return { action: null, matches: [] }
    return mergeResults(
      checkEvent(event, profile ?? undefined),
      semanticResults.get(event.id) ?? { action: null, matches: [] },
    )
  }, [event, profile, checkEvent, semanticResults])

  // ── Subsystem 5: NIP-51 mute list ─────────────────────────────────────────
  const { isMuted, loading: muteListLoading } = useMuteList()
  const isMutedAuthor = event ? isMuted(event.pubkey) : false

  // ── Aggregate ──────────────────────────────────────────────────────────────
  const blocked = mlBlocked || isMutedAuthor
  const loading = mlLoading || muteListLoading

  return {
    mlBlocked,
    mlLoading,
    mlDecision,
    mlError,
    keywordResult,
    isMutedAuthor,
    muteListLoading,
    blocked,
    loading,
  }
}
