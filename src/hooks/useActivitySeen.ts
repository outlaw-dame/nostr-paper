import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '@/contexts/app-context'
import {
  ACTIVITY_SEEN_UPDATED_EVENT,
  getActivitySeenAt,
  getActivitySeenStorageKey,
  markActivitySeenNow,
} from '@/lib/activity/seen'

export function useActivitySeen() {
  const { currentUser } = useApp()
  const scopeId = useMemo(() => currentUser?.pubkey ?? 'anon', [currentUser?.pubkey])
  const [seenAt, setSeenAt] = useState(0)

  useEffect(() => {
    setSeenAt(getActivitySeenAt(scopeId))

    const onUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ scopeId?: string }>
      if ((customEvent.detail?.scopeId ?? 'anon') !== scopeId) return
      setSeenAt(getActivitySeenAt(scopeId))
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== getActivitySeenStorageKey(scopeId)) return
      setSeenAt(getActivitySeenAt(scopeId))
    }

    window.addEventListener(ACTIVITY_SEEN_UPDATED_EVENT, onUpdated as EventListener)
    window.addEventListener('storage', onStorage)

    return () => {
      window.removeEventListener(ACTIVITY_SEEN_UPDATED_EVENT, onUpdated as EventListener)
      window.removeEventListener('storage', onStorage)
    }
  }, [scopeId])

  const markAllSeen = useCallback(() => {
    const nextSeenAt = markActivitySeenNow(scopeId)
    setSeenAt(nextSeenAt)
    return nextSeenAt
  }, [scopeId])

  return {
    seenAt,
    markAllSeen,
  }
}
