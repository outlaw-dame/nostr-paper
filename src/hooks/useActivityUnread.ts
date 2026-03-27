import { useMemo } from 'react'
import { useApp } from '@/contexts/app-context'
import { useNostrFeed } from '@/hooks/useNostrFeed'
import { ACTIVITY_KINDS, ACTIVITY_WINDOW_DAYS } from '@/lib/activity/constants'
import { useActivitySeen } from '@/hooks/useActivitySeen'
import type { FeedSection } from '@/types'

export function useActivityUnread(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options
  const { currentUser } = useApp()
  const { seenAt } = useActivitySeen()

  const section = useMemo<FeedSection | null>(() => {
    if (!enabled || !currentUser?.pubkey) return null

    const now = Math.floor(Date.now() / 1000)
    const windowStart = now - (ACTIVITY_WINDOW_DAYS * 24 * 60 * 60)

    return {
      id: `activity-unread:${currentUser.pubkey}:${seenAt}`,
      label: 'Activity Unread',
      filter: {
        kinds: ACTIVITY_KINDS,
        '#p': [currentUser.pubkey],
        since: Math.max(windowStart, seenAt + 1),
        limit: 120,
      },
    }
  }, [currentUser?.pubkey, enabled, seenAt])

  const { events, loading } = useNostrFeed({
    section: section ?? {
      id: 'activity-unread-disabled',
      label: 'Activity Unread',
      filter: { kinds: [], limit: 1 },
    },
    enabled: section !== null,
  })

  const unreadCount = useMemo(() => {
    if (!currentUser?.pubkey) return 0

    return events.filter((event) => (
      event.pubkey !== currentUser.pubkey && event.created_at > seenAt
    )).length
  }, [currentUser?.pubkey, events, seenAt])

  return {
    unreadCount,
    hasUnread: unreadCount > 0,
    loading,
  }
}
