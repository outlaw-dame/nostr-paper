import { useEffect, useMemo, useState } from 'react'
import { getEventAddressCoordinate, parseAddressCoordinate } from '@/lib/nostr/addressable'
import { queryEvents } from '@/lib/db/nostr'
import { getNDK } from '@/lib/nostr/ndk'
import {
  getConversationRootReference,
  parseCommentEvent,
  parseTextNoteReply,
} from '@/lib/nostr/thread'
import { withRetry } from '@/lib/retry'
import { useAddressableEvent } from '@/hooks/useAddressableEvent'
import { useEvent } from '@/hooks/useEvent'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

interface ConversationThreadState {
  rootEvent: NostrEvent | null
  replies: NostrEvent[]
  loading: boolean
  rootLoading: boolean
  error: string | null
}

function sortChronologically(events: NostrEvent[]): NostrEvent[] {
  return [...events].sort((a, b) => (
    a.created_at - b.created_at || a.id.localeCompare(b.id)
  ))
}

function sameRootAddress(value: string | undefined, expected: string | undefined): boolean {
  return Boolean(value && expected && value === expected)
}

export function useConversationThread(event: NostrEvent | null | undefined): ConversationThreadState {
  const rootReference = useMemo(
    () => (event ? getConversationRootReference(event) : null),
    [event],
  )
  const rootAddress = useMemo(
    () => (rootReference?.address ? parseAddressCoordinate(rootReference.address) : null),
    [rootReference?.address],
  )
  const currentAddress = useMemo(
    () => (event ? getEventAddressCoordinate(event) : null),
    [event],
  )

  const rootEventState = useEvent(
    event && rootReference?.eventId && rootReference.eventId !== event.id
      ? rootReference.eventId
      : null,
  )
  const rootAddressState = useAddressableEvent({
    pubkey: event && rootAddress && rootReference?.address !== currentAddress ? rootAddress.pubkey : null,
    kind: event && rootAddress && rootReference?.address !== currentAddress ? rootAddress.kind : null,
    identifier: event && rootAddress && rootReference?.address !== currentAddress ? rootAddress.identifier : null,
  })

  const resolvedRootEvent = useMemo(() => {
    if (!event || !rootReference) return null
    if (rootReference.eventId === event.id) return event
    if (sameRootAddress(rootReference.address, currentAddress ?? undefined)) return event
    return rootEventState.event ?? rootAddressState.event ?? null
  }, [
    currentAddress,
    event,
    rootAddressState.event,
    rootEventState.event,
    rootReference,
  ])

  const [replies, setReplies] = useState<NostrEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!event || !rootReference || (!rootReference.eventId && !rootReference.address)) {
      setReplies([])
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    const { signal } = controller

    const filter = rootReference.kind === Kind.ShortNote && rootReference.eventId
      ? {
          kinds: [Kind.ShortNote],
          '#e': [rootReference.eventId],
          limit: 200,
        }
      : rootReference.address
        ? {
            kinds: [Kind.Comment],
            '#A': [rootReference.address],
            limit: 200,
          }
        : {
            kinds: [Kind.Comment],
            '#E': rootReference.eventId ? [rootReference.eventId] : [],
            limit: 200,
          }

    const loadLocal = async () => {
      const events = await queryEvents(filter)
      if (signal.aborted) return

      const filtered = rootReference.kind === Kind.ShortNote && rootReference.eventId
        ? events.filter((candidate) => (
            candidate.id !== event.id &&
            candidate.id !== rootReference.eventId &&
            parseTextNoteReply(candidate)?.rootEventId === rootReference.eventId
          ))
        : events.filter((candidate) => {
            if (candidate.id === event.id) return false
            const parsed = parseCommentEvent(candidate)
            if (!parsed) return false
            if (rootReference.address) {
              return parsed.rootAddress === rootReference.address
            }
            return parsed.rootEventId === rootReference.eventId
          })

      setReplies(sortChronologically(filtered))
      setLoading(false)
      setError(null)
    }

    const fetchFromRelays = async () => {
      let ndk
      try {
        ndk = getNDK()
      } catch {
        return
      }

      await withRetry(
        async () => {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          await ndk.fetchEvents(filter)
        },
        {
          maxAttempts: 2,
          baseDelayMs: 1_000,
          maxDelayMs: 3_000,
          signal,
        },
      )
    }

    setLoading(true)
    setError(null)

    loadLocal()
      .then(async () => {
        await fetchFromRelays()
        if (signal.aborted) return
        await loadLocal()
      })
      .catch((loadError: unknown) => {
        if (signal.aborted) return
        setLoading(false)
        setError(loadError instanceof Error ? loadError.message : 'Failed to load conversation.')
      })

    return () => controller.abort()
  }, [event, rootReference])

  return {
    rootEvent: resolvedRootEvent,
    replies,
    loading,
    rootLoading: rootEventState.loading || rootAddressState.loading,
    error,
  }
}
