/**
 * Trending-link scoring.
 *
 * Mirrors the scoreAndRankWithWeights logic in useTrendingTopics but tuned
 * for news links:
 *   - Shorter freshness half-life (links age faster than hashtags)
 *   - Diversity weighted slightly higher (broad engagement vs. spam)
 *
 * Pure function — no side effects, no I/O.  Consumed by useTrendingLinks.
 */

import type { RecentLinkStat } from '@/lib/db/nostr'
import type { TrendingLinkWeights } from '@/lib/explore/discoveryControls'

export interface TrendingLinkStat extends RecentLinkStat {
  score: number
}

/**
 * Score and rank a pool of link stats.
 *
 * Freshness half-life:
 *   'today' → 6 h   (news within a day ages quickly)
 *   'week'  → 2 d   (week-level trends decay slower but still faster than hashtags)
 *
 * Momentum = sqrt(popularity × freshness) × 0.6  +  authorBreadth × 0.4
 * — same formula as topic scoring; penalises single-author bursts.
 */
export function scoreAndRankLinks(
  stats: RecentLinkStat[],
  limit: number,
  weights: TrendingLinkWeights,
  timeWindow: 'today' | 'week' = 'week',
): TrendingLinkStat[] {
  if (stats.length === 0) return []

  const now      = Math.floor(Date.now() / 1000)
  const halfLife = timeWindow === 'today' ? 6 * 3600 : 2 * 24 * 3600

  const maxUsage   = Math.max(...stats.map((s) => s.usageCount), 1)
  const maxAuthors = Math.max(...stats.map((s) => s.uniqueAuthorCount), 1)

  const scored = stats.map((s) => {
    const popularity   = s.usageCount / maxUsage
    const diversity    = s.usageCount > 0 ? s.uniqueAuthorCount / s.usageCount : 0
    const authorBreadth = s.uniqueAuthorCount / maxAuthors
    const ageSec       = Math.max(now - s.latestCreatedAt, 0)
    const freshness    = Math.exp(-ageSec / halfLife)
    const momentum     = Math.sqrt(Math.max(popularity * freshness, 0)) * 0.6 + authorBreadth * 0.4

    const score =
      popularity   * weights.popularity +
      diversity    * weights.diversity  +
      freshness    * weights.freshness  +
      momentum     * weights.momentum

    return { ...s, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}
