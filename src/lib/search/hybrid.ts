import {
  listSemanticEventCandidates,
  listSemanticProfileCandidates,
  searchEvents,
  searchProfiles,
  type SearchEventsOptions,
} from '@/lib/db/nostr'
import { rankSemanticDocuments } from '@/lib/semantic/client'
import {
  eventToSemanticText,
  normalizeSemanticQuery,
  profileToSemanticText,
} from '@/lib/semantic/text'
import { parseSearchQuery } from '@/lib/nostr/search'
import type {
  NostrEvent,
  Profile,
  SemanticDocument,
  SemanticMatch,
} from '@/types'

const HYBRID_LEXICAL_WEIGHT = 0.6
const HYBRID_SEMANTIC_WEIGHT = 0.4
const MIN_SEMANTIC_QUERY_CHARS = 3
const DEFAULT_EVENT_CANDIDATE_LIMIT = 180
const DEFAULT_PROFILE_CANDIDATE_LIMIT = 80

// When lexical search returns at least this many results, skip adding
// unrelated recent events as semantic candidates — just rerank what we have.
// This prevents semantically-weak events from polluting high-recall queries.
const SEMANTIC_EXPANSION_THRESHOLD = 15

// Semantic-only items (zero lexical score) must clear this normalized score
// to appear in results. Prevents low-similarity noise from the candidate pool.
const MIN_SEMANTIC_ONLY_SCORE = 0.45

type Timestamped = {
  created_at?: number
  updatedAt?: number
}

export interface HybridSearchResponse<T> {
  items: T[]
  semanticUsed: boolean
  semanticError: string | null
}

export interface RankedHybridMatch<T> {
  item: T
  lexicalScore: number
  semanticScore: number
  hybridScore: number
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const deduped: T[] = []

  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    deduped.push(item)
  }

  return deduped
}

function getTimestamp(item: Timestamped): number {
  return item.created_at ?? item.updatedAt ?? 0
}

function lexicalRankScore(index: number, total: number): number {
  if (total <= 0) return 0
  return (total - index) / total
}

function normalizeSemanticScores(matches: SemanticMatch[]): Map<string, number> {
  const positiveMatches = matches.filter(match => match.score > 0)
  const max = Math.max(...positiveMatches.map(match => match.score), 0)
  const normalized = new Map<string, number>()

  if (max <= 0) return normalized

  for (const match of positiveMatches) {
    normalized.set(match.id, match.score / max)
  }

  return normalized
}

export function mergeHybridRankings<T extends { id: string } & Timestamped>(
  lexicalItems: T[],
  semanticItems: T[],
  semanticMatches: SemanticMatch[],
  limit: number,
): RankedHybridMatch<T>[] {
  const lexicalScores = new Map<string, number>()
  lexicalItems.forEach((item, index) => {
    lexicalScores.set(item.id, lexicalRankScore(index, lexicalItems.length))
  })

  const semanticScores = normalizeSemanticScores(semanticMatches)
  const itemsById = new Map<string, T>()

  for (const item of [...lexicalItems, ...semanticItems]) {
    itemsById.set(item.id, item)
  }

  const ranked: RankedHybridMatch<T>[] = []

  for (const [id, item] of itemsById) {
    const lexicalScore = lexicalScores.get(id) ?? 0
    const semanticScore = semanticScores.get(id) ?? 0
    const hybridScore = lexicalScore * HYBRID_LEXICAL_WEIGHT + semanticScore * HYBRID_SEMANTIC_WEIGHT

    if (hybridScore <= 0) continue
    // Suppress semantic-only matches that aren't meaningfully similar to the query
    if (lexicalScore === 0 && semanticScore < MIN_SEMANTIC_ONLY_SCORE) continue

    ranked.push({
      item,
      lexicalScore,
      semanticScore,
      hybridScore,
    })
  }

  return ranked
    .sort((a, b) => {
      if (b.hybridScore !== a.hybridScore) return b.hybridScore - a.hybridScore
      return getTimestamp(b.item) - getTimestamp(a.item)
    })
    .slice(0, Math.max(1, limit))
}

function getSemanticQuery(query: string): string | null {
  const parsed = parseSearchQuery(query)
  const semanticQuery = normalizeSemanticQuery(parsed.localQuery ?? '')
  return semanticQuery
}

function shouldUseSemanticSearch(query: string): boolean {
  const semanticQuery = getSemanticQuery(query)
  return semanticQuery !== null && semanticQuery.length >= MIN_SEMANTIC_QUERY_CHARS
}

function eventToSemanticDocument(event: NostrEvent): SemanticDocument | null {
  const text = eventToSemanticText(event)
  if (!text) return null

  return {
    id: event.id,
    kind: 'event',
    text,
    updatedAt: event.created_at,
  }
}

function profileToSemanticDocument(profile: Profile): SemanticDocument | null {
  const text = profileToSemanticText(profile)
  if (!text) return null

  return {
    id: profile.pubkey,
    kind: 'profile',
    text,
    updatedAt: profile.updatedAt,
  }
}

export async function hybridSearchEvents(
  query: string,
  opts: SearchEventsOptions & { signal?: AbortSignal; lexicalOnly?: boolean } = {},
): Promise<HybridSearchResponse<NostrEvent>> {
  const { signal, lexicalOnly, ...searchOptions } = opts
  const limit = Math.min(opts.limit ?? 50, 200)
  const lexicalLimit = Math.min(Math.max(limit * 2, limit), 240)
  const lexicalItems = await searchEvents(query, {
    ...searchOptions,
    limit: lexicalLimit,
  })
  throwIfAborted(signal)

  if (lexicalOnly || !shouldUseSemanticSearch(query)) {
    return {
      items: lexicalItems.slice(0, limit),
      semanticUsed: false,
      semanticError: null,
    }
  }

  const semanticQuery = getSemanticQuery(query)
  if (!semanticQuery) {
    return {
      items: lexicalItems.slice(0, limit),
      semanticUsed: false,
      semanticError: null,
    }
  }

  try {
    // Only pull unrelated recent events as semantic candidates when lexical
    // results are sparse. With enough lexical hits we just rerank what we have,
    // which is both faster and avoids flooding results with off-topic content.
    const semanticCandidates = lexicalItems.length < SEMANTIC_EXPANSION_THRESHOLD
      ? await listSemanticEventCandidates(query, {
          ...searchOptions,
          limit: DEFAULT_EVENT_CANDIDATE_LIMIT,
        })
      : []
    throwIfAborted(signal)
    const mergedCandidates = dedupeById([...lexicalItems, ...semanticCandidates])
    const semanticDocuments = mergedCandidates
      .map(eventToSemanticDocument)
      .filter((document): document is SemanticDocument => document !== null)

    if (semanticDocuments.length === 0) {
      return {
        items: lexicalItems.slice(0, limit),
        semanticUsed: false,
        semanticError: null,
      }
    }

    const semanticMatches = await rankSemanticDocuments(
      semanticQuery,
      semanticDocuments,
      Math.max(limit * 3, 60),
      signal,
    )
    throwIfAborted(signal)

    const ranked = mergeHybridRankings(lexicalItems, mergedCandidates, semanticMatches, limit)
    return {
      items: ranked.map(match => match.item),
      semanticUsed: true,
      semanticError: null,
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }

    return {
      items: lexicalItems.slice(0, limit),
      semanticUsed: false,
      semanticError: error instanceof Error ? error.message : 'Semantic search unavailable',
    }
  }
}

export async function hybridSearchProfiles(
  query: string,
  limit = 20,
  signal?: AbortSignal,
  lexicalOnly = false,
): Promise<HybridSearchResponse<Profile>> {
  const cappedLimit = Math.min(limit, 100)
  const lexicalLimit = Math.min(Math.max(cappedLimit * 2, cappedLimit), 120)
  const lexicalItems = await searchProfiles(query, lexicalLimit)
  throwIfAborted(signal)

  if (lexicalOnly || !shouldUseSemanticSearch(query)) {
    return {
      items: lexicalItems.slice(0, cappedLimit),
      semanticUsed: false,
      semanticError: null,
    }
  }

  const semanticQuery = getSemanticQuery(query)
  if (!semanticQuery) {
    return {
      items: lexicalItems.slice(0, cappedLimit),
      semanticUsed: false,
      semanticError: null,
    }
  }

  try {
    const semanticCandidates = lexicalItems.length < SEMANTIC_EXPANSION_THRESHOLD
      ? await listSemanticProfileCandidates(query, DEFAULT_PROFILE_CANDIDATE_LIMIT)
      : []
    throwIfAborted(signal)
    const semanticCandidateItems = dedupeById([
      ...lexicalItems.map(profile => ({ ...profile, id: profile.pubkey })),
      ...semanticCandidates.map(profile => ({ ...profile, id: profile.pubkey })),
    ])
    const semanticDocuments = semanticCandidateItems
      .map(profile => profileToSemanticDocument(profile))
      .filter((document): document is SemanticDocument => document !== null)

    if (semanticDocuments.length === 0) {
      return {
        items: lexicalItems.slice(0, cappedLimit),
        semanticUsed: false,
        semanticError: null,
      }
    }

    const semanticMatches = await rankSemanticDocuments(
      semanticQuery,
      semanticDocuments,
      Math.max(cappedLimit * 3, 40),
      signal,
    )
    throwIfAborted(signal)
    const ranked = mergeHybridRankings(
      lexicalItems.map(profile => ({ ...profile, id: profile.pubkey })),
      semanticCandidateItems,
      semanticMatches,
      cappedLimit,
    )

    return {
      items: ranked.map(match => {
        const { id: _id, ...profile } = match.item
        return profile
      }),
      semanticUsed: true,
      semanticError: null,
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }

    return {
      items: lexicalItems.slice(0, cappedLimit),
      semanticUsed: false,
      semanticError: error instanceof Error ? error.message : 'Semantic search unavailable',
    }
  }
}
