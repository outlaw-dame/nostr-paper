import { useEffect, useMemo, useCallback, useState } from 'react'
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

  const refreshFollowingPubkeys = useCallback(async (signal?: AbortSignal) => {
    if (!currentUserPubkey) {
      setFollowingPubkeys([])
      setLoading(false)
      return
    }

    setLoading(true)

    try {
      const follows = await getFollows(currentUserPubkey)
      if (signal?.aborted) return
      setFollowingPubkeys(follows)
    } catch {
      if (signal?.aborted) return
      setFollowingPubkeys([])
    } finally {
      if (!signal?.aborted) {
        setLoading(false)
      }
    }
  }, [currentUserPubkey])

  useEffect(() => {
    if (!currentUserPubkey) {
      setFollowingPubkeys([])
      setLoading(false)
      return
    }

    const controller = new AbortController()

    void refreshFollowingPubkeys(controller.signal)

    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshFollowingPubkeys(controller.signal)
      }
    }

    window.addEventListener('focus', refreshIfVisible)
    document.addEventListener('visibilitychange', refreshIfVisible)

    return () => {
      controller.abort()
      window.removeEventListener('focus', refreshIfVisible)
      document.removeEventListener('visibilitychange', refreshIfVisible)
    }
  }, [currentUserPubkey, refreshFollowingPubkeys])

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
