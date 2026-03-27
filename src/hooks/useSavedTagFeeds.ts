import { useEffect, useState } from 'react'
import {
  getTagFeedsScopeId,
  getSavedTagFeeds,
  getTagFeedsStorageKey,
  TAG_FEEDS_UPDATED_EVENT,
  type SavedTagFeed,
} from '@/lib/feed/tagFeeds'

export function useSavedTagFeeds(scopeId?: string | null): SavedTagFeed[] {
  const [feeds, setFeeds] = useState<SavedTagFeed[]>([])

  useEffect(() => {
    const normalizedScopeId = getTagFeedsScopeId(scopeId)
    setFeeds(getSavedTagFeeds(scopeId))

    const onUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ scopeId?: string }>
      if (getTagFeedsScopeId(customEvent.detail?.scopeId) !== normalizedScopeId) return
      setFeeds(getSavedTagFeeds(scopeId))
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== getTagFeedsStorageKey(scopeId)) return
      setFeeds(getSavedTagFeeds(scopeId))
    }

    window.addEventListener(TAG_FEEDS_UPDATED_EVENT, onUpdated as EventListener)
    window.addEventListener('storage', onStorage)

    return () => {
      window.removeEventListener(TAG_FEEDS_UPDATED_EVENT, onUpdated as EventListener)
      window.removeEventListener('storage', onStorage)
    }
  }, [scopeId])

  return feeds
}
