import { useEffect, useState } from 'react'
import { getEvent } from '@/lib/db/nostr'
import { getNDK, waitForCachedEvents } from '@/lib/nostr/ndk'
import { withRetry } from '@/lib/retry'
import { isValidHex32 } from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'

interface UseEventState {
  event: NostrEvent | null
  loading: boolean
  error: string | null
}

export function useEvent(eventId: string | null | undefined): UseEventState {
  const [state, setState] = useState<UseEventState>({
    event: null,
    loading: Boolean(eventId),
    error: null,
  })

  useEffect(() => {
    if (!eventId || !isValidHex32(eventId)) {
      setState({ event: null, loading: false, error: null })
      return
    }

    const resolvedEventId = eventId

    const controller = new AbortController()
    const { signal } = controller

    async function loadLocal(): Promise<NostrEvent | null> {
      return getEvent(resolvedEventId)
    }

    async function fetchFromRelays(): Promise<void> {
      let ndk
      try {
        ndk = getNDK()
      } catch {
        return
      }

      await withRetry(
        async () => {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          await ndk.fetchEvents({ ids: [resolvedEventId], limit: 1 })
        },
        {
          maxAttempts: 2,
          baseDelayMs: 1_000,
          signal,
        },
      )
    }

    setState({ event: null, loading: true, error: null })

    loadLocal()
      .then(async (cached) => {
        if (signal.aborted) return
        if (cached) {
          setState({ event: cached, loading: false, error: null })
          return
        }

        await fetchFromRelays()
        if (signal.aborted) return

        await waitForCachedEvents([resolvedEventId])
        if (signal.aborted) return

        const refreshed = await loadLocal()
        if (signal.aborted) return
        setState({
          event: refreshed,
          loading: false,
          error: refreshed ? null : 'Event not found.',
        })
      })
      .catch((error: unknown) => {
        if (signal.aborted) return
        setState({
          event: null,
          loading: false,
          error: error instanceof Error ? error.message : 'Event load failed.',
        })
      })

    return () => controller.abort()
  }, [eventId])

  return state
}
