import { listRecentHashtagStats, listRecentTaggedEvents, type RecentHashtagStat } from '@/lib/db/nostr'
import { rankSemanticDocuments } from '@/lib/semantic/client'
import { eventToSemanticText, normalizeSemanticQuery } from '@/lib/semantic/text'
import { sanitizeText, extractHashtags, normalizeHashtag } from '@/lib/security/sanitize'
import type { NostrEvent, SemanticDocument } from '@/types'
import { Kind } from '@/types'

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60
const MIN_RECOMMENDATION_QUERY_CHARS = 12
const DEFAULT_RECOMMENDATION_LIMIT = 6
const MAX_TAG_STATS = 120
const MAX_TAGGED_EVENTS = 220

export const RECOMMENDABLE_HASHTAG_KINDS = [
  Kind.ShortNote,
  Kind.Thread,
  Kind.Poll,
  Kind.LongFormContent,
  Kind.Video,
  Kind.ShortVideo,
  Kind.AddressableVideo,
  Kind.AddressableShortVideo,
] as const

export interface HashtagSuggestion {
  tag: string
  score: number
  relevanceScore: number
  popularityScore: number
  freshnessScore: number
  usageCount: number
  uniqueAuthorCount: number
  latestCreatedAt: number
}

interface RankedHashtagCandidate extends HashtagSuggestion {
  prefixBoost: number
}

interface TaggedSemanticCandidate {
  event: NostrEvent
  tags: string[]
  document: SemanticDocument
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeDraftContext(value: string): string {
  return normalizeWhitespace(
    sanitizeText(value)
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/(^|\s)#[a-zA-Z][a-zA-Z0-9_]{0,100}/g, ' ')
      .replace(/nostr:[a-zA-Z0-9]+/g, ' '),
  )
}

function getNowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function getRecentCutoff(nowSeconds = getNowSeconds()): number {
  return nowSeconds - THIRTY_DAYS_SECONDS
}

function getUniqueEventHashtags(event: NostrEvent): string[] {
  const seen = new Set<string>()
  const tags: string[] = []

  for (const tag of event.tags) {
    if (tag[0] !== 't' || typeof tag[1] !== 'string') continue
    const normalized = normalizeHashtag(tag[1])
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    tags.push(normalized)
  }

  return tags
}

function logNormalized(value: number, maxValue: number): number {
  if (value <= 0 || maxValue <= 0) return 0
  return Math.log1p(value) / Math.log1p(maxValue)
}

function freshnessNormalized(timestamp: number, nowSeconds: number): number {
  if (timestamp <= 0) return 0
  const age = Math.max(0, nowSeconds - timestamp)
  return Math.max(0, 1 - age / THIRTY_DAYS_SECONDS)
}

function lexicalTagRelevance(tag: string, draftTokens: string[]): number {
  if (draftTokens.length === 0) return 0
  const tagParts = tag.split(/[_-]+/).filter(Boolean)
  let score = 0

  for (const token of draftTokens) {
    if (tag === token) score = Math.max(score, 1)
    else if (tag.startsWith(token) || token.startsWith(tag)) score = Math.max(score, 0.72)
    else if (tag.includes(token) || tagParts.includes(token)) score = Math.max(score, 0.45)
  }

  return score
}

function getDraftTokens(context: string): string[] {
  return [...new Set(
    context
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .map(token => token.trim())
      .filter(token => token.length >= 3),
  )]
}

export function getActiveHashtagPrefix(draft: string): string | null {
  const match = draft.match(/(?:^|\s)#([a-zA-Z][a-zA-Z0-9_]*)$/)
  if (!match?.[1]) return null
  return normalizeHashtag(match[1])
}

export function applyHashtagSuggestion(draft: string, tag: string): string {
  const normalizedTag = normalizeHashtag(tag)
  if (!normalizedTag) return draft

  const existingTags = new Set(extractHashtags(draft))
  const activePrefix = getActiveHashtagPrefix(draft)

  if (existingTags.has(normalizedTag) && activePrefix !== normalizedTag) {
    return draft
  }

  if (activePrefix) {
    return draft.replace(/(?:^|\s)#[a-zA-Z][a-zA-Z0-9_]*$/, (match) => {
      const leadingWhitespace = match.startsWith(' ') ? ' ' : ''
      return `${leadingWhitespace}#${normalizedTag} `
    })
  }

  const trimmed = draft.trimEnd()
  if (trimmed.length === 0) return `#${normalizedTag} `

  const separator = /[\n\s]$/.test(draft) ? '' : ' '
  return `${draft}${separator}#${normalizedTag} `
}

function normalizeSemanticMatches(matches: Array<{ id: string; score: number }>): Map<string, number> {
  const positiveScores = matches.filter((match) => match.score > 0)
  const maxScore = Math.max(...positiveScores.map((match) => match.score), 0)
  const normalized = new Map<string, number>()

  if (maxScore <= 0) return normalized

  for (const match of positiveScores) {
    normalized.set(match.id, match.score / maxScore)
  }

  return normalized
}

function buildSemanticCandidates(
  events: NostrEvent[],
  allowedTags: Set<string>,
): TaggedSemanticCandidate[] {
  const candidates: TaggedSemanticCandidate[] = []

  for (const event of events) {
    const tags = getUniqueEventHashtags(event).filter((tag) => allowedTags.has(tag))
    if (tags.length === 0) continue

    const text = eventToSemanticText(event)
    if (!text) continue

    candidates.push({
      event,
      tags,
      document: {
        id: event.id,
        kind: 'event',
        text,
        updatedAt: event.created_at,
      },
    })
  }

  return candidates
}

function rankHashtagCandidates(
  stats: RecentHashtagStat[],
  options: {
    semanticScores: Map<string, number>
    semanticCandidates: TaggedSemanticCandidate[]
    draftTokens: string[]
    existingTags: Set<string>
    activePrefix: string | null
    nowSeconds: number
    limit: number
  },
): HashtagSuggestion[] {
  const maxUsageCount = Math.max(...stats.map((entry) => entry.usageCount), 0)
  const maxAuthorCount = Math.max(...stats.map((entry) => entry.uniqueAuthorCount), 0)
  const relevanceByTag = new Map<string, number>()

  for (const candidate of options.semanticCandidates) {
    const semanticScore = options.semanticScores.get(candidate.document.id) ?? 0
    if (semanticScore <= 0) continue

    const eventFreshness = freshnessNormalized(candidate.event.created_at, options.nowSeconds)
    const eventWeight = semanticScore * (0.8 + 0.2 * eventFreshness) / Math.max(1, Math.sqrt(candidate.tags.length))

    for (const tag of candidate.tags) {
      relevanceByTag.set(tag, Math.max(relevanceByTag.get(tag) ?? 0, eventWeight))
    }
  }

  const ranked: RankedHashtagCandidate[] = []

  for (const stat of stats) {
    if (options.existingTags.has(stat.tag)) continue

    const semanticRelevance = relevanceByTag.get(stat.tag) ?? 0
    const lexicalRelevance = lexicalTagRelevance(stat.tag, options.draftTokens)
    const relevanceScore = Math.max(semanticRelevance, lexicalRelevance)
    const prefixBoost = options.activePrefix && stat.tag.startsWith(options.activePrefix) ? 0.12 : 0

    if (relevanceScore <= 0 && prefixBoost <= 0) continue

    const popularityScore = (
      logNormalized(stat.usageCount, maxUsageCount) * 0.7
      + logNormalized(stat.uniqueAuthorCount, maxAuthorCount) * 0.3
    )
    const freshnessScore = freshnessNormalized(stat.latestCreatedAt, options.nowSeconds)
    const score = relevanceScore * 0.6 + popularityScore * 0.25 + freshnessScore * 0.15 + prefixBoost

    ranked.push({
      tag: stat.tag,
      score,
      relevanceScore,
      popularityScore,
      freshnessScore,
      usageCount: stat.usageCount,
      uniqueAuthorCount: stat.uniqueAuthorCount,
      latestCreatedAt: stat.latestCreatedAt,
      prefixBoost,
    })
  }

  return ranked
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore
      if (b.latestCreatedAt !== a.latestCreatedAt) return b.latestCreatedAt - a.latestCreatedAt
      if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount
      return a.tag.localeCompare(b.tag)
    })
    .slice(0, Math.max(1, options.limit))
    .map(({ prefixBoost: _prefixBoost, ...suggestion }) => suggestion)
}

export async function suggestHashtagsForDraft(
  draft: string,
  options: {
    limit?: number
    signal?: AbortSignal
  } = {},
): Promise<HashtagSuggestion[]> {
  const limit = Math.min(options.limit ?? DEFAULT_RECOMMENDATION_LIMIT, 12)
  const activePrefix = getActiveHashtagPrefix(draft)
  const draftContext = normalizeDraftContext(draft)
  const semanticQuery = normalizeSemanticQuery(draftContext)
  const existingTags = new Set(extractHashtags(draft))

  if (!activePrefix && (!semanticQuery || semanticQuery.length < MIN_RECOMMENDATION_QUERY_CHARS)) {
    return []
  }

  const nowSeconds = getNowSeconds()
  const since = getRecentCutoff(nowSeconds)
  const statsLimit = activePrefix ? MAX_TAG_STATS : Math.min(MAX_TAG_STATS, 80)

  const [tagStats, taggedEvents] = await Promise.all([
    listRecentHashtagStats({
      since,
      kinds: [...RECOMMENDABLE_HASHTAG_KINDS],
      limit: statsLimit,
      ...(activePrefix ? { prefix: activePrefix } : {}),
    }),
    listRecentTaggedEvents({
      since,
      kinds: [...RECOMMENDABLE_HASHTAG_KINDS],
      limit: MAX_TAGGED_EVENTS,
    }),
  ])

  if (tagStats.length === 0) return []

  const allowedTags = new Set(tagStats.map((entry) => entry.tag))
  const semanticCandidates = buildSemanticCandidates(taggedEvents, allowedTags)
  let semanticScores = new Map<string, number>()

  if (semanticQuery && semanticCandidates.length > 0) {
    try {
      semanticScores = normalizeSemanticMatches(await rankSemanticDocuments(
        semanticQuery,
        semanticCandidates.map((candidate) => candidate.document),
        Math.min(Math.max(limit * 12, 40), 160),
        options.signal,
      ))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }
      semanticScores = new Map<string, number>()
    }
  }

  return rankHashtagCandidates(tagStats, {
    semanticScores,
    semanticCandidates,
    draftTokens: getDraftTokens(draftContext),
    existingTags,
    activePrefix,
    nowSeconds,
    limit,
  })
}
