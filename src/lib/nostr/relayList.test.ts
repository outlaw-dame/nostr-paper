import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importCurrentUserRelayListPreferences, parseRelayListPreferences, publishCurrentUserRelayList } from './relayList'
import { insertEvent } from '@/lib/db/nostr'
import { withOptionalClientTag } from '@/lib/nostr/appHandlers'
import { getCurrentUser, getNDK } from '@/lib/nostr/ndk'
import { getFreshNip51ListEvent } from '@/lib/nostr/lists'
import type { RelayPreference } from '@/lib/relay/relaySettings'

const relaySetSpy = vi.fn()

vi.mock('@nostr-dev-kit/ndk', () => {
  class MockNDKEvent {
    kind = 0
    content = ''
    tags: string[][] = []

    async sign() {
      return undefined
    }

    async publish(relaySet: unknown) {
      relaySetSpy(relaySet)
    }

    rawEvent() {
      return {
        id: 'relay-list-event',
        pubkey: 'a'.repeat(64),
        created_at: 123,
        kind: this.kind,
        tags: this.tags,
        content: this.content,
        sig: 'b'.repeat(128),
      }
    }
  }

  return {
    NDKEvent: MockNDKEvent,
    NDKRelaySet: {
      fromRelayUrls: vi.fn((urls: string[]) => ({ urls })),
    },
  }
})

vi.mock('@/lib/db/nostr', () => ({
  insertEvent: vi.fn(),
}))

vi.mock('@/lib/nostr/appHandlers', () => ({
  withOptionalClientTag: vi.fn(async (tags: string[][]) => tags),
}))

vi.mock('@/lib/nostr/ndk', () => ({
  getNDK: vi.fn(),
  getCurrentUser: vi.fn(),
  getDefaultRelayUrls: () => ['wss://relay.default'],
  getOutboxRelayUrls: () => ['wss://purplepag.es'],
}))

vi.mock('@/lib/nostr/lists', () => ({
  getFreshNip51ListEvent: vi.fn(),
}))

const getNDKMock = vi.mocked(getNDK)
const getCurrentUserMock = vi.mocked(getCurrentUser)
const getFreshNip51ListEventMock = vi.mocked(getFreshNip51ListEvent)
const insertEventMock = vi.mocked(insertEvent)
const withOptionalClientTagMock = vi.mocked(withOptionalClientTag)

describe('relayList', () => {
  beforeEach(() => {
    relaySetSpy.mockReset()
    getNDKMock.mockReset()
    getCurrentUserMock.mockReset()
    getFreshNip51ListEventMock.mockReset()
    insertEventMock.mockReset()
    withOptionalClientTagMock.mockClear()

    getNDKMock.mockReturnValue({ signer: {} } as never)
    getCurrentUserMock.mockResolvedValue({ pubkey: 'a'.repeat(64) } as never)
    insertEventMock.mockResolvedValue(true)
  })

  it('publishes kind-10002 with explicit read and write markers', async () => {
    const relayPreferences: RelayPreference[] = [
      { url: 'wss://relay.one', read: true, write: true },
      { url: 'wss://relay.two', read: true, write: false },
      { url: 'wss://relay.three', read: false, write: true },
    ]

    await publishCurrentUserRelayList({
      relayPreferences,
    })

    expect(withOptionalClientTagMock).toHaveBeenCalledWith(
      [
        ['r', 'wss://relay.one'],
        ['r', 'wss://relay.two', 'read'],
        ['r', 'wss://relay.three', 'write'],
      ],
      undefined,
    )
    expect(relaySetSpy).toHaveBeenCalledWith({
      urls: ['wss://relay.one', 'wss://relay.two', 'wss://relay.three', 'wss://purplepag.es'],
    })
    expect(insertEventMock).toHaveBeenCalledTimes(1)
  })

  it('parses read and write roles from a relay list event', () => {
    expect(parseRelayListPreferences({
      tags: [
        ['r', 'wss://relay.one'],
        ['r', 'wss://relay.two', 'read'],
        ['r', 'wss://relay.three', 'write'],
        ['r', 'wss://relay.two', 'write'],
      ],
    } as never)).toEqual([
      { url: 'wss://relay.one', read: true, write: true },
      { url: 'wss://relay.two', read: true, write: true },
      { url: 'wss://relay.three', read: false, write: true },
    ])
  })

  it('imports the signed-in user relay roles from kind-10002', async () => {
    getFreshNip51ListEventMock.mockResolvedValue({
      tags: [
        ['r', 'wss://relay.one'],
        ['r', 'wss://relay.two', 'read'],
        ['r', 'wss://relay.three', 'write'],
      ],
    } as never)

    await expect(importCurrentUserRelayListPreferences()).resolves.toEqual([
      { url: 'wss://relay.one', read: true, write: true },
      { url: 'wss://relay.two', read: true, write: false },
      { url: 'wss://relay.three', read: false, write: true },
    ])
  })
})