import { useEffect, useState } from 'react'
import {
  listLocalExploreFollowPackCandidates,
  refreshExploreFollowPackCandidates,
  type ExploreFollowPackCandidate,
} from '@/lib/explore/followPacks'

export function useExploreFollowPacks(limit = 18): {
  packs: ExploreFollowPackCandidate[]
  loading: boolean
} {
  const [packs, setPacks] = useState<ExploreFollowPackCandidate[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller

    setLoading(true)

    listLocalExploreFollowPackCandidates(limit)
      .then((localPacks) => {
        if (signal.aborted) return
        setPacks(localPacks)
      })
      .catch(() => {
        if (signal.aborted) return
        setPacks([])
      })

    refreshExploreFollowPackCandidates(limit, signal)
      .then((nextPacks) => {
        if (signal.aborted) return
        setPacks(nextPacks)
      })
      .catch(() => {
        if (signal.aborted) return
      })
      .finally(() => {
        if (signal.aborted) return
        setLoading(false)
      })

    return () => controller.abort()
  }, [limit])

  return { packs, loading }
}
