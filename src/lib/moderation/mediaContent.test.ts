import { describe, expect, it } from 'vitest'
import {
  buildAttachmentMediaModerationDocument,
  buildMediaModerationDocument,
  getMediaModerationDocumentCacheKey,
} from '@/lib/moderation/mediaContent'

describe('media moderation content', () => {
  it('builds safe image moderation documents', () => {
    const document = buildMediaModerationDocument({
      id: 'image-1',
      kind: 'image',
      url: 'https://cdn.example.com/photo.jpg',
      updatedAt: 10,
    })

    expect(document).toEqual({
      id: 'image-1',
      kind: 'image',
      url: 'https://cdn.example.com/photo.jpg',
      updatedAt: 10,
    })
  })

  it('rejects unsafe media urls', () => {
    expect(buildMediaModerationDocument({
      id: 'image-2',
      kind: 'image',
      url: 'javascript:alert(1)',
    })).toBeNull()
  })

  it('uses preview images for video attachments', () => {
    const document = buildAttachmentMediaModerationDocument({
      url: 'https://cdn.example.com/video.mp4',
      mimeType: 'video/mp4',
      thumb: 'https://cdn.example.com/video-thumb.jpg',
      source: 'imeta',
    })

    expect(document?.kind).toBe('video_preview')
    expect(document?.url).toBe('https://cdn.example.com/video-thumb.jpg')
  })

  it('uses stable cache keys for equivalent urls', () => {
    const a = buildMediaModerationDocument({
      id: 'a',
      kind: 'image',
      url: 'https://cdn.example.com/photo.jpg',
      updatedAt: 5,
    })
    const b = buildMediaModerationDocument({
      id: 'b',
      kind: 'profile_avatar',
      url: 'https://cdn.example.com/photo.jpg',
      updatedAt: 5,
    })

    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(getMediaModerationDocumentCacheKey(a!)).toBe(getMediaModerationDocumentCacheKey(b!))
  })
})
