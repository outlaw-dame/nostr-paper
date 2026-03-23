import { describe, expect, it } from 'vitest'
import {
  getPrimaryStorySourceUrl,
  getStoryHostname,
  isArticleStoryKind,
  isVideoStoryKind,
  pickStorySummary,
} from './storyPreview'
import type { ParsedVideoEvent } from './video'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

function baseEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_710_000_000,
    kind: Kind.LongFormContent,
    tags: [['d', 'story']],
    content: '',
    sig: 'c'.repeat(128),
    ...overrides,
  }
}

function baseVideo(overrides: Partial<ParsedVideoEvent> = {}): ParsedVideoEvent {
  return {
    id: 'v'.repeat(64),
    pubkey: 'p'.repeat(64),
    kind: Kind.Video,
    isShort: false,
    isAddressable: false,
    title: 'Seaside walk',
    summary: 'A calm coastal walk.',
    hashtags: [],
    participants: [],
    references: [],
    textTracks: [],
    segments: [],
    variants: [],
    route: '/video/test',
    ...overrides,
  }
}

describe('getPrimaryStorySourceUrl', () => {
  it('prefers a video origin URL ahead of references and content links', () => {
    const event = baseEvent({
      kind: Kind.Video,
      tags: [['r', 'https://example.com/reference']],
      content: 'https://example.com/content-link',
    })

    const video = baseVideo({
      origin: {
        platform: 'youtube',
        externalId: 'abc123',
        originalUrl: 'https://youtube.com/watch?v=abc123',
      },
      references: ['https://example.com/reference'],
    })

    expect(getPrimaryStorySourceUrl(event, video)).toBe('https://youtube.com/watch?v=abc123')
  })

  it('prefers safe non-media tag URLs before direct media files', () => {
    const event = baseEvent({
      tags: [
        ['d', 'story'],
        ['r', 'https://cdn.example.com/cover.jpg'],
        ['source', 'https://techcrunch.com/example-story'],
      ],
      content: 'https://example.com/extra-context',
    })

    expect(getPrimaryStorySourceUrl(event, null)).toBe('https://techcrunch.com/example-story')
  })

  it('falls back to non-media URLs embedded in the body', () => {
    const event = baseEvent({
      content: 'Read more at https://example.com/story and see https://cdn.example.com/image.jpg',
    })

    expect(getPrimaryStorySourceUrl(event, null)).toBe('https://example.com/story')
  })
})

describe('pickStorySummary', () => {
  it('uses the external description when the local summary is only a URL', () => {
    expect(pickStorySummary(
      'https://techcrunch.com/example-story',
      'https://techcrunch.com/example-story',
      'Funding news from TechCrunch.',
    )).toBe('Funding news from TechCrunch.')
  })

  it('keeps a real local summary when present', () => {
    expect(pickStorySummary(
      'A longer local summary.',
      'https://example.com/story',
      'External summary.',
    )).toBe('A longer local summary.')
  })
})

describe('story preview helpers', () => {
  it('normalizes hostnames and story kinds', () => {
    expect(getStoryHostname('https://www.techcrunch.com/example-story')).toBe('techcrunch.com')
    expect(isArticleStoryKind(Kind.LongFormContent)).toBe(true)
    expect(isVideoStoryKind(Kind.AddressableShortVideo)).toBe(true)
  })
})
