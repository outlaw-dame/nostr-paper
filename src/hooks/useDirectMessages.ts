import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NDKSubscriptionCacheUsage, type NDKEvent, type NDKSubscription } from '@nostr-dev-kit/ndk'
import { insertEvent } from '@/lib/db/nostr'
import {
  buildDirectMessageFilters,
  decryptDirectMessage,
  loadDirectMessageEvents,
  parseDirectMessageEvent,
  type DecryptedDirectMessage,
} from '@/lib/nostr/dm'
import { getNDK } from '@/lib/nostr/ndk'
import { isValidEvent } from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'

export interface DirectMessageViewModel {
  event: NostrEvent
  decrypted: DecryptedDirectMessage | null
  error: string | null
  counterpartyPubkey: string
  direction: 'inbound' | 'outbound'
  createdAt: number
}

export interface UseDirectMessagesOptions {
  currentUserPubkey: string | null | undefined
  counterpartyPubkey?: string
  enabled?: boolean
  limit?: number
}

export interface UseDirectMessagesResult {
  messages: DirectMessageViewModel[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

function dedupeEvents(events: NostrEvent[]): NostrEvent[] {
  const byId = new Map<string, NostrEvent>()
  for (const event of events) {
    byId.set(event.id, event)
  }
  return [...byId.values()].sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
}

export function useDirectMessages({
  currentUserPubkey,
  counterpartyPubkey,
  enabled = true,
  limit,
}: UseDirectMessagesOptions): UseDirectMessagesResult {
  const [events, setEvents] = useState<NostrEvent[]>([])
  const [messages, setMessages] = useState<DirectMessageViewModel[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const subscriptionRef = useRef<NDKSubscription | null>(null)
  const refreshTimerRef = useRef<number | null>(null)

  const filters = useMemo(
    () => currentUserPubkey
      ? buildDirectMessageFilters(currentUserPubkey, counterpartyPubkey, limit)
      : [],
    [counterpartyPubkey, currentUserPubkey, limit],
  )

  const decryptEvents = useCallback(async (rawEvents: NostrEvent[], signal: AbortSignal) => {
    if (!currentUserPubkey) {
      setMessages([])
      return
    }

    const next: DirectMessageViewModel[] = []

    for (const event of rawEvents) {
      if (signal.aborted) return
      const parsed = parseDirectMessageEvent(event, currentUserPubkey)
      if (!parsed) continue

      try {
        const decrypted = await decryptDirectMessage(event, currentUserPubkey)
        if (signal.aborted) return
        next.push({
          event,
          decrypted,
          error: null,
          counterpartyPubkey: parsed.counterpartyPubkey,
          direction: parsed.direction,
          createdAt: parsed.createdAt,
        })
      } catch (decryptError) {
        if (signal.aborted) return
        next.push({
          event,
          decrypted: null,
          error: decryptError instanceof Error ? decryptError.message : 'Unable to decrypt this message.',
          counterpartyPubkey: parsed.counterpartyPubkey,
          direction: parsed.direction,
          createdAt: parsed.createdAt,
        })
      }
    }

    setMessages(next.sort((a, b) => a.createdAt - b.createdAt || a.event.id.localeCompare(b.event.id)))
  }, [currentUserPubkey])

  const refresh = useCallback(async () => {
    if (!enabled || !currentUserPubkey) {
      setEvents([])
      setMessages([])
      setLoading(false)
      setError(null)
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const { signal } = controller

    setLoading(true)
    setError(null)

    try {
      const loaded = await loadDirectMessageEvents({
        currentUserPubkey,
        ...(counterpartyPubkey ? { counterpartyPubkey } : {}),
        ...(limit !== undefined ? { limit } : {}),
        signal,
      })
      if (signal.aborted) return
      const deduped = dedupeEvents(loaded)
      setEvents(deduped)
      await decryptEvents(deduped, signal)
    } catch (loadError) {
      if (signal.aborted) return
      setError(loadError instanceof Error ? loadError.message : 'Failed to load direct messages.')
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [counterpartyPubkey, currentUserPubkey, decryptEvents, enabled, limit])

  useEffect(() => {
    void refresh()
    return () => {
      abortRef.current?.abort()
    }
  }, [refresh])

  useEffect(() => {
    if (!enabled || !currentUserPubkey || filters.length === 0) return

    let ndk
    try {
      ndk = getNDK()
    } catch {
      return
    }

    const scheduleRefresh = () => {
      if (refreshTimerRef.current !== null) return
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null
        void refresh()
      }, 160)
    }

    const sub = ndk.subscribe(
      filters as Parameters<typeof ndk.subscribe>[0],
      {
        closeOnEose: false,
        cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST,
      },
    )
    subscriptionRef.current = sub

    sub.on('event', (ndkEvent: NDKEvent) => {
      const raw = ndkEvent.rawEvent() as unknown as NostrEvent
      if (!isValidEvent(raw) || !parseDirectMessageEvent(raw, currentUserPubkey)) return
      void insertEvent(raw).finally(scheduleRefresh)
    })

    return () => {
      sub.stop()
      if (subscriptionRef.current === sub) {
        subscriptionRef.current = null
      }
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [currentUserPubkey, enabled, filters, refresh])

  useEffect(() => {
    const controller = new AbortController()
    void decryptEvents(events, controller.signal)
    return () => controller.abort()
  }, [decryptEvents, events])

  return {
    messages,
    loading,
    error,
    refresh,
  }
}
