import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  relayListsAreEqual,
  publishCurrentUserRelayList,
} from './relayList'
import { insertEvent } from '@/lib/db/nostr'
import { withOptionalClientTag } from '@/lib/nostr/appHandlers'
import { getCurrentUser, getNDK, getDefaultRelayUrls, getOutboxRelayUrls } from '@/lib/nostr/ndk'
import { getFreshNip51ListEvent } from '@/lib/nostr/lists'
import type { RelayPreference } from '@/lib/relay/relaySettings'

// ── Mock NDK ────────────────────────────────────────────────────

const publishSpy = vi.fn()

vi.mock('@nostr-dev-kit/ndk', () => {
  class MockNDKEvent {
    kind = 0
    content = ''
    tags: string[][] = []

    async sign() { return undefined }
    async publish() { publishSpy() }

    rawEvent() {
      return {
        id: 'relay-list-event',
        pubkey: 'a'.repeat(64),
        created_at: 1_700_100_000,
        kind: this.kind,
        tags: this.tags,
        content: this.content,
        sig: 'c'.repeat(128),
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
  getDefaultRelayUrls: vi.fn(() => ['wss://relay.default']),
  getOutboxRelayUrls: vi.fn(() => ['wss://purplepag.es']),
}))

vi.mock('@/lib/nostr/lists', () => ({
  getFreshNip51ListEvent: vi.fn(),
}))

// Stored relay preferences simulated via module-level variable.
let storedPrefs: RelayPreference[] = []

vi.mock('@/lib/relay/relaySettings', () => ({
  getStoredRelayPreferences: vi.fn(() => storedPrefs),
  normalizeRelayPreferences: vi.fn((prefs: RelayPreference[]) => {
    const seen = new Set<string>()
    return prefs.filter((p): p is RelayPreference => {
      if (!p || !p.url || seen.has(p.url)) return false
      seen.add(p.url)
      return true
    })
  }),
}))

const getNDKMock = vi.mocked(getNDK)
const getCurrentUserMock = vi.mocked(getCurrentUser)
const insertEventMock = vi.mocked(insertEvent)
const withOptionalClientTagMock = vi.mocked(withOptionalClientTag)

beforeEach(() => {
  publishSpy.mockReset()
  getNDKMock.mockReset()
  getCurrentUserMock.mockReset()
  insertEventMock.mockReset()
  withOptionalClientTagMock.mockClear()
  storedPrefs = []

  getNDKMock.mockReturnValue({ signer: {} } as never)
  getCurrentUserMock.mockResolvedValue({ pubkey: 'a'.repeat(64) } as never)
  insertEventMock.mockResolvedValue(true)
  withOptionalClientTagMock.mockImplementation(async (tags: string[][]) => tags)
})

// ── relayListsAreEqual ──────────────────────────────────────────

describe('relayListsAreEqual', () => {
  it('returns true for identical lists', () => {
    const a: RelayPreference[] = [
      { url: 'wss://relay.one', read: true, write: true },
      { url: 'wss://relay.two', read: true, write: false },
    ]
    const b: RelayPreference[] = [
      { url: 'wss://relay.two', read: true, write: false },
      { url: 'wss://relay.one', read: true, write: true },
    ]
    expect(relayListsAreEqual(a, b)).toBe(true)
  })

  it('returns false when lengths differ', () => {
    const a: RelayPreference[] = [{ url: 'wss://relay.one', read: true, write: true }]
    const b: RelayPreference[] = [
      { url: 'wss://relay.one', read: true, write: true },
      { url: 'wss://relay.two', read: true, write: true },
    ]
    expect(relayListsAreEqual(a, b)).toBe(false)
  })

  it('returns false when read/write flags differ', () => {
    const a: RelayPreference[] = [{ url: 'wss://relay.one', read: true, write: true }]
    const b: RelayPreference[] = [{ url: 'wss://relay.one', read: true, write: false }]
    expect(relayListsAreEqual(a, b)).toBe(false)
  })

  it('returns true for two empty lists', () => {
    expect(relayListsAreEqual([], [])).toBe(true)
  })
})

// ── publishCurrentUserRelayList diff guard ───────────────────────

describe('publishCurrentUserRelayList — diff guard', () => {
  it('returns null and skips publish when explicit preferences match stored list', async () => {
    storedPrefs = [
      { url: 'wss://relay.one', read: true, write: true },
      { url: 'wss://relay.two', read: true, write: false },
    ]

    const result = await publishCurrentUserRelayList({
      relayPreferences: [
        { url: 'wss://relay.two', read: true, write: false },
        { url: 'wss://relay.one', read: true, write: true },
      ],
    })

    expect(result).toBeNull()
    expect(publishSpy).not.toHaveBeenCalled()
  })

  it('publishes when explicit preferences differ from stored list', async () => {
    storedPrefs = [{ url: 'wss://relay.one', read: true, write: true }]

    const result = await publishCurrentUserRelayList({
      relayPreferences: [
        { url: 'wss://relay.one', read: true, write: true },
        { url: 'wss://relay.two', read: true, write: true },
      ],
    })

    expect(result).not.toBeNull()
    expect(publishSpy).toHaveBeenCalledTimes(1)
  })

  it('always publishes when no explicit preferences are provided (deliberate republish)', async () => {
    storedPrefs = [{ url: 'wss://relay.default', read: true, write: true }]

    // No options — defaults to getEffectiveRelayListEntries() but treats it as explicit republish intent.
    const result = await publishCurrentUserRelayList()
    expect(result).not.toBeNull()
    expect(publishSpy).toHaveBeenCalledTimes(1)
  })

  it('throws when the resulting relay preference list is empty', async () => {
    await expect(
      publishCurrentUserRelayList({ relayPreferences: [] }),
    ).rejects.toThrow('Relay list must contain at least one valid relay URL')
  })
})
