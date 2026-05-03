/**
 * useMuteList
 *
 * Loads the current user's NIP-51 mute list (kind 10000).
 *
 * Supported mute targets (per NIP-51 §10000):
 *   'p'    — pubkey (author)
 *   'word' — keyword that appears in note content
 *   't'    — hashtag (normalised, without #)
 *
 * Bug-fix: all three tag types are round-tripped faithfully when the list is
 * updated. Previous versions only preserved 'p' tags, silently dropping any
 * 'word' or 't' entries the user had set from another client.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
import { useApp } from '@/contexts/app-context'
import { getNDK } from '@/lib/nostr/ndk'
import { normalizeHashtag } from '@/lib/security/sanitize'
import { withRetry } from '@/lib/retry'
import { isValidHex32 } from '@/lib/security/sanitize'
import {
  getCachedMuteList as readCachedMuteListFromDB,
  saveCachedMuteList as writeCachedMuteListToDB,
} from '@/lib/db/caches'

const MUTE_LIST_KIND = 10000

// Legacy localStorage cache. Kept readable so users updating from a previous
// build still get an immediate paint from their old cache; new writes always
// go to SQLite via `mute_lists_cache`. The legacy entry is removed once the
// SQLite copy supersedes it.
const LEGACY_LOCAL_MUTE_CACHE_KEY_PREFIX = 'nostr-paper:mute-list:v2:'

// ── Cache helpers ─────────────────────────────────────────────

interface CachedMuteList {
  pubkeys: string[]
  words: string[]
  hashtags: string[]
}

function getLegacyMuteCacheKey(pubkey: string): string {
  return `${LEGACY_LOCAL_MUTE_CACHE_KEY_PREFIX}${pubkey}`
}

function loadLegacyCachedMuteList(pubkey: string): CachedMuteList | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(getLegacyMuteCacheKey(pubkey))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const obj = parsed as Record<string, unknown>
    const toStringArray = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    return {
      pubkeys:  toStringArray(obj['pubkeys']).filter(isValidHex32),
      words:    toStringArray(obj['words']),
      hashtags: toStringArray(obj['hashtags']),
    }
  } catch {
    return null
  }
}

function clearLegacyMuteCache(pubkey: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(getLegacyMuteCacheKey(pubkey))
  } catch {
    // Best-effort.
  }
}

async function loadCachedMuteList(pubkey: string): Promise<CachedMuteList> {
  const empty: CachedMuteList = { pubkeys: [], words: [], hashtags: [] }
  try {
    const persisted = await readCachedMuteListFromDB(pubkey)
    if (persisted) {
      return {
        pubkeys: persisted.pubkeys.filter(isValidHex32),
        words: persisted.words,
        hashtags: persisted.hashtags,
      }
    }
  } catch {
    // Fall through to legacy/empty.
  }
  // One-shot migration from the localStorage cache used by previous builds.
  const legacy = loadLegacyCachedMuteList(pubkey)
  if (legacy) {
    try {
      await writeCachedMuteListToDB(pubkey, {
        ...legacy,
        eventId: null,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      clearLegacyMuteCache(pubkey)
    } catch {
      // Non-fatal — we'll re-migrate next time.
    }
    return legacy
  }
  return empty
}

function saveCachedMuteList(
  pubkey: string,
  state: CachedMuteList,
  meta: { eventId: string | null; updatedAt: number },
): void {
  void writeCachedMuteListToDB(pubkey, {
    pubkeys: state.pubkeys,
    words: state.words,
    hashtags: state.hashtags,
    eventId: meta.eventId,
    updatedAt: meta.updatedAt,
  }).catch(() => { /* non-fatal */ })
}

// ── Tag extraction ────────────────────────────────────────────

function extractMuteListState(tags: string[][]): CachedMuteList {
  const pubkeys: string[]  = []
  const words: string[]    = []
  const hashtags: string[] = []

  for (const tag of tags) {
    const name  = tag[0]
    const value = tag[1]
    if (!name || !value) continue

    if (name === 'p' && isValidHex32(value)) {
      pubkeys.push(value)
    } else if (name === 'word') {
      const w = value.trim().toLowerCase()
      if (w) words.push(w)
    } else if (name === 't') {
      const h = normalizeHashtag(value)
      if (h) hashtags.push(h)
    }
  }

  return {
    pubkeys:  [...new Set(pubkeys)],
    words:    [...new Set(words)],
    hashtags: [...new Set(hashtags)],
  }
}

/** Tags from the kind 10000 event that this client doesn't manage (e.g. 'e' event mutes). */
function extractUnmanagedTags(tags: string[][]): string[][] {
  return tags.filter((tag) => {
    const name = tag[0]
    return name !== 'p' && name !== 'word' && name !== 't'
  })
}

function buildMuteListTags(state: CachedMuteList, unmanagedTags: string[][]): string[][] {
  return [
    ...state.pubkeys.map((p): string[]  => ['p', p]),
    ...state.words.map((w): string[]    => ['word', w]),
    ...state.hashtags.map((h): string[] => ['t', h]),
    ...unmanagedTags,
  ]
}

// ── Hook ─────────────────────────────────────────────────────

export interface UseMuteListResult {
  mutedPubkeys:  Set<string>
  mutedWords:    Set<string>
  mutedHashtags: Set<string>
  isMuted:       (pubkey: string) => boolean
  isWordMuted:   (word: string)   => boolean
  isHashtagMuted:(hashtag: string) => boolean
  mute:          (pubkey: string)  => Promise<void>
  unmute:        (pubkey: string)  => Promise<void>
  muteWord:      (word: string)    => Promise<void>
  unmuteWord:    (word: string)    => Promise<void>
  muteHashtag:   (hashtag: string) => Promise<void>
  unmuteHashtag: (hashtag: string) => Promise<void>
  loading: boolean
  error:   string | null
  refresh: () => Promise<void>
}

export function useMuteList(): UseMuteListResult {
  const { currentUser } = useApp()
  const [mutedPubkeys,  setMutedPubkeys]  = useState<Set<string>>(new Set())
  const [mutedWords,    setMutedWords]    = useState<Set<string>>(new Set())
  const [mutedHashtags, setMutedHashtags] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const applyState = useCallback((state: CachedMuteList) => {
    setMutedPubkeys(new Set(state.pubkeys))
    setMutedWords(new Set(state.words))
    setMutedHashtags(new Set(state.hashtags))
  }, [])

  // ── Fetch from relay ──────────────────────────────────────

  const fetchMuteList = useCallback(async () => {
    if (!currentUser?.pubkey) {
      applyState({ pubkeys: [], words: [], hashtags: [] })
      setLoading(false)
      return
    }

    const cached = await loadCachedMuteList(currentUser.pubkey)
    if (cached.pubkeys.length + cached.words.length + cached.hashtags.length > 0) {
      applyState(cached)
    }

    try {
      const ndk = getNDK()

      await withRetry(async () => {
        const event = await ndk.fetchEvent({
          kinds: [MUTE_LIST_KIND],
          authors: [currentUser.pubkey],
        })

        if (event) {
          const state = extractMuteListState(event.tags as string[][])
          applyState(state)
          saveCachedMuteList(currentUser.pubkey, state, {
            eventId: event.id ?? null,
            updatedAt: event.created_at ?? Math.floor(Date.now() / 1000),
          })
        } else {
          const empty = { pubkeys: [], words: [], hashtags: [] }
          applyState(empty)
          saveCachedMuteList(currentUser.pubkey, empty, {
            eventId: null,
            updatedAt: Math.floor(Date.now() / 1000),
          })
        }
      }, {
        maxAttempts: 3,
        baseDelayMs: 1000,
        shouldRetry: (err) => !(err instanceof DOMException && err.name === 'AbortError'),
      })

      setError(null)
    } catch (err) {
      console.warn('Failed to fetch mute list', err)
      setError(err instanceof Error ? err.message : 'Failed to load mute list')
    } finally {
      setLoading(false)
    }
  }, [currentUser?.pubkey, applyState])

  useEffect(() => {
    void fetchMuteList()
  }, [fetchMuteList])

  // ── Publish helpers ───────────────────────────────────────

  // Serializes concurrent withFreshUpdate calls. Two simultaneous mute
  // operations (e.g. mute word + mute hashtag triggered in quick succession)
  // would otherwise both read the same base state and have one overwrite the
  // other. Each call chains onto this ref so updates are always sequential.
  const updateQueueRef = useRef<Promise<void>>(Promise.resolve())

  /**
   * Fetch the most recent kind 10000 event from relays, apply `transform` to
   * the extracted state, then publish the result. Preserves unmanaged tags
   * (e.g. 'e' event mutes set by other clients).
   *
   * Calls are automatically serialized — if two updates are dispatched before
   * the first completes, the second waits and reads the state written by the
   * first, preventing a read-modify-write race.
   */
  const withFreshUpdate = useCallback(
    (transform: (current: CachedMuteList) => CachedMuteList): Promise<void> => {
      const queued = updateQueueRef.current.then(async () => {
        if (!currentUser?.pubkey) throw new Error('Not signed in')

        const ndk   = getNDK()
        let current: CachedMuteList = {
          pubkeys:  [...mutedPubkeys],
          words:    [...mutedWords],
          hashtags: [...mutedHashtags],
        }
        let unmanagedTags: string[][] = []

        try {
          const event = await ndk.fetchEvent({
            kinds: [MUTE_LIST_KIND],
            authors: [currentUser.pubkey],
          })
          if (event) {
            current       = extractMuteListState(event.tags as string[][])
            unmanagedTags = extractUnmanagedTags(event.tags as string[][])
          }
        } catch (err) {
          console.warn('Failed to fetch fresh mute list before update, using cached state', err)
        }

        const next = transform(current)
        const ndkEvent = new NDKEvent(ndk)
        ndkEvent.kind   = MUTE_LIST_KIND
        ndkEvent.author = new NDKUser({ pubkey: currentUser.pubkey })
        ndkEvent.tags   = buildMuteListTags(next, unmanagedTags)

        await withRetry(() => ndkEvent.publish(), { maxAttempts: 3, baseDelayMs: 1000 })
        applyState(next)
        saveCachedMuteList(currentUser.pubkey, next, {
          eventId: ndkEvent.id ?? null,
          updatedAt: ndkEvent.created_at ?? Math.floor(Date.now() / 1000),
        })
      })

      // Keep errors from blocking the queue for subsequent callers.
      updateQueueRef.current = queued.catch(() => {})
      return queued
    },
    [currentUser?.pubkey, mutedPubkeys, mutedWords, mutedHashtags, applyState],
  )

  // ── Pubkey mutes ──────────────────────────────────────────

  const isMuted = useCallback(
    (pubkey: string) => mutedPubkeys.has(pubkey),
    [mutedPubkeys],
  )

  const mute = useCallback(
    async (pubkey: string) => {
      if (!isValidHex32(pubkey)) throw new Error('Invalid pubkey')
      await withFreshUpdate((current) => ({
        ...current,
        pubkeys: [...new Set([...current.pubkeys, pubkey])],
      }))
    },
    [withFreshUpdate],
  )

  const unmute = useCallback(
    async (pubkey: string) => {
      await withFreshUpdate((current) => ({
        ...current,
        pubkeys: current.pubkeys.filter((p) => p !== pubkey),
      }))
    },
    [withFreshUpdate],
  )

  // ── Word mutes ────────────────────────────────────────────

  const isWordMuted = useCallback(
    (word: string) => mutedWords.has(word.trim().toLowerCase()),
    [mutedWords],
  )

  const muteWord = useCallback(
    async (word: string) => {
      const normalised = word.trim().toLowerCase()
      if (!normalised) throw new Error('Invalid word')
      await withFreshUpdate((current) => ({
        ...current,
        words: [...new Set([...current.words, normalised])],
      }))
    },
    [withFreshUpdate],
  )

  const unmuteWord = useCallback(
    async (word: string) => {
      const normalised = word.trim().toLowerCase()
      await withFreshUpdate((current) => ({
        ...current,
        words: current.words.filter((w) => w !== normalised),
      }))
    },
    [withFreshUpdate],
  )

  // ── Hashtag mutes ─────────────────────────────────────────

  const isHashtagMuted = useCallback(
    (hashtag: string) => {
      const normalised = normalizeHashtag(hashtag)
      return normalised !== null && mutedHashtags.has(normalised)
    },
    [mutedHashtags],
  )

  const muteHashtag = useCallback(
    async (hashtag: string) => {
      const normalised = normalizeHashtag(hashtag)
      if (!normalised) throw new Error('Invalid hashtag')
      await withFreshUpdate((current) => ({
        ...current,
        hashtags: [...new Set([...current.hashtags, normalised])],
      }))
    },
    [withFreshUpdate],
  )

  const unmuteHashtag = useCallback(
    async (hashtag: string) => {
      const normalised = normalizeHashtag(hashtag)
      if (!normalised) throw new Error('Invalid hashtag')
      await withFreshUpdate((current) => ({
        ...current,
        hashtags: current.hashtags.filter((h) => h !== normalised),
      }))
    },
    [withFreshUpdate],
  )

  return {
    mutedPubkeys,
    mutedWords,
    mutedHashtags,
    isMuted,
    isWordMuted,
    isHashtagMuted,
    mute,
    unmute,
    muteWord,
    unmuteWord,
    muteHashtag,
    unmuteHashtag,
    loading,
    error,
    refresh: fetchMuteList,
  }
}
