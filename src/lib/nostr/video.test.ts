import { describe, expect, it } from 'vitest'
import {
  decodeVideoAddress,
  getAddressableVideoNaddr,
  getPreferredVideoVariant,
  parseVideoEvent,
} from './video'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

function baseEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_710_000_000,
    kind: Kind.Video,
    tags: [
      ['title', 'Ocean walk'],
      [
        'imeta',
        'url https://media.example.com/video.mp4',
        'm video/mp4',
        `x ${'c'.repeat(64)}`,
        'dim 1920x1080',
        'image https://media.example.com/poster.jpg',
        'duration 63.5',
        'bitrate 2200000',
      ],
    ],
    content: 'Calm water at sunrise',
    sig: 'd'.repeat(128),
    ...overrides,
  }
}

describe('parseVideoEvent', () => {
  it('parses regular kind-21 video events', () => {
    const parsed = parseVideoEvent(baseEvent())

    expect(parsed).not.toBeNull()
    expect(parsed?.isAddressable).toBe(false)
    expect(parsed?.isShort).toBe(false)
    expect(parsed?.title).toBe('Ocean walk')
    expect(parsed?.summary).toBe('Calm water at sunrise')
    expect(parsed?.durationSeconds).toBe(63.5)
    expect(parsed?.route).toBe(`/video/${'a'.repeat(64)}`)
    expect(parsed?.variants).toHaveLength(1)
    expect(parsed?.variants[0]?.bitrate).toBe(2_200_000)
  })

  it('parses addressable short-video metadata including segments and tracks', () => {
    const event = baseEvent({
      kind: Kind.AddressableShortVideo,
      tags: [
        ['d', 'seaside-short'],
        ['title', 'Seaside Short'],
        ['published_at', '1710000001'],
        ['duration', '64'],
        ['t', 'nostr'],
        ['t', 'video'],
        ['p', 'e'.repeat(64), 'wss://relay.example.com'],
        ['r', 'https://example.com/source'],
        ['text-track', 'https://example.com/captions.vtt', 'subtitles', 'en'],
        ['segment', '00:00:00.000', '00:00:12.500', 'Intro', 'https://example.com/intro.jpg'],
        ['origin', 'youtube', 'abc123', 'https://youtube.example/watch?v=abc123', 'mirrored by author'],
        [
          'imeta',
          'url https://media.example.com/short.mp4',
          'm video/mp4',
          `x ${'f'.repeat(64)}`,
          'dim 1080x1920',
          'image https://media.example.com/poster.jpg',
          'image https://media.example.com/poster-2.jpg',
          'duration 64',
        ],
      ],
    })

    const parsed = parseVideoEvent(event)

    expect(parsed).not.toBeNull()
    expect(parsed?.isAddressable).toBe(true)
    expect(parsed?.isShort).toBe(true)
    expect(parsed?.identifier).toBe('seaside-short')
    expect(parsed?.route).toBe(`/video/short/${event.pubkey}/seaside-short`)
    expect(parsed?.hashtags).toEqual(['nostr', 'video'])
    expect(parsed?.participants).toEqual([
      { pubkey: 'e'.repeat(64), relayHint: 'wss://relay.example.com' },
    ])
    expect(parsed?.references).toEqual(['https://example.com/source'])
    expect(parsed?.textTracks[0]).toEqual({
      reference: 'https://example.com/captions.vtt',
      trackType: 'subtitles',
      language: 'en',
    })
    expect(parsed?.segments[0]?.startSeconds).toBe(0)
    expect(parsed?.segments[0]?.endSeconds).toBe(12.5)
    expect(parsed?.origin).toEqual({
      platform: 'youtube',
      externalId: 'abc123',
      originalUrl: 'https://youtube.example/watch?v=abc123',
      metadata: 'mirrored by author',
    })
    expect(parsed?.variants[0]?.image).toBe('https://media.example.com/poster.jpg')
    expect(parsed?.variants[0]?.imageFallbacks).toEqual(['https://media.example.com/poster-2.jpg'])
  })

  it('rejects video events without a title or playable variants', () => {
    expect(parseVideoEvent(baseEvent({ tags: [] }))).toBeNull()
    expect(parseVideoEvent(baseEvent({
      tags: [['title', 'Untitled'], ['imeta', 'url https://example.com/file.txt', 'm text/plain']],
    }))).toBeNull()
  })
})

describe('video address helpers', () => {
  it('round-trips addressable video naddrs', () => {
    const naddr = getAddressableVideoNaddr('b'.repeat(64), 'clip-1', true)
    expect(decodeVideoAddress(naddr)).toEqual({
      pubkey: 'b'.repeat(64),
      identifier: 'clip-1',
      isShort: true,
    })
  })
})

describe('getPreferredVideoVariant', () => {
  it('prefers higher resolution variants before bitrate', () => {
    const parsed = parseVideoEvent(baseEvent({
      tags: [
        ['title', 'Two variants'],
        ['imeta', 'url https://media.example.com/low.mp4', 'm video/mp4', `x ${'1'.repeat(64)}`, 'dim 640x360', 'bitrate 400000'],
        ['imeta', 'url https://media.example.com/high.mp4', 'm video/mp4', `x ${'2'.repeat(64)}`, 'dim 1920x1080', 'bitrate 900000'],
      ],
    }))

    expect(parsed).not.toBeNull()
    expect(getPreferredVideoVariant(parsed! as NonNullable<typeof parsed>)?.url).toBe('https://media.example.com/high.mp4')
  })
})
