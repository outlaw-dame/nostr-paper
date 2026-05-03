import { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { insertEvent } from '@/lib/db/nostr'
import { getNDK } from '@/lib/nostr/ndk'
import { isValidEvent, isValidHex32, isValidRelayURL } from '@/lib/security/sanitize'
import type { NostrEvent, NostrFilter } from '@/types'
import { Kind } from '@/types'

const PLATFORM_THREAD_TIMEOUT_MS = 4_000
const PLATFORM_THREAD_LIMIT = 200

export interface PlatformThreadReference {
  eventId?: string
  address?: string
}

export interface FetchPlatformThreadOptions {
  limit?: number
  signal?: AbortSignal
}

function getPlatformThreadRelayUrl(): string | null {
  const configured = import.meta.env.VITE_PLATFORM_SEARCH_RELAY_URL?.trim()
  if (!configured || !isValidRelayURL(configured)) return null
  return configured
}

function buildPlatformThreadFilter(
  reference: PlatformThreadReference,
  limit: number,
): (NostrFilter & { thread_id?: string; thread_address?: string }) | null {
  const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), PLATFORM_THREAD_LIMIT)

  if (reference.eventId && isValidHex32(reference.eventId)) {
    return {
      search: 'thread',
      thread_id: reference.eventId,
      kinds: [Kind.ShortNote, Kind.Comment, Kind.Thread],
      limit: normalizedLimit,
    }
  }

  if (reference.address) {
    return {
      search: 'thread',
      thread_address: reference.address,
      kinds: [Kind.Comment],
      limit: normalizedLimit,
    }
  }

  return null
}

async function fetchWithTimeout<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T | null> {
  if (signal?.aborted) return null

  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let abortHandler: (() => void) | null = null

  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), PLATFORM_THREAD_TIMEOUT_MS)
  })
  const abort = new Promise<null>((resolve) => {
    abortHandler = () => resolve(null)
    signal?.addEventListener('abort', abortHandler, { once: true })
  })

  try {
    return await Promise.race([promise, timeout, abort])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
    if (abortHandler) signal?.removeEventListener('abort', abortHandler)
  }
}

export async function fetchPlatformThreadEvents(
  reference: PlatformThreadReference,
  options: FetchPlatformThreadOptions = {},
): Promise<NostrEvent[]> {
  const relayUrl = getPlatformThreadRelayUrl()
  if (!relayUrl) return []

  const filter = buildPlatformThreadFilter(reference, options.limit ?? PLATFORM_THREAD_LIMIT)
  if (!filter) return []

  let ndk
  try {
    ndk = getNDK()
  } catch {
    return []
  }

  const relaySet = NDKRelaySet.fromRelayUrls([relayUrl], ndk, true)
  const fetched = await fetchWithTimeout(
    ndk.fetchEvents(filter as Parameters<typeof ndk.fetchEvents>[0], undefined, relaySet),
    options.signal,
  )

  if (!fetched) return []

  const events: NostrEvent[] = []
  for (const ndkEvent of fetched) {
    const raw = (ndkEvent as { rawEvent: () => NostrEvent }).rawEvent()
    if (!isValidEvent(raw)) continue
    events.push(raw)
    await insertEvent(raw)
  }

  return events
}
