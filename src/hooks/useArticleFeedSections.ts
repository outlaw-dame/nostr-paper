import { useEffect, useMemo, useState } from 'react'
import { getFollows } from '@/lib/db/nostr'
import { buildArticleFeedSections, type ArticleFeedSection } from '@/lib/feed/articleFeeds'
import type { SavedTagFeed } from '@/lib/feed/tagFeeds'

export interface UseArticleFeedSectionsResult {
  sections: ArticleFeedSection[]
  followingCount: number
  loading: boolean
}

export function useArticleFeedSections(
  currentUserPubkey: string | null | undefined,
  savedTagFeeds: SavedTagFeed[],
): UseArticleFeedSectionsResult {
  const [followingPubkeys, setFollowingPubkeys] = useState<string[]>([])
  const [loading, setLoading] = useState(Boolean(currentUserPubkey))

  useEffect(() => {
    if (!currentUserPubkey) {
      setFollowingPubkeys([])
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        const follows = await getFollows(currentUserPubkey)
        if (cancelled) return
        setFollowingPubkeys(follows)
      } catch {
        if (cancelled) return
        setFollowingPubkeys([])
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [currentUserPubkey])

  const sections = useMemo<ArticleFeedSection[]>(() => (
    buildArticleFeedSections({
      currentUserPubkey: currentUserPubkey ?? null,
      followingPubkeys,
      savedTagFeeds,
    })
  ), [currentUserPubkey, followingPubkeys, savedTagFeeds])

  return {
    sections,
    followingCount: followingPubkeys.length,
    loading,
  }
}
