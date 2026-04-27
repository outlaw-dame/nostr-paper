import { afterEach, describe, expect, it, vi } from 'vitest'

const fromRelayUrlsMock = vi.fn((..._args: unknown[]) => ({ id: 'relay-set' }))
const fetchEventsMock = vi.fn()

vi.mock('@nostr-dev-kit/ndk', () => ({
  NDKRelaySet: {
    fromRelayUrls: (...args: unknown[]) => fromRelayUrlsMock(args[0], args[1], args[2]),
  },
}))

vi.mock('@/lib/nostr/ndk', () => ({
  SEARCH_RELAY_URLS: ['wss://search.example'],
  getNDK: () => ({
    fetchEvents: (...args: unknown[]) => fetchEventsMock(...args),
  }),
}))

vi.mock('@/lib/security/sanitize', () => ({
  normalizeDomain: (value: string) => value.toLowerCase(),
  isValidEvent: (event: { id?: string }) => Boolean(event.id),
}))

import { searchRelays } from './search'
import type { NostrEvent } from '@/types'

function makeEvent(id: string): NostrEvent {
  return {
    id,
    pubkey: 'a'.repeat(64),
    created_at: 1_710_000_000,
    kind: 1,
    tags: [],
    content: `event-${id}`,
    sig: 'b'.repeat(128),
  }
}

describe('searchRelays retries', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('retries with backoff and returns deduplicated valid events', async () => {
    const firstError = new Error('temporary relay failure')
    const event = makeEvent('event-1')

    fetchEventsMock
      .mockRejectedValueOnce(firstError)
      .mockResolvedValueOnce(new Set([{ rawEvent: () => event }, { rawEvent: () => event }]))

    const results = await searchRelays('bitcoin', { limit: 20 })

    expect(fetchEventsMock).toHaveBeenCalledTimes(2)
    expect(results).toHaveLength(1)
    expect(results[0]?.id).toBe('event-1')
    expect(fromRelayUrlsMock).toHaveBeenCalled()
  })

  it('returns empty on abort without retry churn', async () => {
    fetchEventsMock.mockImplementation(
      () => new Promise<Set<never>>(() => {}),
    )

    const controller = new AbortController()
    const pending = searchRelays('bitcoin', { signal: controller.signal })
    controller.abort()

    const results = await pending

    expect(results).toEqual([])
    expect(fetchEventsMock).toHaveBeenCalledTimes(1)
  })
})
