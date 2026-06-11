import { useEffect, useState } from 'react'
import {
  resolveNostrEventEmbed,
  type EventEmbedResolutionState,
} from '@/lib/nostr/embedResolver'
import type { NostrEvent } from '@/types'

interface UseEventState {
  event: NostrEvent | null
  loading: boolean
  error: string | null
  resolutionState: EventEmbedResolutionState
}

export function useEvent(eventReference: string | null | undefined): UseEventState {
  const [state, setState] = useState<UseEventState>({
    event: null,
    loading: Boolean(eventReference),
    error: null,
    resolutionState: eventReference ? 'decoding-reference' : 'idle',
  })

  useEffect(() => {
    if (!eventReference) {
      setState({
        event: null,
        loading: false,
        error: null,
        resolutionState: 'idle',
      })
      return
    }

    const controller = new AbortController()
    const { signal } = controller

    setState({
      event: null,
      loading: true,
      error: null,
      resolutionState: 'decoding-reference',
    })

    resolveNostrEventEmbed(eventReference, { signal })
      .then((result) => {
        if (signal.aborted) return
        setState({
          event: result.event,
          loading: false,
          error: result.error,
          resolutionState: result.state,
        })
      })
      .catch((loadError: unknown) => {
        if (signal.aborted) return
        setState({
          event: null,
          loading: false,
          error: loadError instanceof Error ? loadError.message : 'Event load failed.',
          resolutionState: 'error',
        })
      })

    return () => controller.abort()
  }, [eventReference])

  return state
}
