/**
 * useKeywordFilters
 *
 * Central React interface for the keyword filter system.
 *
 * Exports three hooks:
 *
 *   useKeywordFilters()
 *     Full CRUD — used by FiltersPage to list / add / edit / delete rules.
 *
 *   useEventFilterCheck()
 *     Returns a stable check(event, profile?) function that synchronously
 *     evaluates text-based filter rules.  Re-memoises whenever the stored
 *     filters change so every component that calls it stays in sync.
 *
 *   useSemanticFiltering(events)
 *     Async Tier-2 semantic layer.  Feeds events through the existing
 *     all-MiniLM-L6-v2 sentence-embedding worker (already used for search)
 *     and returns a Map<eventId, FilterCheckResult> for semantic matches.
 *     Results are cached inside the worker's own idb-keyval store so each
 *     event embedding is computed only once per session.
 *
 * State sharing: a module-level singleton keeps the filter array in sync
 * across all hook instances without a Context provider, following the same
 * pattern used by the moderation in-memory cache.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { NostrEvent, Profile } from '@/types'
import {
  loadFilters,
  createFilter,
  updateFilter,
  deleteFilter,
  FILTERS_UPDATED_EVENT,
} from '@/lib/filters/storage'
import { extractEventFields, extractProfileFields, buildSemanticText } from '@/lib/filters/extract'
import { checkEventText, checkProfileText, mergeResults } from '@/lib/filters/matcher'
import {
  getSemanticFilterSettings,
  SEMANTIC_FILTER_SETTINGS_UPDATED_EVENT,
} from '@/lib/filters/semanticSettings'
import { getEffectiveKeywordFilters } from '@/lib/filters/systemFilters'
import { STORAGE_KEY_PUBKEY } from '@/lib/nostr/ndk'
import { rankSemanticDocuments } from '@/lib/semantic/client'
import type { CreateFilterInput, FilterCheckResult, KeywordFilter } from '@/lib/filters/types'

// ── Shared singleton ──────────────────────────────────────────────────────────

let _filters: KeywordFilter[] = []
let _loading = true
const _listeners = new Set<() => void>()

async function _refresh(): Promise<void> {
  let loaded: unknown = []
  try {
    loaded = await Promise.resolve(loadFilters())
  } catch {
    loaded = []
  }
  _filters = Array.isArray(loaded) ? loaded : []
  _loading  = false
  _listeners.forEach(fn => fn())
}

// Kick off the initial load immediately
void _refresh()

function _subscribe(fn: () => void): () => void {
  _listeners.add(fn)
  fn()
  const onExternal = () => { void _refresh() }
  window.addEventListener(FILTERS_UPDATED_EVENT, onExternal)
  return () => {
    _listeners.delete(fn)
    window.removeEventListener(FILTERS_UPDATED_EVENT, onExternal)
  }
}

// ── useKeywordFilters ─────────────────────────────────────────────────────────

export function useKeywordFilters() {
  const [, tick] = useState(0)

  useEffect(() => _subscribe(() => tick(t => t + 1)), [])

  const add = useCallback(async (input: CreateFilterInput): Promise<KeywordFilter> => {
    const f = await createFilter(input)
    await _refresh()
    return f
  }, [])

  const update = useCallback(async (
    id:    string,
    patch: Partial<Omit<KeywordFilter, 'id' | 'createdAt'>>,
  ): Promise<void> => {
    await updateFilter(id, patch)
    await _refresh()
  }, [])

  const remove = useCallback(async (id: string): Promise<void> => {
    await deleteFilter(id)
    await _refresh()
  }, [])

  const toggle = useCallback(async (id: string): Promise<void> => {
    const f = _filters.find(x => x.id === id)
    if (!f) return
    await updateFilter(id, { enabled: !f.enabled })
    await _refresh()
  }, [])

  return {
    filters: _filters,
    loading: _loading,
    add,
    update,
    remove,
    toggle,
  }
}

// ── useEventFilterCheck ───────────────────────────────────────────────────────

/**
 * Returns a memoised function that synchronously checks a NostrEvent (plus
 * optional author profile) against the currently active text-based filter
 * rules.  The function reference is stable as long as the stored filters
 * don't change, so callers can safely include it in useMemo / useEffect deps.
 */
export function useEventFilterCheck() {
  // Re-render whenever filters update so the returned fn re-memoises
  const [, tick] = useState(0)
  useEffect(() => _subscribe(() => tick(t => t + 1)), [])

  // Capture a stable snapshot of the current filter array for the closure

  return useCallback(
    (event: NostrEvent, profile?: Profile): FilterCheckResult => {
      const effectiveFilters = getEffectiveKeywordFilters(_filters)
      if (_loading || effectiveFilters.length === 0) return { action: null, matches: [] }
      const fields = extractEventFields(event, profile)
      return checkEventText(fields, effectiveFilters)
    },
    // Intentionally depend on _filters reference — tick() forces a new one
    [_filters, _loading],
  )
}

/**
 * Returns a memoised function that synchronously checks a profile against the
 * currently active text-based filter rules.
 */
export function useProfileFilterCheck() {
  const [, tick] = useState(0)
  useEffect(() => _subscribe(() => tick(t => t + 1)), [])

  return useCallback(
    (profile: Profile): FilterCheckResult => {
      const effectiveFilters = getEffectiveKeywordFilters(_filters)
      if (_loading || effectiveFilters.length === 0) return { action: null, matches: [] }
      const fields = extractProfileFields(profile)
      return checkProfileText(fields, effectiveFilters)
    },
    // Intentionally depend on _filters reference — tick() forces a new one
    [_filters, _loading],
  )
}

// ── useSemanticFiltering ──────────────────────────────────────────────────────

/**
 * Cosine-similarity threshold for a semantic match.  0.42 is empirically
 * chosen: low enough to catch strong synonyms ("assault" for "violence",
 * "elections" for "politics") while avoiding false positives.
 */
const DEFAULT_SEMANTIC_THRESHOLD = 0.42

function getSemanticScopeId(): string {
  if (typeof window === 'undefined') return 'anon'
  const pubkey = window.localStorage.getItem(STORAGE_KEY_PUBKEY)
  return pubkey && pubkey.trim().length > 0 ? pubkey.trim() : 'anon'
}

/**
 * Async Tier-2 semantic filter layer.
 *
 * For every filter with `semantic: true` this hook sends the event texts
 * through the existing sentence-embedding worker and records matches where
 * cosine similarity ≥ SEMANTIC_THRESHOLD.  The worker caches embeddings
 * in idb-keyval so each event vector is computed only once.
 *
 * Returns a Map<eventId, FilterCheckResult>.  Events with no semantic match
 * are absent from the map (not { action: null }).  Merge with the text
 * result using mergeResults() before rendering.
 */
export function useSemanticFiltering(events: NostrEvent[]): Map<string, FilterCheckResult> {
  const scopeId = getSemanticScopeId()
  const [results, setResults] = useState<Map<string, FilterCheckResult>>(new Map())
  const [settingsVersion, setSettingsVersion] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const [, tick] = useState(0)

  useEffect(() => _subscribe(() => tick(t => t + 1)), [])

  // Only the filters that have semantic: true and are currently active
  const semanticFilters = useMemo(() => {
    const now = Date.now()
    return getEffectiveKeywordFilters(_filters).filter(
      f => f.enabled && f.semantic && (f.expiresAt === null || f.expiresAt > now),
    )
  }, [_filters])

  useEffect(() => {
    const onSemanticSettingsUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ scopeId?: string }>
      if (customEvent.detail?.scopeId !== scopeId) return
      setSettingsVersion((value) => value + 1)
    }

    const onStorage = (event: StorageEvent) => {
      if (!event.key) return
      if (!event.key.endsWith(`:${scopeId}`)) return
      setSettingsVersion((value) => value + 1)
    }

    window.addEventListener(SEMANTIC_FILTER_SETTINGS_UPDATED_EVENT, onSemanticSettingsUpdated as EventListener)
    window.addEventListener('storage', onStorage)

    return () => {
      window.removeEventListener(SEMANTIC_FILTER_SETTINGS_UPDATED_EVENT, onSemanticSettingsUpdated as EventListener)
      window.removeEventListener('storage', onStorage)
    }
  }, [scopeId])

  useEffect(() => {
    if (semanticFilters.length === 0 || events.length === 0) {
      setResults(new Map())
      return
    }

    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller

    void (async () => {
      // Build SemanticDocument array once for all filters
      const docs = events
        .map(ev => ({
          id:        ev.id,
          kind:      'event' as const,
          text:      buildSemanticText(ev),
          updatedAt: ev.created_at,
        }))
        .filter(d => d.text.trim().length > 0)

      if (docs.length === 0) {
        if (!controller.signal.aborted) setResults(new Map())
        return
      }

      const next = new Map<string, FilterCheckResult>()
      const semanticThreshold = getSemanticFilterSettings(scopeId).threshold || DEFAULT_SEMANTIC_THRESHOLD

      for (const filter of semanticFilters) {
        if (controller.signal.aborted) break

        try {
          const matches = await rankSemanticDocuments(
            filter.term,
            docs,
            docs.length,
            controller.signal,
          )

          for (const match of matches) {
            if (match.score < semanticThreshold) continue
            if (controller.signal.aborted) break

            const prev = next.get(match.id) ?? { action: null as FilterCheckResult['action'], matches: [] }
            const semanticMatch = {
              filterId:  filter.id,
              term:      filter.term,
              action:    filter.action,
              field:     'content' as const,
              excerpt:   '',
              semantic:  true,
            }
            const allMatches = [...prev.matches, semanticMatch]
            next.set(match.id, {
              action: allMatches.some(m => m.action === 'block')
                ? 'block'
                : allMatches.some(m => m.action === 'hide')
                  ? 'hide'
                  : 'warn',
              matches: allMatches,
            })
          }
        } catch {
          // Semantic model unavailable or aborted — fail open silently
        }
      }

      if (!controller.signal.aborted) setResults(next)
    })()

    return () => controller.abort()
  }, [events, scopeId, semanticFilters, settingsVersion])

  return results
}

// ── Utility re-exports ────────────────────────────────────────────────────────

export { mergeResults } from '@/lib/filters/matcher'
export type { FilterCheckResult, KeywordFilter, CreateFilterInput } from '@/lib/filters/types'
