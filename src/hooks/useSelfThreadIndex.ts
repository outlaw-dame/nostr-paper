import { useEffect, useState } from 'react'
import { getSelfThreadIndex, type SelfThreadIndex } from '@/lib/nostr/threadIndex'
import type { NostrEvent } from '@/types'

export function useSelfThreadIndex(event: NostrEvent): SelfThreadIndex | null {
  const [threadIndex, setThreadIndex] = useState<SelfThreadIndex | null>(null)

  useEffect(() => {
    let cancelled = false

    void getSelfThreadIndex(event)
      .then((resolved) => {
        if (cancelled) return
        setThreadIndex(resolved)
      })
      .catch(() => {
        if (cancelled) return
        setThreadIndex(null)
      })

    return () => {
      cancelled = true
    }
  }, [event.id])

  return threadIndex
}
