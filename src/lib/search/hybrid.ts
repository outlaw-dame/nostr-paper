import {
  listSemanticEventCandidates,
  listSemanticProfileCandidates,
  searchEventsWithScores,
  searchProfilesWithScores,
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
const MIN_LEXICAL_SHARE = 0.5

// Autocut: cut the semantic tail when a score gap exceeds this fraction of
// the top score. E.g. 0.2 means a 20% relative drop triggers a cut.
const AUTOCUT_MIN_RELATIVE_GAP = 0.2

// Per-intent alpha weights (lexical + semantic must sum to 1).
// keyword:  exact handles, hashtags, quoted phrases, short token queries
// semantic: long natural-language sentences
// balanced: everything in between
type QueryIntent = 'keyword' | 'balanced' | 'semantic'

const INTENT_WEIGHTS: Record<QueryIntent, { lexical: number; semantic: number }> = {
  keyword:  { lexical: 0.85, semantic: 0.15 },
  balanced: { lexical: 0.60, semantic: 0.40 },
  semantic: { lexical: 0.45, semantic: 0.55 },
}

type Timestamped = {
  created_at?: number
  updatedAt?: number
}

export interface ScoreExplanation {
  lexical: number
  semantic: number
  hybrid: number
}

export interface HybridSearchResponse<T> {
  items: T[]
  semanticUsed: boolean
  semanticError: string | null
  /** Per-item score breakdown keyed by item id. Only populated when explain: true. */
  explainScores?: Map<string, ScoreExplanation>
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

function normalizeRelativeScores(rawScores: Map<string, number>): Map<string, number> {
  const normalized = new Map<string, number>()
  const positiveEntries = [...rawScores.entries()].filter(([, score]) => score > 0)

  if (positiveEntries.length === 0) return normalized

  const min = Math.min(...positiveEntries.map(([, score]) => score))
  const max = Math.max(...positiveEntries.map(([, score]) => score))

  if (max <= 0) return normalized
  if (max === min) {
    for (const [id] of positiveEntries) {
      normalized.set(id, 1)
    }
    return normalized
  }

  for (const [id, score] of positiveEntries) {
    normalized.set(id, (score - min) / (max - min))
  }

  return normalized
}

function normalizeSemanticScores(matches: SemanticMatch[]): Map<string, number> {
  const rawScores = new Map<string, number>()
  for (const match of matches) {
    rawScores.set(match.id, match.score)
  }

  return normalizeRelativeScores(rawScores)
}

function normalizeLexicalScores<T extends { id: string }>(
  lexicalItems: T[],
  lexicalRawScores?: Map<string, number>,
): Map<string, number> {
  if (lexicalRawScores && lexicalRawScores.size > 0) {
    return normalizeRelativeScores(lexicalRawScores)
  }

  const normalized = new Map<string, number>()

  lexicalItems.forEach((item, index) => {
    normalized.set(item.id, lexicalRankScore(index, lexicalItems.length))
  })

  return normalized
}

interface MergeHybridRankingsOptions {
  lexicalRawScores?: Map<string, number>
  /** Override the lexical blend weight (0–1). Defaults to 0.6 (balanced). */
  lexicalWeight?: number
  /** Override the semantic blend weight (0–1). Defaults to 0.4 (balanced). */
  semanticWeight?: number
}

/**
 * Classify a raw query string into a lexical/semantic intent bucket so the
 * fusion weights can be tuned per query type:
 *
 * - keyword  (0.85/0.15): hashtags, handles, npub lookups, quoted phrases, ≤2 tokens
 * - balanced (0.60/0.40): 3–5 plain-text tokens
 * - semantic (0.45/0.55): ≥6 plain-text tokens (natural-language sentences)
 */
export function classifyQueryIntent(rawQuery: string): QueryIntent {
  const tokens = rawQuery.trim().split(/\s+/).filter(t => t && !/^[a-z][a-z0-9_-]*:/i.test(t))
  if (tokens.length === 0) return 'balanced'
  // Quoted phrase anywhere → user wants an exact match
  if (tokens.some(t => t.startsWith('"'))) return 'keyword'
  // All hashtag tokens
  if (tokens.every(t => /^#\w+/.test(t))) return 'keyword'
  // Single handle or Bech32 Nostr key/profile
  const first = tokens[0] ?? ''
  if (tokens.length === 1 && (/^@\w+/.test(first) || /^n(?:pub|profile)1[a-z0-9]{20,}/i.test(first))) return 'keyword'
  // Short query — likely a name or keyword lookup
  if (tokens.length <= 2) return 'keyword'
  // Long natural-language sentence
  if (tokens.length >= 6) return 'semantic'
  return 'balanced'
}

/**
 * Trim the tail of a semantic-match list where the score drops sharply.
 * Detects the first relative gap ≥ AUTOCUT_MIN_RELATIVE_GAP and cuts there,
 * preventing "technically similar but not useful" results from entering fusion.
 */
function autocutSemanticMatches(matches: SemanticMatch[]): SemanticMatch[] {
  if (matches.length <= 2) return matches
  const sorted = [...matches].sort((a, b) => b.score - a.score)
  const maxScore = sorted[0]?.score ?? 0
  if (maxScore <= 0) return sorted
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = (sorted[i]?.score ?? 0) - (sorted[i + 1]?.score ?? 0)
    if (gap / maxScore >= AUTOCUT_MIN_RELATIVE_GAP) return sorted.slice(0, i + 1)
  }
  return sorted
}

export function mergeHybridRankings<T extends { id: string } & Timestamped>(
  lexicalItems: T[],
  semanticItems: T[],
  semanticMatches: SemanticMatch[],
  limit: number,
  options: MergeHybridRankingsOptions = {},
): RankedHybridMatch<T>[] {
  const lexicalScores = normalizeLexicalScores(lexicalItems, options.lexicalRawScores)
  const semanticScores = normalizeSemanticScores(semanticMatches)
  const itemsById = new Map<string, T>()

  for (const item of [...lexicalItems, ...semanticItems]) {
    itemsById.set(item.id, item)
  }

  const lexW = options.lexicalWeight  ?? INTENT_WEIGHTS.balanced.lexical
  const semW = options.semanticWeight ?? INTENT_WEIGHTS.balanced.semantic
  const ranked: RankedHybridMatch<T>[] = []

  for (const [id, item] of itemsById) {
    const lexicalScore = lexicalScores.get(id) ?? 0
    const semanticScore = semanticScores.get(id) ?? 0
    const hybridScore = lexicalScore * lexW + semanticScore * semW

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

  const sorted = ranked
    .sort((a, b) => {
      if (b.hybridScore !== a.hybridScore) return b.hybridScore - a.hybridScore
      return getTimestamp(b.item) - getTimestamp(a.item)
    })

  const cappedLimit = Math.max(1, limit)
  const initial = sorted.slice(0, cappedLimit)

  // Preserve lexical intent for hashtag/keyword queries.
  // We still blend in semantic results, but ensure a minimum lexical presence.
  const lexicalIds = new Set(lexicalItems.map(item => item.id))
  const minLexicalCount = Math.min(
    lexicalItems.length,
    Math.max(1, Math.ceil(cappedLimit * MIN_LEXICAL_SHARE)),
  )
  let lexicalInResult = initial.reduce((count, match) => (
    lexicalIds.has(match.item.id) ? count + 1 : count
  ), 0)

  if (lexicalInResult >= minLexicalCount) {
    return initial
  }

  const remainingLexical = sorted.filter(
    match => lexicalIds.has(match.item.id) && !initial.some(existing => existing.item.id === match.item.id),
  )
  if (remainingLexical.length === 0) {
    return initial
  }

  const adjusted = [...initial]
  for (const lexicalMatch of remainingLexical) {
    if (lexicalInResult >= minLexicalCount) break

    let replaceIndex = -1
    for (let index = adjusted.length - 1; index >= 0; index -= 1) {
      if (!lexicalIds.has(adjusted[index]!.item.id)) {
        replaceIndex = index
        break
      }
    }
    if (replaceIndex === -1) break

    adjusted[replaceIndex] = lexicalMatch
    lexicalInResult += 1
  }

  return adjusted
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
  opts: SearchEventsOptions & { signal?: AbortSignal; lexicalOnly?: boolean; explain?: boolean } = {},
): Promise<HybridSearchResponse<NostrEvent>> {
  const { signal, lexicalOnly, explain, ...searchOptions } = opts
  const limit = Math.min(opts.limit ?? 50, 200)
  const lexicalLimit = Math.min(Math.max(limit * 2, limit), 240)
  const lexicalResults = await searchEventsWithScores(query, {
    ...searchOptions,
    limit: lexicalLimit,
  })
  const lexicalItems = lexicalResults.map(result => result.item)
  const lexicalRawScores = new Map(lexicalResults.map(result => [result.item.id, result.score]))
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

    const rawMatches = await rankSemanticDocuments(
      semanticQuery,
      semanticDocuments,
      Math.max(limit * 3, 60),
      signal,
    )
    throwIfAborted(signal)

    const semanticMatches = autocutSemanticMatches(rawMatches)
    const intent = classifyQueryIntent(query)
    const ranked = mergeHybridRankings(
      lexicalItems,
      mergedCandidates,
      semanticMatches,
      limit,
      { lexicalRawScores, ...INTENT_WEIGHTS[intent] },
    )
    return {
      items: ranked.map(match => match.item),
      semanticUsed: true,
      semanticError: null,
      ...(explain && {
        explainScores: new Map(ranked.map(m => [
          m.item.id,
          { lexical: m.lexicalScore, semantic: m.semanticScore, hybrid: m.hybridScore },
        ])),
      }),
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
  explain = false,
): Promise<HybridSearchResponse<Profile>> {
  const cappedLimit = Math.min(limit, 100)
  const lexicalLimit = Math.min(Math.max(cappedLimit * 2, cappedLimit), 120)
  const lexicalResults = await searchProfilesWithScores(query, lexicalLimit)
  const lexicalItems = lexicalResults.map(result => result.item)
  const lexicalRawScores = new Map(lexicalResults.map(result => [result.item.pubkey, result.score]))
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

    const rawMatches = await rankSemanticDocuments(
      semanticQuery,
      semanticDocuments,
      Math.max(cappedLimit * 3, 40),
      signal,
    )
    throwIfAborted(signal)

    const semanticMatches = autocutSemanticMatches(rawMatches)
    const intent = classifyQueryIntent(query)
    const ranked = mergeHybridRankings(
      lexicalItems.map(profile => ({ ...profile, id: profile.pubkey })),
      semanticCandidateItems,
      semanticMatches,
      cappedLimit,
      { lexicalRawScores, ...INTENT_WEIGHTS[intent] },
    )

    return {
      items: ranked.map(({ item }) => {
        const profile = { ...item }
        delete (profile as { id?: string }).id
        return profile
      }),
      semanticUsed: true,
      semanticError: null,
      ...(explain && {
        explainScores: new Map(ranked.map(m => [
          m.item.id,
          { lexical: m.lexicalScore, semantic: m.semanticScore, hybrid: m.hybridScore },
        ])),
      }),
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
