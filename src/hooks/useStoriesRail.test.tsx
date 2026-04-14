// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStoriesRail } from './useStoriesRail'
import { getFollows, queryEvents } from '@/lib/db/nostr'
import { getNDK, waitForCachedEvents } from '@/lib/nostr/ndk'
import { Kind, type NostrEvent } from '@/types'

vi.mock('@/contexts/app-context', () => ({
  useApp: () => ({ currentUser: { pubkey: 'c'.repeat(64) } }),
}))

vi.mock('@/lib/db/nostr', () => ({
  getFollows: vi.fn(),
  queryEvents: vi.fn(),
}))

vi.mock('@/lib/nostr/ndk', () => ({
  getNDK: vi.fn(),
  waitForCachedEvents: vi.fn(),
}))

vi.mock('@/lib/nostr/stories', () => ({
  STORY_LOOKBACK_SECONDS: 7 * 24 * 60 * 60,
  STORY_QUERY_KINDS: [1, 20],
  collectStoryGroups: (events: NostrEvent[]) => events.map((event) => ({
    pubkey: event.pubkey,
    items: [{ id: event.id }],
    latestCreatedAt: event.created_at,
    latestExpiresAt: event.created_at + 60,
  })),
}))

vi.mock('@/lib/security/sanitize', () => ({
  isValidEvent: () => true,
}))

vi.mock('@/lib/nostr/expiration', () => ({
  isEventExpired: () => false,
}))

type SubscriptionHandler = (event?: unknown) => void

interface MockSubscription {
  handlers: Record<string, SubscriptionHandler>
  on: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
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

function makeEvent(id: string, createdAt: number): NostrEvent {
  return {
    id,
    pubkey: 'a'.repeat(64),
    created_at: createdAt,
    kind: Kind.ShortNote,
    tags: [],
    content: `story:${id}`,
    sig: 'b'.repeat(128),
  }
}

interface Snapshot {
  groupIds: string[]
  loading: boolean
  error: string | null
}

function Harness({ onSnapshot }: { onSnapshot: (snapshot: Snapshot) => void }) {
  const state = useStoriesRail(true)

  useEffect(() => {
    onSnapshot({
      groupIds: state.groups.map((group) => group.items[0]?.id ?? ''),
      loading: state.loading,
      error: state.error,
    })
  }, [onSnapshot, state.error, state.groups, state.loading])

  return null
}

const getFollowsMock = vi.mocked(getFollows)
const queryEventsMock = vi.mocked(queryEvents)
const getNDKMock = vi.mocked(getNDK)
const waitForCachedEventsMock = vi.mocked(waitForCachedEvents)

describe('useStoriesRail', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    getFollowsMock.mockReset()
    queryEventsMock.mockReset()
    getNDKMock.mockReset()
    waitForCachedEventsMock.mockReset()
    getFollowsMock.mockResolvedValue(['a'.repeat(64)])
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

  it('reconciles live story events through SQLite before updating groups', async () => {
    const subscription = createSubscription()
    const rawEvent = makeEvent('story-raw', 20)
    const canonicalEvent = {
      ...rawEvent,
      id: 'story-canonical',
    }

    queryEventsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([canonicalEvent])
    getNDKMock.mockReturnValue({
      subscribe: vi.fn(() => subscription),
    } as unknown as ReturnType<typeof getNDK>)

    let latest: Snapshot = {
      groupIds: [],
      loading: true,
      error: null,
    }

    await act(async () => {
      if (!root) throw new Error('Root not initialized')
      root.render(<Harness onSnapshot={(snapshot) => { latest = snapshot }} />)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      subscription.handlers.event!({ rawEvent: () => rawEvent })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(waitForCachedEventsMock).toHaveBeenCalledWith([rawEvent.id])
    expect(queryEventsMock).toHaveBeenLastCalledWith({ ids: [rawEvent.id], limit: 1 })
    expect(latest.groupIds).toEqual(['story-canonical'])
  })
})