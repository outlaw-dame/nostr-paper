import { useEffect, useState } from 'react'
import { listRecentHashtagStats, type RecentHashtagStat } from '@/lib/db/nostr'

const SINCE_7_DAYS = () => Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60

export function useTrendingTopics(limit = 20): {
  topics: RecentHashtagStat[]
  loading: boolean
} {
  const [topics, setTopics] = useState<RecentHashtagStat[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    listRecentHashtagStats({ since: SINCE_7_DAYS(), limit })
      .then((stats) => {
        if (cancelled) return
        setTopics(stats)
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
  }, [limit])

  return { topics, loading }
}
