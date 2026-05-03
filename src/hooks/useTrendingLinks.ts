import { useEffect, useState } from 'react'
import { listRecentLinkStats } from '@/lib/db/nostr'
import {
  DISCOVERY_CONTROLS_UPDATED_EVENT,
  loadDiscoveryControls,
  type TrendingLinkWeights,
} from '@/lib/explore/discoveryControls'
import { scoreAndRankLinks, type TrendingLinkStat } from '@/lib/explore/trendingLinks'

const SINCE_1_DAY  = () => Math.floor(Date.now() / 1000) - 1 * 24 * 60 * 60
const SINCE_7_DAYS = () => Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60

/**
 * Return scored, ranked trending links from the local cache.
 *
 * Mirrors the useTrendingTopics hook:
 *   - Fetches a pool 4× the requested limit for better re-ranking coverage
 *   - Reacts to DISCOVERY_CONTROLS_UPDATED_EVENT without a page reload
 *   - Cancels in-flight fetches on param change to avoid stale-state writes
 */
export function useTrendingLinks(
  limit = 8,
  timeWindow: 'today' | 'week' = 'week',
): { links: TrendingLinkStat[]; loading: boolean } {
  const [links,   setLinks]   = useState<TrendingLinkStat[]>([])
  const [loading, setLoading] = useState(true)
  const [weights, setWeights] = useState<TrendingLinkWeights>(
    () => loadDiscoveryControls().links,
  )

  // Re-read weights whenever the user adjusts discovery controls
  useEffect(() => {
    const handleUpdated = () => setWeights(loadDiscoveryControls().links)
    window.addEventListener(DISCOVERY_CONTROLS_UPDATED_EVENT, handleUpdated)
    return () => window.removeEventListener(DISCOVERY_CONTROLS_UPDATED_EVENT, handleUpdated)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const since = timeWindow === 'today' ? SINCE_1_DAY() : SINCE_7_DAYS()
    listRecentLinkStats({ since, limit: Math.min(limit * 4, 120) })
      .then((stats) => {
        if (cancelled) return
        setLinks(scoreAndRankLinks(stats, limit, weights, timeWindow))
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setLinks([])
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [limit, timeWindow, weights])

  return { links, loading }
}
