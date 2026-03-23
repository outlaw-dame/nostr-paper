import {
  buildProfileMetadataContent,
  normalizeProfileMetadata,
  parseProfileMetadataEvent,
} from './metadata'
import type { NostrEvent, ProfileMetadata } from '@/types'
import { Kind } from '@/types'

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
