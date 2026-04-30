import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  saveCurrentUserContactEntry,
  unfollowCurrentUserContact,
  syncContactListFromRelays,
} from './contacts'
import { getContactList, insertEvent } from '@/lib/db/nostr'
import { getCurrentUser, getNDK } from '@/lib/nostr/ndk'
import type { ContactList } from '@/types'
import { Kind } from '@/types'

// ── Shared mocks ────────────────────────────────────────────────

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
        id: 'contact-event-id',
        pubkey: 'a'.repeat(64),
        created_at: 1_700_100_000,
        kind: this.kind,
        tags: this.tags,
        content: this.content,
        sig: 'c'.repeat(128),
      }
    }
  }

  return { NDKEvent: MockNDKEvent }
})

vi.mock('@/lib/db/nostr', () => ({
  getContactList: vi.fn(),
  insertEvent: vi.fn(),
}))

vi.mock('@/lib/nostr/ndk', () => ({
  getNDK: vi.fn(),
  getCurrentUser: vi.fn(),
}))

vi.mock('@/lib/nostr/appHandlers', () => ({
  withOptionalClientTag: vi.fn(async (tags: string[][]) => tags),
}))

vi.mock('@/lib/nostr/outbox', () => ({
  publishEventWithNip65Outbox: vi.fn(async (event: { publish?: () => Promise<void> | void }) => {
    await event.publish?.()
  }),
}))

vi.mock('@/lib/security/sanitize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/sanitize')>()
  return {
    ...actual,
    isValidHex32: (v: string) => /^[0-9a-f]{64}$/.test(v),
  }
})

const getContactListMock = vi.mocked(getContactList)
const insertEventMock = vi.mocked(insertEvent)
const getCurrentUserMock = vi.mocked(getCurrentUser)
const getNDKMock = vi.mocked(getNDK)

const VIEWER_PUBKEY = 'a'.repeat(64)
const TARGET_PUBKEY = 'b'.repeat(64)

function makeContactList(overrides: Partial<ContactList> = {}): ContactList {
  return {
    pubkey: VIEWER_PUBKEY,
    entries: [],
    updatedAt: 1_700_000_000,
    ...overrides,
  }
}

beforeEach(() => {
  publishSpy.mockReset()
  getContactListMock.mockReset()
  insertEventMock.mockReset()
  getCurrentUserMock.mockReset()
  getNDKMock.mockReset()

  getNDKMock.mockReturnValue({ signer: {} } as never)
  getCurrentUserMock.mockResolvedValue({ pubkey: VIEWER_PUBKEY } as never)
  insertEventMock.mockResolvedValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('saveCurrentUserContactEntry — follow consistency', () => {
  it('publishes a follow and returns the updated list', async () => {
    getContactListMock
      .mockResolvedValueOnce(makeContactList())  // loadEditable: local
      .mockResolvedValueOnce(makeContactList({   // after insertEvent
        entries: [{ pubkey: TARGET_PUBKEY, position: 0 }],
      }))

    const result = await saveCurrentUserContactEntry(TARGET_PUBKEY, {})
    expect(publishSpy).toHaveBeenCalledTimes(1)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]!.pubkey).toBe(TARGET_PUBKEY)
  })

  it('refuses a self-follow', async () => {
    getContactListMock.mockResolvedValue(makeContactList())

    await expect(
      saveCurrentUserContactEntry(VIEWER_PUBKEY, {}),
    ).rejects.toThrow('Refusing to publish a self-follow entry.')
  })

  it('does not create duplicate entries for the same pubkey', async () => {
    const existing: ContactList = makeContactList({
      entries: [{ pubkey: TARGET_PUBKEY, position: 0, petname: 'alice' }],
    })
    getContactListMock
      .mockResolvedValueOnce(existing)     // loadEditable
      .mockResolvedValueOnce(makeContactList({
        entries: [{ pubkey: TARGET_PUBKEY, position: 0, petname: 'alice-updated' }],
      }))

    await saveCurrentUserContactEntry(TARGET_PUBKEY, { petname: 'alice-updated' })
    // Only one publish call — no duplicate event.
    expect(publishSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid pubkeys without publishing', async () => {
    await expect(
      saveCurrentUserContactEntry('not-a-valid-hex', {}),
    ).rejects.toThrow('Invalid pubkey')
    expect(publishSpy).not.toHaveBeenCalled()
  })
})

describe('unfollowCurrentUserContact — rollback safety', () => {
  it('removes the entry and returns the updated list', async () => {
    const existing: ContactList = makeContactList({
      entries: [
        { pubkey: TARGET_PUBKEY, position: 0 },
        { pubkey: 'c'.repeat(64), position: 1 },
      ],
    })
    getContactListMock
      .mockResolvedValueOnce(existing)   // loadEditable
      .mockResolvedValueOnce(makeContactList({
        entries: [{ pubkey: 'c'.repeat(64), position: 1 }],
      }))

    const result = await unfollowCurrentUserContact(TARGET_PUBKEY)
    expect(publishSpy).toHaveBeenCalledTimes(1)
    expect(result.entries.some(e => e.pubkey === TARGET_PUBKEY)).toBe(false)
    expect(result.entries).toHaveLength(1)
  })

  it('publishes an unfollow even when the pubkey was not in the list', async () => {
    getContactListMock
      .mockResolvedValueOnce(makeContactList())
      .mockResolvedValueOnce(makeContactList())

    // Should succeed (idempotent) without throwing.
    await expect(
      unfollowCurrentUserContact(TARGET_PUBKEY),
    ).resolves.toBeDefined()
    expect(publishSpy).toHaveBeenCalledTimes(1)
  })
})

describe('syncContactListFromRelays — out-of-order event handling', () => {
  it('falls back to local cache when NDK is unavailable', async () => {
    const local = makeContactList({ entries: [{ pubkey: TARGET_PUBKEY, position: 0 }] })
    getContactListMock.mockResolvedValue(local)
    getNDKMock.mockImplementation(() => { throw new Error('NDK not ready') })

    const result = await syncContactListFromRelays(VIEWER_PUBKEY)
    expect(result).toEqual(local)
  })

  it('returns local cache when no relay events are available', async () => {
    const local = makeContactList({ entries: [{ pubkey: TARGET_PUBKEY, position: 0 }] })
    getContactListMock.mockResolvedValue(local)
    getNDKMock.mockReturnValue({
      fetchEvents: vi.fn().mockResolvedValue(new Set()),
    } as never)

    const result = await syncContactListFromRelays(VIEWER_PUBKEY)
    expect(result).toEqual(local)
    expect(insertEventMock).not.toHaveBeenCalled()
  })

  it('rejects non-hex-64 pubkeys without hitting the network', async () => {
    const result = await syncContactListFromRelays('bad-pubkey')
    expect(result).toBeNull()
    expect(getNDKMock).not.toHaveBeenCalled()
  })
})
