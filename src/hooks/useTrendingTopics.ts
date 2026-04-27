import { useEffect, useState } from 'react'
import { listRecentHashtagStats, type RecentHashtagStat } from '@/lib/db/nostr'
import {
  DISCOVERY_CONTROLS_UPDATED_EVENT,
  loadDiscoveryControls,
  type TrendingTopicWeights,
} from '@/lib/explore/discoveryControls'

const SINCE_1_DAY  = () => Math.floor(Date.now() / 1000) - 1 * 24 * 60 * 60
const SINCE_7_DAYS = () => Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60

function scoreAndRankWithWeights(
  stats: RecentHashtagStat[],
  limit: number,
  weights: TrendingTopicWeights,
): RecentHashtagStat[] {
  if (stats.length === 0) return []

  const now = Math.floor(Date.now() / 1000)
  const maxUsage = Math.max(...stats.map((s) => s.usageCount), 1)
  const maxUniqueAuthors = Math.max(...stats.map((s) => s.uniqueAuthorCount), 1)

  const scored = stats.map((s) => {
    const popularity = s.usageCount / maxUsage
    const diversity = s.usageCount > 0 ? s.uniqueAuthorCount / s.usageCount : 0
    const authorBreadth = s.uniqueAuthorCount / maxUniqueAuthors
    const ageSec = Math.max(now - s.latestCreatedAt, 0)
    const freshness = Math.exp(-ageSec / (3 * 24 * 3600))
    // Momentum favors recent tags with broad participation, not one-account spam.
    const momentum = Math.sqrt(Math.max(popularity * freshness, 0)) * 0.6 + authorBreadth * 0.4

    const score = popularity * weights.popularity
      + diversity * weights.diversity
      + freshness * weights.freshness
      + momentum * weights.momentum

    return { stat: s, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((s) => s.stat)
}

export function useTrendingTopics(
  limit = 20,
  timeWindow: 'today' | 'week' = 'week',
): {
  topics: RecentHashtagStat[]
  loading: boolean
} {
  const [topics, setTopics] = useState<RecentHashtagStat[]>([])
  const [loading, setLoading] = useState(true)
  const [weights, setWeights] = useState(() => loadDiscoveryControls().trending)

  useEffect(() => {
    const handleUpdated = () => {
      setWeights(loadDiscoveryControls().trending)
    }

    window.addEventListener(DISCOVERY_CONTROLS_UPDATED_EVENT, handleUpdated)
    return () => window.removeEventListener(DISCOVERY_CONTROLS_UPDATED_EVENT, handleUpdated)
  }, [])

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    const since = timeWindow === 'today' ? SINCE_1_DAY() : SINCE_7_DAYS()
    // Fetch a larger pool so re-ranking can surface better candidates
    listRecentHashtagStats({ since, limit: Math.min(limit * 3, 100) })
      .then((stats) => {
        if (cancelled) return
        setTopics(scoreAndRankWithWeights(stats, limit, weights))
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setTopics([])
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [limit, timeWindow, weights])

  return { topics, loading }
}
