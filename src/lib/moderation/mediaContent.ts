import { getMediaAttachmentKind, getMediaAttachmentPreviewUrl, getMediaAttachmentSourceUrl } from '@/lib/nostr/imeta'
import { isSafeMediaURL } from '@/lib/security/sanitize'
import type { MediaModerationDocument, MediaModerationKind, Nip92MediaAttachment } from '@/types'

function normalizeMediaModerationUrl(url: string): string {
  return url.trim()
}

export function hashMediaModerationUrl(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

export function buildMediaModerationDocument(options: {
  id: string
  kind: MediaModerationKind
  url: string | null | undefined
  updatedAt?: number
}): MediaModerationDocument | null {
  const normalizedUrl = typeof options.url === 'string'
    ? normalizeMediaModerationUrl(options.url)
    : ''

  if (!normalizedUrl || !isSafeMediaURL(normalizedUrl)) return null

  return {
    id: options.id,
    kind: options.kind,
    url: normalizedUrl,
    updatedAt: options.updatedAt ?? 0,
  }
}

export function buildAttachmentMediaModerationDocument(
  attachment: Nip92MediaAttachment,
  options: {
    id?: string
    updatedAt?: number
  } = {},
): MediaModerationDocument | null {
  const kind = getMediaAttachmentKind(attachment)

  if (kind === 'image') {
    return buildMediaModerationDocument({
      id: options.id ?? attachment.url,
      kind: 'image',
      url: getMediaAttachmentPreviewUrl(attachment) ?? getMediaAttachmentSourceUrl(attachment),
      ...(options.updatedAt !== undefined ? { updatedAt: options.updatedAt } : {}),
    })
  }

  if (kind === 'video') {
    return buildMediaModerationDocument({
      id: options.id ?? attachment.url,
      kind: 'video_preview',
      url: attachment.image ?? attachment.thumb ?? attachment.imageFallbacks?.[0] ?? null,
      ...(options.updatedAt !== undefined ? { updatedAt: options.updatedAt } : {}),
    })
  }

  return null
}

export function getMediaModerationDocumentCacheKey(document: MediaModerationDocument): string {
  return `${document.updatedAt}:${hashMediaModerationUrl(document.url)}`
}
