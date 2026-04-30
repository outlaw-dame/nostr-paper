// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNostrFeed } from './useNostrFeed'
import { queryEvents } from '@/lib/db/nostr'
import { getNDK, waitForCachedEvents } from '@/lib/nostr/ndk'
import type { FeedSection, NostrEvent } from '@/types'
import { Kind } from '@/types'

type SubscriptionHandler = (event?: unknown) => void

interface MockSubscription {
  handlers: Record<string, SubscriptionHandler>
  on: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

interface Snapshot {
  events: NostrEvent[]
  loading: boolean
  eose: boolean
  error: string | null
  pendingEventCount: number
  applyPendingEvents: () => void
  refresh: () => Promise<void>
}

interface HarnessProps {
  section: FeedSection
  shouldBufferNewEvents?: () => boolean
  onSnapshot: (snapshot: Snapshot) => void
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, resolve, reject }
}

function createSubscription(): MockSubscription {
  const handlers: Record<string, SubscriptionHandler> = {}
  return {
    handlers,
    on: vi.fn((event: string, handler: SubscriptionHandler) => {
      handlers[event] = handler
    }),
    stop: vi.fn(),
  }
}

vi.mock('@/lib/db/nostr', () => ({
  queryEvents: vi.fn(),
}))

vi.mock('@/lib/nostr/ndk', () => ({
  getNDK: vi.fn(),
  waitForCachedEvents: vi.fn(),
}))

vi.mock('@/lib/security/sanitize', () => ({
  isValidEvent: () => true,
}))

vi.mock('@/lib/nostr/expiration', () => ({
  isEventExpired: () => false,
}))

function Harness({ section, shouldBufferNewEvents, onSnapshot }: HarnessProps) {
  const state = useNostrFeed(
    shouldBufferNewEvents
      ? { section, shouldBufferNewEvents }
      : { section },
  )

  useEffect(() => {
    onSnapshot(state)
  }, [onSnapshot, state])

  return null
}

function makeEvent(id: string, createdAt: number): NostrEvent {
  return {
    id,
    pubkey: 'a'.repeat(64),
    created_at: createdAt,
    kind: Kind.ShortNote,
    tags: [],
    content: `event:${id}`,
    sig: 'b'.repeat(128),
  }
}

function makeSection(): FeedSection {
  return {
    id: 'feed',
    label: 'Feed',
    filter: {
      kinds: [Kind.ShortNote],
      limit: 20,
    },
  }
}

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

const queryEventsMock = vi.mocked(queryEvents)
const getNDKMock = vi.mocked(getNDK)
const waitForCachedEventsMock = vi.mocked(waitForCachedEvents)

describe('useNostrFeed', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    queryEventsMock.mockReset()
    getNDKMock.mockReset()
    waitForCachedEventsMock.mockReset()
    waitForCachedEventsMock.mockResolvedValue(undefined)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    container?.remove()
    root = null
    container = null
    vi.clearAllMocks()
  })

  it('ignores stale cache results after a newer refresh', async () => {
    const staleCache = deferred<NostrEvent[]>()
    const freshEvent = makeEvent('fresh-event', 20)
    const subscriptions = [createSubscription(), createSubscription()]
    let subscribeCall = 0

    queryEventsMock
      .mockImplementationOnce(() => staleCache.promise)
      .mockResolvedValueOnce([freshEvent])

    getNDKMock.mockReturnValue({
      subscribe: vi.fn(() => subscriptions[subscribeCall++]!),
    } as unknown as ReturnType<typeof getNDK>)

    let latest: Snapshot = {
      events: [],
      loading: true,
      eose: false,
      error: null,
      pendingEventCount: 0,
      applyPendingEvents: () => {},
      refresh: async () => {},
    }

    await act(async () => {
      if (!root) throw new Error('Root not initialized')
      root.render(<Harness section={makeSection()} onSnapshot={(snapshot) => { latest = snapshot }} />)
      await flush()
    })

    await act(async () => {
      await latest.refresh()
      await flush()
    })

    expect(latest.events.map((event) => event.id)).toEqual(['fresh-event'])

    await act(async () => {
      staleCache.resolve([makeEvent('stale-event', 10)])
      await flush()
    })

    expect(latest.events.map((event) => event.id)).toEqual(['fresh-event'])
  })

  it('marks cache-only feeds as complete when NDK is unavailable', async () => {
    queryEventsMock.mockResolvedValueOnce([])
    getNDKMock.mockImplementation(() => {
      throw new Error('NDK unavailable')
    })

    let latest: Snapshot = {
      events: [],
      loading: true,
      eose: false,
      error: null,
      pendingEventCount: 0,
      applyPendingEvents: () => {},
      refresh: async () => {},
    }

    await act(async () => {
      if (!root) throw new Error('Root not initialized')
      root.render(<Harness section={makeSection()} onSnapshot={(snapshot) => { latest = snapshot }} />)
      await flush()
    })

    expect(latest.loading).toBe(false)
    expect(latest.eose).toBe(true)
    expect(latest.error).toBeNull()
  })

  it('reconciles live relay events through the SQLite cache before updating state', async () => {
    vi.useFakeTimers()
    const subscription = createSubscription()
    const rawEvent = makeEvent('relay-event', 15)
    const canonicalEvent = {
      ...rawEvent,
      content: 'event:canonical-relay-event',
    }

    queryEventsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([canonicalEvent])

    getNDKMock.mockReturnValue({
      subscribe: vi.fn(() => subscription),
    } as unknown as ReturnType<typeof getNDK>)

    let latest: Snapshot = {
      events: [],
      loading: true,
      eose: false,
      error: null,
      pendingEventCount: 0,
      applyPendingEvents: () => {},
      refresh: async () => {},
    }

    await act(async () => {
      if (!root) throw new Error('Root not initialized')
      root.render(<Harness section={makeSection()} onSnapshot={(snapshot) => { latest = snapshot }} />)
      await flush()
    })

    await act(async () => {
      subscription.handlers.event!({
        rawEvent: () => rawEvent,
      })
      await vi.advanceTimersByTimeAsync(100)
      await flush()
    })

    expect(waitForCachedEventsMock).toHaveBeenCalledWith(['relay-event'])
    expect(queryEventsMock).toHaveBeenLastCalledWith({ ids: ['relay-event'], limit: 1 })
    expect(latest.events).toEqual([canonicalEvent])
    vi.useRealTimers()
  })

  it('buffers live relay events until the reader asks to show them', async () => {
    vi.useFakeTimers()
    const subscription = createSubscription()
    const cachedEvent = makeEvent('cached-event', 10)
    const rawEvent = makeEvent('buffered-event', 20)

    queryEventsMock
      .mockResolvedValueOnce([cachedEvent])
      .mockResolvedValueOnce([rawEvent])

    getNDKMock.mockReturnValue({
      subscribe: vi.fn(() => subscription),
    } as unknown as ReturnType<typeof getNDK>)

    let latest: Snapshot = {
      events: [],
      loading: true,
      eose: false,
      error: null,
      pendingEventCount: 0,
      applyPendingEvents: () => {},
      refresh: async () => {},
    }

    await act(async () => {
      if (!root) throw new Error('Root not initialized')
      root.render(
        <Harness
          section={makeSection()}
          shouldBufferNewEvents={() => true}
          onSnapshot={(snapshot) => { latest = snapshot }}
        />,
      )
      await flush()
    })

    await act(async () => {
      subscription.handlers.event!({
        rawEvent: () => rawEvent,
      })
      await vi.advanceTimersByTimeAsync(100)
      await flush()
    })

    expect(latest.events.map((event) => event.id)).toEqual(['cached-event'])
    expect(latest.pendingEventCount).toBe(1)

    await act(async () => {
      latest.applyPendingEvents()
      await flush()
    })

    expect(latest.events.map((event) => event.id)).toEqual(['buffered-event', 'cached-event'])
    expect(latest.pendingEventCount).toBe(0)
    vi.useRealTimers()
  })

  it('preserves the section limit when reading from cache', async () => {
    queryEventsMock.mockResolvedValueOnce([])
    getNDKMock.mockImplementation(() => {
      throw new Error('NDK unavailable')
    })

    const limitedSection: FeedSection = {
      id: 'notes',
      label: 'Notes',
      filter: {
        kinds: [Kind.ShortNote],
        limit: 30,
      },
    }

    await act(async () => {
      if (!root) throw new Error('Root not initialized')
      root.render(<Harness section={limitedSection} onSnapshot={() => {}} />)
      await flush()
    })

    expect(queryEventsMock).toHaveBeenCalledWith({
      ...limitedSection.filter,
      limit: 30,
    })
  })

  it('stops the previous live subscription before refreshing', async () => {
    const firstSubscription = createSubscription()
    const secondSubscription = createSubscription()
    let subscribeCall = 0

    queryEventsMock.mockResolvedValue([])
    getNDKMock.mockReturnValue({
      subscribe: vi.fn(() => (subscribeCall++ === 0 ? firstSubscription : secondSubscription)),
    } as unknown as ReturnType<typeof getNDK>)

    let latest: Snapshot = {
      events: [],
      loading: true,
      eose: false,
      error: null,
      pendingEventCount: 0,
      applyPendingEvents: () => {},
      refresh: async () => {},
    }

    await act(async () => {
      if (!root) throw new Error('Root not initialized')
      root.render(<Harness section={makeSection()} onSnapshot={(snapshot) => { latest = snapshot }} />)
      await flush()
    })

    await act(async () => {
      await latest.refresh()
      await flush()
    })

    expect(firstSubscription.stop).toHaveBeenCalledTimes(1)
    expect(secondSubscription.stop).not.toHaveBeenCalled()
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})
