import { useEffect, useMemo, useState } from 'react'
import { getEventAddressCoordinate, parseAddressCoordinate } from '@/lib/nostr/addressable'
import { queryEvents } from '@/lib/db/nostr'
import { getNDK } from '@/lib/nostr/ndk'
import {
  getConversationRootReference,
  parseCommentEvent,
  parseTextNoteReply,
} from '@/lib/nostr/thread'
import { rankThreadReplies } from '@/lib/nostr/threadRelevance'
import { withRetry } from '@/lib/retry'
import { useAddressableEvent } from '@/hooks/useAddressableEvent'
import { useEvent } from '@/hooks/useEvent'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'
import { getRelayOptimizer } from '@/lib/nostr/relay-optimizer'

interface ConversationThreadState {
  rootEvent: NostrEvent | null
  replies: NostrEvent[]
  loading: boolean
  rootLoading: boolean
  error: string | null
}

function sameRootAddress(value: string | undefined, expected: string | undefined): boolean {
  return Boolean(value && expected && value === expected)
}

const REPLY_QUERY_LIMIT = 200
const MAX_FETCH_ITERATIONS = 4
const MAX_FRONTIER_IDS = 48

function dedupeById(events: NostrEvent[]): NostrEvent[] {
  const seen = new Set<string>()
  const unique: NostrEvent[] = []
  for (const event of events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    unique.push(event)
  }
  return unique
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function buildReplyFilters(rootReference: ReturnType<typeof getConversationRootReference>) {
  if (!rootReference) return []

  if (rootReference.kind === Kind.ShortNote && rootReference.eventId) {
    return [
      {
        kinds: [Kind.ShortNote],
        '#e': [rootReference.eventId],
        limit: REPLY_QUERY_LIMIT,
      },
      {
        kinds: [Kind.Comment],
        '#E': [rootReference.eventId],
        limit: REPLY_QUERY_LIMIT,
      },
    ]
  }

  if (rootReference.address) {
    return [
      {
        kinds: [Kind.Comment],
        '#A': [rootReference.address],
        limit: REPLY_QUERY_LIMIT,
      },
      ...(rootReference.eventId
        ? [{
            kinds: [Kind.Comment],
            '#E': [rootReference.eventId],
            limit: REPLY_QUERY_LIMIT,
          }]
        : []),
    ]
  }

  return [
    {
      kinds: [Kind.Comment],
      '#E': rootReference.eventId ? [rootReference.eventId] : [],
      limit: REPLY_QUERY_LIMIT,
    },
    {
      kinds: [Kind.ShortNote],
      '#e': rootReference.eventId ? [rootReference.eventId] : [],
      limit: REPLY_QUERY_LIMIT,
    },
  ]
}

async function queryReplyCandidates(
  rootReference: NonNullable<ReturnType<typeof getConversationRootReference>>,
): Promise<NostrEvent[]> {
  const filters = buildReplyFilters(rootReference)
  if (filters.length === 0) return []

  const resultSets = await Promise.all(filters.map((filter) => queryEvents(filter)))
  return dedupeById(resultSets.flat())
}

function collectFrontierIds(
  events: NostrEvent[],
  rootReference: NonNullable<ReturnType<typeof getConversationRootReference>>,
): string[] {
  const ids = new Set<string>()

  for (const candidate of events) {
    if (candidate.kind === Kind.ShortNote) {
      const parsed = parseTextNoteReply(candidate)
      if (!parsed) continue
      if (rootReference.eventId && parsed.rootEventId !== rootReference.eventId) continue
      ids.add(candidate.id)
      continue
    }

    if (candidate.kind === Kind.Comment) {
      const parsed = parseCommentEvent(candidate)
      if (!parsed) continue
      if (rootReference.address && parsed.rootAddress !== rootReference.address) continue
      if (!rootReference.address && rootReference.eventId && parsed.rootEventId !== rootReference.eventId) continue
      ids.add(candidate.id)
    }
  }

  return [...ids]
}

async function queryConversationReplies(
  event: NostrEvent,
  rootReference: NonNullable<ReturnType<typeof getConversationRootReference>>,
): Promise<NostrEvent[]> {
  const events = await queryReplyCandidates(rootReference)

  const filtered = rootReference.kind === Kind.ShortNote && rootReference.eventId
    ? events.filter((candidate) => {
        if (candidate.id === event.id || candidate.id === rootReference.eventId) return false
        if (candidate.kind === Kind.ShortNote) {
          return parseTextNoteReply(candidate)?.rootEventId === rootReference.eventId
        }
        if (candidate.kind === Kind.Comment) {
          return parseCommentEvent(candidate)?.rootEventId === rootReference.eventId
        }
        return false
      })
    : events.filter((candidate) => {
        if (candidate.id === event.id || candidate.kind !== Kind.Comment) return false
        const parsed = parseCommentEvent(candidate)
        if (!parsed) return false
        if (rootReference.address) {
          return parsed.rootAddress === rootReference.address
        }
        return parsed.rootEventId === rootReference.eventId
      })

  const deduped = dedupeById(filtered)
  return rankThreadReplies(event, deduped)
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

    const loadLocal = async () => {
      const localReplies = await queryConversationReplies(event, rootReference)
      if (signal.aborted) return

      setReplies(localReplies)
      setLoading(false)
      setError(null)
      return localReplies
    }

    const fetchFromRelays = async () => {
      let ndk
      try {
        ndk = getNDK()
      } catch {
        return
      }

      const baseFilters = buildReplyFilters(rootReference)
      if (baseFilters.length === 0) return
      const optimizer = getRelayOptimizer()
      const recordMetric = (relay: string, latency: number, success: boolean) => {
        if (!optimizer) return
        optimizer.recordOutcome(relay, { success, latency, hitRate: success ? 1.0 : 0.5 })
      }


      for (const filter of baseFilters) {
        await withRetry(
          async () => {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
            const start = performance.now()
            try {
              await ndk.fetchEvents(filter)
              const latency = performance.now() - start
              // Record success on all relays (NDK handles relay list internally)
              ndk.pool.relays.forEach(relay => {
                recordMetric(relay.url, latency, true)
              })
            } catch (err) {
              const latency = performance.now() - start
              ndk.pool.relays.forEach(relay => {
                recordMetric(relay.url, latency, false)
              })
              throw err
            }
          },
          {
            maxAttempts: 2,
            baseDelayMs: 1_000,
            maxDelayMs: 3_000,
            signal,
          },
        )
      }

      const initialReplies = await queryConversationReplies(event, rootReference)
      let frontierIds = collectFrontierIds(initialReplies, rootReference)
      if (rootReference.eventId) {
        frontierIds = [rootReference.eventId, ...frontierIds]
      }
      frontierIds = dedupeStrings(frontierIds)

      let iteration = 0
      while (iteration < MAX_FETCH_ITERATIONS && frontierIds.length > 0) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

        const batch = frontierIds.slice(0, MAX_FRONTIER_IDS)
        frontierIds = frontierIds.slice(batch.length)

        const iterativeFilters = rootReference.kind === Kind.ShortNote
          ? [
              {
                kinds: [Kind.ShortNote],
                '#e': batch,
                limit: REPLY_QUERY_LIMIT,
              },
              {
                kinds: [Kind.Comment],
                '#E': batch,
                limit: REPLY_QUERY_LIMIT,
              },
            ]
          : [
              {
                kinds: [Kind.Comment],
                '#E': batch,
                limit: REPLY_QUERY_LIMIT,
              },
            ]

        for (const iterativeFilter of iterativeFilters) {
          await withRetry(
            async () => {
              if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
              const start = performance.now()
              try {
                await ndk.fetchEvents(iterativeFilter)
                const latency = performance.now() - start
                ndk.pool.relays.forEach(relay => {
                  recordMetric(relay.url, latency, true)
                })
              } catch (err) {
                const latency = performance.now() - start
                ndk.pool.relays.forEach(relay => {
                  recordMetric(relay.url, latency, false)
                })
                throw err
              }
            },
            {
              maxAttempts: 2,
              baseDelayMs: 800,
              maxDelayMs: 2_500,
              signal,
            },
          )
        }

        const refreshedReplies = await queryConversationReplies(event, rootReference)
        const nextIds = collectFrontierIds(refreshedReplies, rootReference)
        const seenFrontier = new Set(frontierIds)
        for (const id of nextIds) {
          if (!seenFrontier.has(id)) {
            frontierIds.push(id)
            seenFrontier.add(id)
          }
        }

        iteration += 1
      }
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
