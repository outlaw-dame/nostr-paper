import { useEffect, useState } from 'react'
import { getLatestAddressableEvent } from '@/lib/db/nostr'
import { getNDK } from '@/lib/nostr/ndk'
import { withRetry } from '@/lib/retry'
import { isValidHex32 } from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'

interface UseAddressableEventState {
  event: NostrEvent | null
  loading: boolean
  error: string | null
}

interface UseAddressableEventOptions {
  pubkey: string | null | undefined
  kind: number | null | undefined
  identifier: string | null | undefined
}

export function useAddressableEvent({
  pubkey,
  kind,
  identifier,
}: UseAddressableEventOptions): UseAddressableEventState {
  const [state, setState] = useState<UseAddressableEventState>({
    event: null,
    loading: Boolean(pubkey && kind !== null && identifier),
    error: null,
  })

  useEffect(() => {
    if (!pubkey || !isValidHex32(pubkey) || kind === null || kind === undefined || !identifier) {
      setState({ event: null, loading: false, error: null })
      return
    }

    const author = pubkey
    const addressKind = kind
    const addressIdentifier = identifier

    const controller = new AbortController()
    const { signal } = controller

    async function loadLocal(): Promise<NostrEvent | null> {
      return getLatestAddressableEvent(author, addressKind, addressIdentifier)
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
          await ndk.fetchEvents({
            authors: [author],
            kinds: [addressKind],
            '#d': [addressIdentifier],
            limit: 10,
          })
        },
        {
          maxAttempts: 2,
          baseDelayMs: 1_000,
          maxDelayMs: 3_000,
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
        }

        await fetchFromRelays()
        if (signal.aborted) return

        const refreshed = await loadLocal()
        if (signal.aborted) return

        setState({
          event: refreshed,
          loading: false,
          error: refreshed ? null : 'Addressable event not found.',
        })
      })
      .catch((error: unknown) => {
        if (signal.aborted) return
        setState({
          event: null,
          loading: false,
          error: error instanceof Error ? error.message : 'Addressable event load failed.',
        })
      })

    return () => controller.abort()
  }, [identifier, kind, pubkey])

  return state
}
