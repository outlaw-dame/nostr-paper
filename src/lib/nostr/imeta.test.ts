import { describe, expect, it } from 'vitest'
import {
  canRenderMediaAttachmentInline,
  buildNip92ImetaTag,
  getEventMediaAttachments,
  getImetaHiddenUrls,
  getMediaAttachmentKind,
  getMediaAttachmentPreviewUrl,
  parseNip92MediaAttachments,
} from './imeta'
import type { Nip94Tags, NostrEvent } from '@/types'
import { Kind } from '@/types'

function baseEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: Kind.ShortNote,
    tags: [],
    content: '',
    sig: 'c'.repeat(128),
    ...overrides,
  }
}

describe('buildNip92ImetaTag', () => {
  it('builds an imeta tag from NIP-94 metadata', () => {
    const metadata: Nip94Tags = {
      url: 'https://cdn.example.com/image.jpg',
      mimeType: 'image/jpeg',
      fileHash: 'd'.repeat(64),
      dim: '1200x900',
      alt: 'A scenic test image',
      fallbacks: ['https://fallback.example.com/image.jpg'],
    }

    expect(buildNip92ImetaTag(metadata)).toEqual([
      'imeta',
      'url https://cdn.example.com/image.jpg',
      'm image/jpeg',
      `x ${'d'.repeat(64)}`,
      'dim 1200x900',
      'alt A scenic test image',
      'fallback https://fallback.example.com/image.jpg',
    ])
  })
})

describe('parseNip92MediaAttachments', () => {
  it('parses valid imeta tags that match URLs in content', () => {
    const event = baseEvent({
      content: 'first https://cdn.example.com/one.jpg second https://cdn.example.com/two.mp4',
      tags: [
        ['imeta', 'url https://cdn.example.com/two.mp4', 'm video/mp4', 'thumb https://cdn.example.com/two.jpg'],
        ['imeta', 'url https://cdn.example.com/one.jpg', 'm image/jpeg', 'alt Poster frame'],
        ['imeta', 'url https://cdn.example.com/missing.jpg', 'm image/jpeg'],
      ],
    })

    const attachments = parseNip92MediaAttachments(event)

    expect(attachments).toHaveLength(2)
    expect(attachments[0]?.url).toBe('https://cdn.example.com/one.jpg')
    expect(attachments[1]?.url).toBe('https://cdn.example.com/two.mp4')
    expect(attachments[1]?.thumb).toBe('https://cdn.example.com/two.jpg')
  })

  it('falls back to bare media URLs when no imeta tags exist', () => {
    const event = baseEvent({
      content: 'Look https://cdn.example.com/photo.webp',
    })

    const attachments = getEventMediaAttachments(event)

    expect(attachments).toEqual([
      {
        url: 'https://cdn.example.com/photo.webp',
        mimeType: 'image/webp',
        source: 'url',
      },
    ])
  })

  it('returns hidden URLs only for valid imeta attachments', () => {
    const event = baseEvent({
      content: 'https://cdn.example.com/photo.jpg',
      tags: [
        ['imeta', 'url https://cdn.example.com/photo.jpg', 'alt Cover image'],
      ],
    })

    expect(getImetaHiddenUrls(event)).toEqual(['https://cdn.example.com/photo.jpg'])
  })

  it('keeps non-renderable page attachments visible in note content', () => {
    const event = baseEvent({
      content: 'https://www.youtube.com/watch?v=abc123',
      tags: [
        [
          'imeta',
          'url https://www.youtube.com/watch?v=abc123',
          'image https://i.ytimg.com/vi/abc123/hqdefault.jpg',
          'duration 42',
        ],
      ],
    })

    const [attachment] = getEventMediaAttachments(event)

    expect(attachment).toBeTruthy()
    if (!attachment) throw new Error('Expected attachment')
    expect(getMediaAttachmentKind(attachment)).toBe('video')
    expect(canRenderMediaAttachmentInline(attachment)).toBe(false)
    expect(getImetaHiddenUrls(event)).toEqual([])
  })
})

describe('attachment helpers', () => {
  it('derives preview kind and preview URL from attachment metadata', () => {
    const attachment = {
      url: 'https://cdn.example.com/video.mp4',
      mimeType: 'video/mp4',
      thumb: 'https://cdn.example.com/video.jpg',
      source: 'imeta' as const,
    }

    expect(getMediaAttachmentKind(attachment)).toBe('video')
    expect(getMediaAttachmentPreviewUrl(attachment)).toBe('https://cdn.example.com/video.jpg')
  })

  it('infers image attachments from metadata when the source URL is extensionless', () => {
    const attachment = {
      url: 'https://cdn.example.com/blob/8f4b9a8f4b9a8f4b9a8f4b9a8f4b9a8f',
      dim: '1200x900',
      source: 'imeta' as const,
    }

    expect(getMediaAttachmentKind(attachment)).toBe('image')
  })

  it('infers video attachments from duration metadata even without a file extension', () => {
    const attachment = {
      url: 'https://cdn.example.com/blob/video-source',
      durationSeconds: 42,
      image: 'https://cdn.example.com/blob/video-preview',
      source: 'imeta' as const,
    }

    expect(getMediaAttachmentKind(attachment)).toBe('video')
    expect(getMediaAttachmentPreviewUrl(attachment)).toBe('https://cdn.example.com/blob/video-preview')
  })

  it('does not treat non-media page URLs as image previews just because they have dimensions', () => {
    const attachment = {
      url: 'https://www.youtube.com/watch?v=abc123',
      dim: '1280x720',
      source: 'imeta' as const,
    }

    expect(getMediaAttachmentKind(attachment)).toBe('image')
    expect(getMediaAttachmentPreviewUrl(attachment)).toBeNull()
    expect(canRenderMediaAttachmentInline(attachment)).toBe(false)
  })
})
