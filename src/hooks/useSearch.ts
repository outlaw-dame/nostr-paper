/**
 * useSearch — NIP-50 full-text search hook
 *
 * Local-first strategy:
 *   1. User types → 300 ms debounce → local SQLite FTS5 query fires immediately
 *   2. Simultaneously, the same query is forwarded to connected relays (NIP-50)
 *   3. Relay results are merged into the result set as they arrive and are
 *      deduplicated by event ID
 *   4. Each new input value aborts the previous relay fetch
 *
 * Result ordering:
 *   - Local results: BM25 relevance rank, then recency (from queryEventsFts)
 *   - Merged results: local list first, relay-only additions appended and
 *     sorted by created_at DESC (relay rank is unknown after the merge)
 *
 * Profile search:
 *   - Runs in parallel with event search against profiles_fts (migration v3)
 *   - Exposed as `profiles` alongside `events`
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react'
import { parseNip05Identifier, resolveNip05Profile } from '@/lib/nostr/nip05'
import { parseSearchQuery, searchRelays } from '@/lib/nostr/search'
import { hybridSearchEvents, hybridSearchProfiles } from '@/lib/search/hybrid'
import type { NostrEvent, Profile }     from '@/types'

// ── Public Interface ──────────────────────────────────────────

export interface SearchState {
  /** The raw value of the search input (unthrottled) */
  input:          string
  /** The debounced query actually being searched */
  query:          string
  /** Merged, deduplicated events (local + relay) */
  events:         NostrEvent[]
  /** Profile matches (local FTS only) */
  profiles:       Profile[]
  /** True while the local SQLite query is running */
  localLoading:   boolean
  /** True while waiting for relay responses */
  relayLoading:   boolean
  /** Non-fatal error message (relay errors only; local errors throw) */
  relayError:     string | null
  /** Non-fatal error from the semantic reranker */
  semanticError:  string | null
}

export interface SearchOptions {
  /** Event kinds to restrict the search to (default: all indexed kinds) */
  kinds?:       number[]
  /** Debounce delay in ms (default: 300) */
  debounceMs?:  number
  /** Maximum local results (default: 50) */
  localLimit?:  number
  /** Maximum relay results (default: 50) */
  relayLimit?:  number
  /** Disable relay forwarding (local-only mode) */
  localOnly?:   boolean
}

// ── Hook ─────────────────────────────────────────────────────

export function useSearch(opts: SearchOptions = {}): SearchState & {
  setInput:   (value: string) => void
  commitNow:  () => void
  clear:      () => void
} {
  const {
    kinds,
    debounceMs  = 300,
    localLimit  = 50,
    relayLimit  = 50,
    localOnly   = false,
  } = opts

  const [input,        setInput]        = useState('')
  const [query,        setQuery]        = useState('')
  const [localEvents,  setLocalEvents]  = useState<NostrEvent[]>([])
  const [relayEvents,  setRelayEvents]  = useState<NostrEvent[]>([])
  const [profiles,     setProfiles]     = useState<Profile[]>([])
  const [localLoading, setLocalLoading] = useState(false)
  const [relayLoading, setRelayLoading] = useState(false)
  const [relayError,   setRelayError]   = useState<string | null>(null)
  const [semanticError, setSemanticError] = useState<string | null>(null)

  // AbortController ref — cancelled when query changes or component unmounts
  const abortRef = useRef<AbortController | null>(null)

  // ── Debounce raw input → committed query ──────────────────
  useEffect(() => {
    const trimmed = input.trim()
    if (trimmed === query) return  // already committed

    const timer = setTimeout(() => setQuery(trimmed), debounceMs)
    return () => clearTimeout(timer)
  }, [input, query, debounceMs])

  // ── Execute search when committed query changes ───────────
  useEffect(() => {
    // Cancel any in-flight relay fetch from the previous query
    abortRef.current?.abort()
    setRelayEvents([])
    setRelayError(null)
    setSemanticError(null)

    if (!query) {
      setLocalEvents([])
      setRelayEvents([])
      setProfiles([])
      setLocalLoading(false)
      setRelayLoading(false)
      setRelayError(null)
      setSemanticError(null)
      return
    }

    const ctrl   = new AbortController()
    abortRef.current = ctrl
    const parsedQuery = parseSearchQuery(query)
    const exactNip05Query = parseNip05Identifier(query) ? query : null
    let nip05ProfilePromise: Promise<Profile | null> | null = null

    const runHybridRerank = async (relaySnapshot: NostrEvent[] = []) => {
      try {
        const [rerankedEventResult, rerankedProfileResult] = await Promise.all([
          hybridSearchEvents(query, localSearchOptions),
          hybridSearchProfiles(query, profileLimit, ctrl.signal),
        ])
        if (ctrl.signal.aborted) return

        let nextProfiles = rerankedProfileResult.items
        if (nextProfiles.length === 0) {
          const resolvedProfile = await resolveExactNip05Profile()
          if (resolvedProfile && !ctrl.signal.aborted) {
            nextProfiles = [resolvedProfile]
          }
        }
        if (ctrl.signal.aborted) return

        setLocalEvents(rerankedEventResult.items)
        setProfiles(nextProfiles)
        setSemanticError(rerankedEventResult.semanticError ?? rerankedProfileResult.semanticError)

        // Remove anything now covered by local reranked results.
        const seen = new Set(rerankedEventResult.items.map(event => event.id))
        setRelayEvents(currentRelayEvents => {
          const source = relaySnapshot.length > 0 ? relaySnapshot : currentRelayEvents
          return source.filter(event => !seen.has(event.id))
        })
      } catch (error) {
        if (ctrl.signal.aborted) return
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.warn('[useSearch] Hybrid rerank degraded:', error)
        }
      }
    }

    const resolveExactNip05Profile = () => {
      if (!exactNip05Query) return Promise.resolve<Profile | null>(null)
      if (!nip05ProfilePromise) {
        nip05ProfilePromise = resolveNip05Profile(exactNip05Query, ctrl.signal).catch(() => null)
      }
      return nip05ProfilePromise
    }

    // ── Local SQLite search (lexical-only for fast initial display) ───
    setLocalLoading(true)

    const localSearchOptions = {
      ...(kinds !== undefined ? { kinds } : {}),
      limit: localLimit,
      signal: ctrl.signal,
    }
    const profileLimit = Math.min(Math.max(Math.floor(localLimit / 2), 20), 60)

    Promise.all([
      hybridSearchEvents(query, { ...localSearchOptions, lexicalOnly: true }),
      hybridSearchProfiles(query, profileLimit, ctrl.signal, true),
    ]).then(async ([eventResult, profileResult]) => {
      let nextProfiles = profileResult.items
      if (!ctrl.signal.aborted && nextProfiles.length === 0) {
        const resolvedProfile = await resolveExactNip05Profile()
        if (resolvedProfile) nextProfiles = [resolvedProfile]
      }

      if (ctrl.signal.aborted) return
      setLocalEvents(eventResult.items)
      setProfiles(nextProfiles)
      setLocalLoading(false)

      // Semantic reranking should run regardless of relay availability.
      void runHybridRerank()
    }).catch((err: unknown) => {
      if (ctrl.signal.aborted) return
      console.error('[useSearch] Local search error:', err)
      setLocalLoading(false)
    })

    // ── Relay search (background, NIP-50) ─────────────────
    if (!localOnly && parsedQuery.relayQuery) {
      setRelayLoading(true)

      const relaySearchOptions = {
        ...(kinds !== undefined ? { kinds } : {}),
        limit:  relayLimit,
        signal: ctrl.signal,
      }

      searchRelays(query, relaySearchOptions).then(async (events) => {
        if (ctrl.signal.aborted) return

        // Show relay results immediately — don't block on semantic re-ranking
        setRelayEvents(events)
        setRelayLoading(false)

        // Run a second rerank pass after relay results arrive.
        void runHybridRerank(events)
      }).catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        setRelayError(msg)
        setRelayLoading(false)
      })
    } else {
      setRelayLoading(false)
    }

    return () => ctrl.abort()
  }, [query, kinds, localLimit, relayLimit, localOnly])

  // Abort on unmount
  useEffect(() => () => { abortRef.current?.abort() }, [])

  // ── Merge + deduplicate ───────────────────────────────────
  // Local results come first (ordered by FTS rank from the DB).
  // Relay-only results (not in the local set) are appended and sorted
  // by recency so they integrate smoothly into the list.
  const events = useMemo<NostrEvent[]>(() => {
    if (relayEvents.length === 0) return localEvents

    const seen = new Set(localEvents.map(e => e.id))
    const relayOnly = relayEvents
      .filter(e => !seen.has(e.id))
      .sort((a, b) => b.created_at - a.created_at)

    return [...localEvents, ...relayOnly]
  }, [localEvents, relayEvents])

  // Bypass the debounce and commit the current input immediately.
  // Called when the user presses Enter so results start without waiting.
  const commitNow = useCallback(() => {
    const trimmed = input.trim()
    if (trimmed) setQuery(trimmed)
  }, [input])

  const clear = useCallback(() => {
    setInput('')
    setQuery('')
  }, [])

  return {
    input, setInput,
    query,
    events, profiles,
    localLoading, relayLoading,
    relayError,
    semanticError,
    commitNow,
    clear,
  }
}
