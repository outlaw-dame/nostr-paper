import { parseLongFormEvent } from '@/lib/nostr/longForm'
import { parseThreadEvent } from '@/lib/nostr/thread'
import { parseVideoEvent } from '@/lib/nostr/video'
import { getEventQualitySignals } from '@/lib/feed/qualitySignals'
import { extractURLs } from '@/lib/security/sanitize'
import { extractLinkDomain, normalizeLinkUrl } from '@/lib/url/normalize'
import type { EventEngagementSummary, NostrEvent } from '@/types'

export interface TrendingContentCandidate {
  event: NostrEvent
  engagement: EventEngagementSummary
}

export interface RankedTrendingContent extends TrendingContentCandidate {
  score: number
  popularScore: number
  trendScore: number
  reasons: string[]
}

export interface TrendingContentRankingOptions {
  externalSignalEnabled?: boolean
  externalSignalWeight?: number
  externalSourcePubkeys?: Set<string>
  maxPerAuthor?: number
  maxPerLinkDomain?: number
}

const DEFAULT_MAX_PER_AUTHOR = 2
const DEFAULT_MAX_PER_LINK_DOMAIN = 2

function wilsonLowerBound(positive: number, negative: number): number {
  const total = positive + negative
  if (total <= 0) return 0

  const z = 1.281551565545
  const phat = positive / total
  const denominator = 1 + (z * z / total)
  const centre = phat + (z * z) / (2 * total)
  const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * total)) / total)
  return Math.max(0, (centre - margin) / denominator)
}

// Reddit "hot" ranking style: higher for strong vote velocity on recent posts.
function redditHotScore(signedVotes: number, createdAt: number): number {
  const order = Math.log10(Math.max(Math.abs(signedVotes), 1))
  const sign = signedVotes > 0 ? 1 : signedVotes < 0 ? -1 : 0
  const epochSeconds = createdAt - 1_134_028_003
  return sign * order + epochSeconds / 45_000
}

function getHalfLifeHours(event: NostrEvent): number {
  if (parseLongFormEvent(event) || parseVideoEvent(event) || parseThreadEvent(event)) {
    return 72
  }

  return 24
}

function getRawEngagementScore(engagement: EventEngagementSummary): number {
  return (
    engagement.replyCount * 1.8 +
    engagement.repostCount * 2.4 +
    engagement.likeCount * 0.9 +
    engagement.zapCount * 3.2 +
    Math.log1p(Math.max(engagement.zapTotalMsats, 0) / 1000)
  )
}

function getPositiveVotes(engagement: EventEngagementSummary): number {
  return engagement.likeCount + engagement.repostCount + engagement.zapCount
}

function getTrendReasons(event: NostrEvent, engagement: EventEngagementSummary): string[] {
  const reasons: string[] = []
  const quality = getEventQualitySignals(event)

  for (const reason of quality.reasons) {
    if (reasons.length >= 3) break
    reasons.push(reason)
  }

  if (engagement.replyCount > 0) reasons.push(`${engagement.replyCount} replies`)
  if (engagement.repostCount > 0) reasons.push(`${engagement.repostCount} reposts`)
  if (engagement.zapCount > 0) reasons.push(`${engagement.zapCount} zaps`)

  return [...new Set(reasons)].slice(0, 3)
}

function getEventPrimaryLinkDomain(event: NostrEvent): string | null {
  const taggedUrls = event.tags
    .filter((tag) => tag[0] === 'r' && typeof tag[1] === 'string')
    .map((tag) => tag[1] as string)

  const inlineUrls = extractURLs(event.content)
  const urls = [...taggedUrls, ...inlineUrls]

  for (const url of urls) {
    const normalized = normalizeLinkUrl(url)
    if (!normalized) continue
    const domain = extractLinkDomain(normalized)
    if (domain) return domain
  }

  return null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function scoreTrendingContent(
  candidate: TrendingContentCandidate,
  options: TrendingContentRankingOptions = {},
): RankedTrendingContent {
  const now = Math.floor(Date.now() / 1000)
  const ageHours = Math.max(now - candidate.event.created_at, 0) / 3600
  const halfLifeHours = getHalfLifeHours(candidate.event)
  const positiveVotes = getPositiveVotes(candidate.engagement)

  const rawEngagement = getRawEngagementScore(candidate.engagement)
  const engagementScore = Math.log1p(rawEngagement)
  const popularScore = wilsonLowerBound(positiveVotes, candidate.engagement.dislikeCount)
  const trendScore = redditHotScore(positiveVotes - candidate.engagement.dislikeCount, candidate.event.created_at)
  const freshnessScore = Math.exp(-ageHours / halfLifeHours)
  const qualityScore = Math.max(0, Math.min(1.5, getEventQualitySignals(candidate.event).score / 4))
  const externalSignalWeight = clamp(options.externalSignalWeight ?? 0.15, 0, 0.4)
  const externalSignalBoost = options.externalSignalEnabled && options.externalSourcePubkeys?.has(candidate.event.pubkey)
    ? externalSignalWeight
    : 0

  // Blend known ranking primitives:
  // - popularScore: Wilson lower bound (confidence-aware popularity)
  // - trendScore: Reddit hotness (velocity + recency)
  // Then add engagement/quality/freshness for Nostr-specific relevance.
  const score = trendScore * 0.5
    + popularScore * 1.0
    + engagementScore * 0.36
    + freshnessScore * 0.45
    + qualityScore * 0.7
    + externalSignalBoost

  const reasons = getTrendReasons(candidate.event, candidate.engagement)
  if (externalSignalBoost > 0) reasons.unshift('External trend source')

  return {
    ...candidate,
    score,
    popularScore,
    trendScore,
    reasons: [...new Set(reasons)].slice(0, 3),
  }
}

export function scoreAndRankTrendingContent(
  candidates: TrendingContentCandidate[],
  limit: number,
  options: TrendingContentRankingOptions = {},
): RankedTrendingContent[] {
  if (candidates.length === 0) return []

  const maxPerAuthor = Math.max(1, Math.floor(options.maxPerAuthor ?? DEFAULT_MAX_PER_AUTHOR))
  const maxPerLinkDomain = Math.max(1, Math.floor(options.maxPerLinkDomain ?? DEFAULT_MAX_PER_LINK_DOMAIN))

  const ranked = [...candidates]
    .map((candidate) => scoreTrendingContent(candidate, options))
    .sort((a, b) => b.score - a.score || b.event.created_at - a.event.created_at)

  const selected: RankedTrendingContent[] = []
  const authorCounts = new Map<string, number>()
  const domainCounts = new Map<string, number>()

  for (const item of ranked) {
    if (selected.length >= limit) break

    const nextAuthorCount = (authorCounts.get(item.event.pubkey) ?? 0) + 1
    if (nextAuthorCount > maxPerAuthor) continue

    const domain = getEventPrimaryLinkDomain(item.event)
    if (domain) {
      const nextDomainCount = (domainCounts.get(domain) ?? 0) + 1
      if (nextDomainCount > maxPerLinkDomain) continue
      domainCounts.set(domain, nextDomainCount)
    }

    authorCounts.set(item.event.pubkey, nextAuthorCount)
    selected.push(item)
  }

  return selected
}