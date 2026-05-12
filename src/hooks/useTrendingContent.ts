import { useEffect, useState } from 'react'
import { queryEvents, getEventEngagementSummary } from '@/lib/db/nostr'
import { scoreAndRankTrendingContent, type RankedTrendingContent } from '@/lib/explore/trendingContent'
import {
  getTrendingSourceSettings,
  TRENDING_SOURCE_SETTINGS_UPDATED_EVENT,
  type TrendingSourceSettings,
} from '@/lib/explore/trendingSourceSettings'
import { Kind } from '@/types'

const TRENDING_CONTENT_KINDS = [
  Kind.ShortNote,
  Kind.Thread,
  Kind.LongFormContent,
  Kind.Video,
  Kind.ShortVideo,
  Kind.AddressableVideo,
  Kind.AddressableShortVideo,
]

const SINCE_1_DAY = () => Math.floor(Date.now() / 1000) - 1 * 24 * 60 * 60
const SINCE_7_DAYS = () => Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60

export function useTrendingContent(
  limit = 6,
  timeWindow: 'today' | 'week' = 'week',
): { items: RankedTrendingContent[]; loading: boolean } {
  const [items, setItems] = useState<RankedTrendingContent[]>([])
  const [loading, setLoading] = useState(true)
  const [sourceSettings, setSourceSettings] = useState<TrendingSourceSettings>(() => getTrendingSourceSettings())

  useEffect(() => {
    const handleSettingsUpdated = () => setSourceSettings(getTrendingSourceSettings())
    window.addEventListener('storage', handleSettingsUpdated)
    window.addEventListener(TRENDING_SOURCE_SETTINGS_UPDATED_EVENT, handleSettingsUpdated)
    return () => {
      window.removeEventListener('storage', handleSettingsUpdated)
      window.removeEventListener(TRENDING_SOURCE_SETTINGS_UPDATED_EVENT, handleSettingsUpdated)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const since = timeWindow === 'today' ? SINCE_1_DAY() : SINCE_7_DAYS()
    queryEvents({ kinds: TRENDING_CONTENT_KINDS, since, limit: Math.min(limit * 8, 80) })
      .then(async (events) => {
        if (cancelled) return

        const candidates = await Promise.all(
          events.map(async (event) => ({
            event,
            engagement: await getEventEngagementSummary(event.id),
          })),
        )

        if (cancelled) return
        setItems(scoreAndRankTrendingContent(candidates, limit, {
          externalSignalEnabled: sourceSettings.enabled,
          externalSignalWeight: sourceSettings.externalSignalWeight,
          externalSourcePubkeys: new Set(sourceSettings.sourcePubkeys),
          maxPerAuthor: sourceSettings.maxPerAuthor,
          maxPerLinkDomain: sourceSettings.maxPerLinkDomain,
        }))
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setItems([])
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [limit, sourceSettings, timeWindow])

  return { items, loading }
}