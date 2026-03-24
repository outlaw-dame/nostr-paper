import { useEffect, useState } from 'react'
import { listSemanticProfileCandidates } from '@/lib/db/nostr'
import type { Profile } from '@/types'

export function usePopularProfiles(limit = 10): {
  profiles: Profile[]
  loading: boolean
} {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    listSemanticProfileCandidates('', limit)
      .then((ps) => {
        setProfiles(ps)
        setLoading(false)
      })
      .catch(() => {
        setProfiles([])
        setLoading(false)
      })
  }, [limit])

  return { profiles, loading }
}
