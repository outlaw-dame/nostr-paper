import {
  buildFileMetadataTags,
  normalizeNip94FromObject,
  normalizeNip94Tags,
  parseFileMetadataEvent,
} from './fileMetadata'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

function baseEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: Kind.FileMetadata,
    tags: [
      ['url', 'https://cdn.example.com/blob.jpg'],
      ['m', 'image/jpeg'],
      ['x', 'c'.repeat(64)],
    ],
    content: 'Sample image',
    sig: 'd'.repeat(128),
    ...overrides,
  }
}

describe('normalizeNip94Tags', () => {
  it('accepts compliant required and optional fields', () => {
    const tags = normalizeNip94Tags({
      url: 'https://cdn.example.com/blob.jpg',
      mimeType: 'image/jpeg',
      fileHash: 'c'.repeat(64),
      size: 1024,
      dim: '800x600',
      alt: 'Accessible description',
      fallbacks: ['https://backup.example.com/blob.jpg'],
    })

    expect(tags).toEqual({
      url: 'https://cdn.example.com/blob.jpg',
      mimeType: 'image/jpeg',
      fileHash: 'c'.repeat(64),
      size: 1024,
      dim: '800x600',
      alt: 'Accessible description',
      fallbacks: ['https://backup.example.com/blob.jpg'],
    })
  })

  it('rejects invalid required fields', () => {
    expect(normalizeNip94Tags({
      url: 'javascript:alert(1)',
      mimeType: 'image/jpeg',
      fileHash: 'c'.repeat(64),
    })).toBeNull()

    expect(normalizeNip94Tags({
      url: 'https://cdn.example.com/blob.jpg',
      mimeType: 'Image/JPEG',
      fileHash: 'short',
    })).toBeNull()
  })
})

describe('buildFileMetadataTags', () => {
  it('emits required tags first and preserves optional fallback tags', () => {
    const tags = buildFileMetadataTags({
      url: 'https://cdn.example.com/blob.jpg',
      mimeType: 'image/jpeg',
      fileHash: 'c'.repeat(64),
      size: 1024,
      thumb: 'https://cdn.example.com/thumb.jpg',
      thumbHash: 'e'.repeat(64),
      fallbacks: [
        'https://fallback-1.example.com/blob.jpg',
        'https://fallback-2.example.com/blob.jpg',
      ],
    })

    expect(tags.slice(0, 3)).toEqual([
      ['url', 'https://cdn.example.com/blob.jpg'],
      ['m', 'image/jpeg'],
      ['x', 'c'.repeat(64)],
    ])
    expect(tags).toContainEqual(['thumb', 'https://cdn.example.com/thumb.jpg', 'e'.repeat(64)])
    expect(tags).toContainEqual(['fallback', 'https://fallback-1.example.com/blob.jpg'])
    expect(tags).toContainEqual(['fallback', 'https://fallback-2.example.com/blob.jpg'])
  })
})

describe('parseFileMetadataEvent', () => {
  it('parses a compliant kind-1063 event', () => {
    const parsed = parseFileMetadataEvent(baseEvent({
      tags: [
        ['url', 'https://cdn.example.com/blob.jpg'],
        ['m', 'image/jpeg'],
        ['x', 'c'.repeat(64)],
        ['size', '2048'],
        ['dim', '800x600'],
        ['thumb', 'https://cdn.example.com/thumb.jpg', 'e'.repeat(64)],
        ['fallback', 'https://fallback.example.com/blob.jpg'],
        ['alt', 'Descriptive alt'],
      ],
    }))

    expect(parsed).not.toBeNull()
    expect(parsed?.description).toBe('Sample image')
    expect(parsed?.metadata.thumb).toBe('https://cdn.example.com/thumb.jpg')
    expect(parsed?.metadata.thumbHash).toBe('e'.repeat(64))
    expect(parsed?.metadata.fallbacks).toEqual(['https://fallback.example.com/blob.jpg'])
    expect(parsed?.metadata.size).toBe(2048)
  })

  it('rejects malformed file metadata events', () => {
    expect(parseFileMetadataEvent(baseEvent({ tags: [['m', 'image/jpeg']] }))).toBeNull()
  })
})

describe('normalizeNip94FromObject', () => {
  it('normalizes blossom-style nip94 objects with sane defaults', () => {
    const normalized = normalizeNip94FromObject({
      alt: 'Poster frame',
      dim: '1280x720',
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    }, {
      url: 'https://cdn.example.com/video.mp4',
      mimeType: 'video/mp4',
      fileHash: 'f'.repeat(64),
    })

    expect(normalized).toEqual({
      url: 'https://cdn.example.com/video.mp4',
      mimeType: 'video/mp4',
      fileHash: 'f'.repeat(64),
      alt: 'Poster frame',
      dim: '1280x720',
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    })
  })

  it('accepts a single fallback field from server metadata objects', () => {
    const normalized = normalizeNip94FromObject({
      fallback: 'https://fallback.example.com/video.mp4',
    }, {
      url: 'https://cdn.example.com/video.mp4',
      mimeType: 'video/mp4',
      fileHash: 'f'.repeat(64),
    })

    expect(normalized?.fallbacks).toEqual(['https://fallback.example.com/video.mp4'])
  })
})
