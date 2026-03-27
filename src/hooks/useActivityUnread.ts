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

  // Stable section ID that doesn't change with seenAt
  const sectionId = useMemo<string>(() => {
    if (!currentUser?.pubkey) return 'activity-unread-disabled'
    return `activity-unread:${currentUser.pubkey}`
  }, [currentUser?.pubkey])

  // Dynamic filter that updates with seenAt, but doesn't trigger re-subscription
  // because section.id is stable
  const filter = useMemo(() => {
    if (!currentUser?.pubkey || !enabled) {
      return { kinds: [] as const, limit: 1 }
    }

    const now = Math.floor(Date.now() / 1000)
    const windowStart = now - (ACTIVITY_WINDOW_DAYS * 24 * 60 * 60)

    return {
      kinds: ACTIVITY_KINDS,
      '#p': [currentUser.pubkey],
      since: Math.max(windowStart, seenAt + 1),
      limit: 120,
    } as const
  }, [currentUser?.pubkey, enabled, seenAt])

  const section = useMemo<FeedSection>(() => ({
    id: sectionId,
    label: 'Activity Unread',
    filter,
  }), [sectionId, filter])

  const { events, loading } = useNostrFeed({
    section,
    enabled: section.id !== 'activity-unread-disabled',
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
