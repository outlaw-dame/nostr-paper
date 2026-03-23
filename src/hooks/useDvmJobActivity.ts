import { useEffect, useState } from 'react'
import { NDKRelaySet, type NDKFilter } from '@nostr-dev-kit/ndk'
import { queryEvents } from '@/lib/db/nostr'
import {
  getDvmResultKindForRequestKind,
  type ParsedDvmJobRequest,
} from '@/lib/nostr/dvm'
import { getNDK } from '@/lib/nostr/ndk'
import { withRetry } from '@/lib/retry'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

interface UseDvmJobActivityState {
  events: NostrEvent[]
  loading: boolean
  error: string | null
}

async function queryLocalActivity(request: ParsedDvmJobRequest): Promise<NostrEvent[]> {
  const resultKind = getDvmResultKindForRequestKind(request.requestKind)
  if (resultKind === null) return []

  return queryEvents({
    '#e': [request.id],
    kinds: [resultKind, Kind.DvmJobFeedback],
    limit: 64,
  })
}

export function useDvmJobActivity(
  request: ParsedDvmJobRequest | null,
): UseDvmJobActivityState {
  const [state, setState] = useState<UseDvmJobActivityState>({
    events: [],
    loading: Boolean(request),
    error: null,
  })

  useEffect(() => {
    if (!request) {
      setState({ events: [], loading: false, error: null })
      return
    }

    const currentRequest = request
    const controller = new AbortController()
    const { signal } = controller
    const resultKind = getDvmResultKindForRequestKind(currentRequest.requestKind)

    if (resultKind === null) {
      setState({ events: [], loading: false, error: 'Invalid DVM request kind.' })
      return
    }

    async function fetchFromRelays(): Promise<void> {
      let ndk
      try {
        ndk = getNDK()
      } catch {
        return
      }

      const filter = {
        '#e': [currentRequest.id],
        kinds: [resultKind, Kind.DvmJobFeedback],
        limit: 64,
      } as unknown as NDKFilter

      const relaySet = currentRequest.responseRelays.length > 0
        ? NDKRelaySet.fromRelayUrls(currentRequest.responseRelays, ndk)
        : undefined

      await withRetry(
        async () => {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          if (relaySet) {
            await ndk.fetchEvents(filter, { closeOnEose: true }, relaySet)
            return
          }
          await ndk.fetchEvents(filter, { closeOnEose: true })
        },
        {
          maxAttempts: 2,
          baseDelayMs: 750,
          maxDelayMs: 2_500,
          signal,
        },
      )
    }

    setState({ events: [], loading: true, error: null })

    queryLocalActivity(currentRequest)
      .then(async (cached) => {
        if (signal.aborted) return
        setState({ events: cached, loading: true, error: null })

        await fetchFromRelays()
        if (signal.aborted) return

        const refreshed = await queryLocalActivity(currentRequest)
        if (signal.aborted) return

        setState({ events: refreshed, loading: false, error: null })
      })
      .catch((error: unknown) => {
        if (signal.aborted) return
        setState({
          events: [],
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to load DVM activity.',
        })
      })

    return () => controller.abort()
  }, [request])

  return state
}
