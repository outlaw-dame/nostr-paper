import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildProfileMetadataContent,
  normalizeProfileMetadata,
  parseProfileMetadataEvent,
  publishProfileMetadata,
} from './metadata'
import { insertEvent } from '@/lib/db/nostr'
import { getNDK } from '@/lib/nostr/ndk'
import type { NostrEvent, ProfileMetadata } from '@/types'
import { Kind } from '@/types'

// ── Publish mocks ───────────────────────────────────────────────

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
        id: 'meta-event-id',
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
  insertEvent: vi.fn(),
}))

vi.mock('@/lib/nostr/ndk', () => ({
  getNDK: vi.fn(),
}))

vi.mock('@/lib/nostr/appHandlers', () => ({
  withOptionalClientTag: vi.fn(async (tags: string[][]) => tags),
}))

vi.mock('@/lib/nostr/nip39', () => ({
  buildNip39Tags: vi.fn(() => []),
}))

const getNDKMock = vi.mocked(getNDK)
const insertEventMock = vi.mocked(insertEvent)

beforeEach(() => {
  publishSpy.mockReset()
  getNDKMock.mockReset()
  insertEventMock.mockReset()

  getNDKMock.mockReturnValue({ signer: {} } as never)
  insertEventMock.mockResolvedValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function baseEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: Kind.Metadata,
    tags: [],
    content: JSON.stringify({ name: 'alice' }),
    sig: 'c'.repeat(128),
    ...overrides,
  }
}

describe('normalizeProfileMetadata', () => {
  it('normalizes canonical kind-0 fields and derives name from display_name when needed', () => {
    const normalized = normalizeProfileMetadata({
      display_name: 'Alice Wonder',
      picture: 'https://example.com/avatar.jpg',
      banner: 'https://example.com/banner.jpg',
      about: '<b>hello</b>',
      website: 'https://example.com',
      bot: true,
      birthday: { year: 2000, month: 2, day: 29 },
      nip05: ' Alice@Example.com ',
      lud06: 'LNURL1DP68GURN8GHJ7MRWW4EXCTN0D3SKCCN9DPKX2MRP0YH8G6T0D3H82UNVWQHKJARGD9SKCMR0W4EXCTNV9UH8QATJWS',
      lud16: ' ALICE@wallet.example ',
    })

    expect(normalized).toEqual({
      name: 'Alice Wonder',
      display_name: 'Alice Wonder',
      picture: 'https://example.com/avatar.jpg',
      banner: 'https://example.com/banner.jpg',
      about: 'hello',
      website: 'https://example.com',
      bot: true,
      birthday: { year: 2000, month: 2, day: 29 },
      nip05: 'alice@example.com',
      lud06: 'lnurl1dp68gurn8ghj7mrww4exctn0d3skccn9dpkx2mrp0yh8g6t0d3h82unvwqhkjargd9skcmr0w4exctnv9uh8qatjws',
      lud16: 'alice@wallet.example',
    })
  })

  it('accepts deprecated aliases as read-time fallbacks but outputs canonical fields only', () => {
    const normalized = normalizeProfileMetadata({
      username: 'alice',
      displayName: 'Alice',
    })

    expect(normalized).toEqual({
      name: 'alice',
      display_name: 'Alice',
    })
  })

  it('accepts common avatar and banner aliases as read-time fallbacks', () => {
    const normalized = normalizeProfileMetadata({
      image: ' https://example.com/avatar.svg ',
      header: 'https://example.com/header.jfif',
    })

    expect(normalized).toEqual({
      picture: 'https://example.com/avatar.svg',
      banner: 'https://example.com/header.jfif',
    })
  })

  it('accepts additional common profile media alias variants', () => {
    const normalized = normalizeProfileMetadata({
      pictureUrl: 'https://example.com/avatar.heic',
      coverPhoto: 'https://example.com/banner.jxl',
    })

    expect(normalized).toEqual({
      picture: 'https://example.com/avatar.heic',
      banner: 'https://example.com/banner.jxl',
    })
  })

  it('drops invalid optional values', () => {
    expect(normalizeProfileMetadata({
      picture: 'http://example.com/avatar.jpg',
      website: 'javascript:alert(1)',
      birthday: { month: 2, day: 31 },
      lud16: 'not-an-address',
    })).toEqual({
      birthday: { month: 2 },
    })
  })
})

describe('buildProfileMetadataContent', () => {
  it('serializes canonical metadata without deprecated keys', () => {
    const content = buildProfileMetadataContent({
      display_name: 'Alice',
      website: 'https://example.com',
    } satisfies ProfileMetadata)

    expect(content).toBe(JSON.stringify({
      name: 'Alice',
      display_name: 'Alice',
      website: 'https://example.com',
    }))
  })
})

describe('parseProfileMetadataEvent', () => {
  it('parses kind-0 events into sanitized metadata', () => {
    const parsed = parseProfileMetadataEvent(baseEvent({
      content: JSON.stringify({
        name: 'alice',
        about: '<i>Hello</i>',
        bot: true,
      }),
    }))

    expect(parsed).not.toBeNull()
    expect(parsed?.metadata).toEqual({
      name: 'alice',
      about: 'Hello',
      bot: true,
    })
  })

  it('rejects malformed non-object content', () => {
    expect(parseProfileMetadataEvent(baseEvent({
      content: '"not-an-object"',
    }))).toBeNull()
  })
})

// ── publishProfileMetadata ──────────────────────────────────────

describe('publishProfileMetadata', () => {
  it('signs, publishes, inserts, and dispatches the profile-updated event', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    const result = await publishProfileMetadata({ name: 'alice' })

    expect(publishSpy).toHaveBeenCalledTimes(1)
    expect(insertEventMock).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'nostr-paper:profile-updated' }),
    )
    expect(result.kind).toBe(Kind.Metadata)
  })

  it('throws when no signer is available', async () => {
    getNDKMock.mockReturnValue({ signer: null } as never)

    await expect(
      publishProfileMetadata({ name: 'alice' }),
    ).rejects.toThrow('No signer available')
    expect(publishSpy).not.toHaveBeenCalled()
  })

  it('aborts before signing when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const err = await publishProfileMetadata(
      { name: 'alice' },
      { signal: controller.signal },
    ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(DOMException)
    expect((err as DOMException).name).toBe('AbortError')
    expect(publishSpy).not.toHaveBeenCalled()
  })

  it('does not insert event when publish fails', async () => {
    // publishSpy must propagate the rejection so NDKEvent.publish() actually throws.
    publishSpy.mockImplementation(() => { throw new Error('relay refused') })

    await expect(
      publishProfileMetadata({ name: 'alice' }),
    ).rejects.toThrow('relay refused')
    expect(insertEventMock).not.toHaveBeenCalled()
  })
})
