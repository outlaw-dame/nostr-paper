import { buildAttachmentPlaybackPlan, buildPlaybackSourceList } from '@/lib/media/playback'
import { extractMediaURLs, extractURLs, isSafeMediaURL, isSafeURL, isValidHex32, sanitizeText, stripUrlTrailingPunct } from '@/lib/security/sanitize'
import type { Nip92MediaAttachment, Nip94Tags, NostrEvent } from '@/types'

const MIME_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:\s*;\s*[a-z0-9!#$&^_.+-]+=[a-z0-9!#$&^_.+-]+)*$/i
const DIM_PATTERN = /^[1-9]\d{0,6}x[1-9]\d{0,6}$/
const TORRENT_INFOHASH_PATTERN = /^[a-f0-9]{40,64}$/i
const MAX_TEXT_CHARS = 1_000
const MAX_BLURHASH_CHARS = 200
const MAX_SERVICE_CHARS = 64
const MAX_IMAGE_CANDIDATES = 8
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi

export type MediaAttachmentKind = 'image' | 'video' | 'audio' | 'file'

export function getYouTubeVideoId(url: string): string | null {
  if (!url) return null
  const match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?\/\s]{11})/i)
  return match?.[1] ?? null
}

export function getVimeoVideoId(url: string): string | null {
  if (!url) return null
  const match = url.match(/(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(?:(?:channels\/[a-zA-Z0-9]+\/)|(?:groups\/[a-zA-Z0-9]+\/videos\/))?([0-9]+)/)
  return match?.[1] ?? null
}

export function getPeerTubeEmbedUrl(url: string): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const match = u.pathname.match(/^\/(?:w|videos\/watch)\/([a-zA-Z0-9-]+)$/)
    if (match) {
      return `${u.origin}/videos/embed/${match[1]}`
    }
  } catch {
    return null
  }
  return null
}

function sanitizeOptionalText(value: string | undefined, maxChars = MAX_TEXT_CHARS): string | undefined {
  if (typeof value !== 'string') return undefined
  const sanitized = sanitizeText(value).trim().slice(0, maxChars)
  return sanitized.length > 0 ? sanitized : undefined
}

function normalizeMimeType(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized.length === 0 || normalized.length > 255) return undefined
  return MIME_TYPE_PATTERN.test(normalized) ? normalized : undefined
}

function normalizePositiveInteger(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined
  const numeric = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(numeric) || numeric < 0) return undefined
  return numeric
}

function normalizePositiveNumber(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined
  const numeric = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined
  return numeric
}

function normalizeDim(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return DIM_PATTERN.test(normalized) ? normalized : undefined
}

function normalizeMagnetUri(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.startsWith('magnet:?') ? normalized : undefined
}

function normalizeTorrentInfoHash(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return TORRENT_INFOHASH_PATTERN.test(normalized) ? normalized : undefined
}

function normalizeOptionalHash(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  return isValidHex32(value) ? value : undefined
}

function normalizeFallbackUrls(urls: string[] | undefined): string[] | undefined {
  if (!Array.isArray(urls) || urls.length === 0) return undefined
  const deduped = [...new Set(
    urls.filter((url): url is string => typeof url === 'string' && isSafeURL(url)),
  )]
  return deduped.length > 0 ? deduped : undefined
}

function getContentUrlPositions(content: string): Map<string, number> {
  const positions = new Map<string, number>()
  let match: RegExpExecArray | null

  while ((match = URL_REGEX.exec(content)) !== null) {
    const url = stripUrlTrailingPunct(match[0])
    if (!positions.has(url) && isSafeURL(url)) {
      positions.set(url, match.index)
    }
  }

  return positions
}

function parsePair(value: string): { key: string; value: string } | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null

  const separator = trimmed.search(/\s/)
  if (separator <= 0) return null

  const key = trimmed.slice(0, separator).trim().toLowerCase()
  const pairValue = trimmed.slice(separator + 1).trim()
  if (pairValue.length === 0) return null

  return { key, value: pairValue }
}

function inferMimeTypeFromUrl(url: string): string | undefined {
  try {
    const path = new URL(url).pathname.toLowerCase()
    const extension = path.split('.').pop() ?? ''

    switch (extension) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg'
      case 'png':
        return 'image/png'
      case 'gif':
        return 'image/gif'
      case 'webp':
        return 'image/webp'
      case 'avif':
        return 'image/avif'
      case 'mp4':
        return 'video/mp4'
      case 'webm':
        return 'video/webm'
      case 'mov':
        return 'video/quicktime'
      case 'mp3':
        return 'audio/mpeg'
      case 'ogg':
        return 'audio/ogg'
      case 'flac':
        return 'audio/flac'
      default:
        return undefined
    }
  } catch {
    return undefined
  }
}

function inferAttachmentMimeType(attachment: Nip92MediaAttachment): string | undefined {
  const direct = attachment.mimeType ?? inferMimeTypeFromUrl(attachment.url)
  if (direct) return direct

  for (const candidate of attachment.fallbacks ?? []) {
    const inferred = inferMimeTypeFromUrl(candidate)
    if (inferred) return inferred
  }

  return undefined
}

function hasOpaqueMediaPath(url: string): boolean {
  try {
    const lastSegment = new URL(url).pathname
      .split('/').filter(Boolean).pop() ?? ''
    return !lastSegment.includes('.') && /^[A-Za-z0-9]{16,}$/.test(lastSegment)
  } catch {
    return false
  }
}

function isLikelyRenderableImageUrl(
  url: string,
  allowOpaquePath = true,
): boolean {
  if (!isSafeMediaURL(url)) return false

  const inferred = inferMimeTypeFromUrl(url)
  if (inferred?.startsWith('image/')) return true

  return allowOpaquePath && hasOpaqueMediaPath(url)
}

export function parseImetaMediaAttachment(tag: string[]): Nip92MediaAttachment | null {
  if (tag[0] !== 'imeta' || tag.length < 3) return null

  let url: string | undefined
  let mimeType: string | undefined
  let fileHash: string | undefined
  let originalHash: string | undefined
  let size: number | undefined
  let dim: string | undefined
  let magnet: string | undefined
  let torrentInfoHash: string | undefined
  let blurhash: string | undefined
  let thumb: string | undefined
  const images: string[] = []
  let summary: string | undefined
  let alt: string | undefined
  let service: string | undefined
  let durationSeconds: number | undefined
  let bitrate: number | undefined
  const fallbacks: string[] = []
  let validFieldCount = 0

  for (const rawEntry of tag.slice(1)) {
    if (typeof rawEntry !== 'string') continue
    const entry = parsePair(rawEntry)
    if (!entry) continue

    switch (entry.key) {
      case 'url':
        if (!url && isSafeURL(entry.value)) {
          url = entry.value
        }
        break
      case 'm': {
        const normalized = normalizeMimeType(entry.value)
        if (normalized && !mimeType) {
          mimeType = normalized
          validFieldCount += 1
        }
        break
      }
      case 'x': {
        const normalized = normalizeOptionalHash(entry.value)
        if (normalized && !fileHash) {
          fileHash = normalized
          validFieldCount += 1
        }
        break
      }
      case 'ox': {
        const normalized = normalizeOptionalHash(entry.value)
        if (normalized && !originalHash) {
          originalHash = normalized
          validFieldCount += 1
        }
        break
      }
      case 'size': {
        const normalized = normalizePositiveInteger(entry.value)
        if (normalized !== undefined && size === undefined) {
          size = normalized
          validFieldCount += 1
        }
        break
      }
      case 'dim': {
        const normalized = normalizeDim(entry.value)
        if (normalized && !dim) {
          dim = normalized
          validFieldCount += 1
        }
        break
      }
      case 'magnet': {
        const normalized = normalizeMagnetUri(entry.value)
        if (normalized && !magnet) {
          magnet = normalized
          validFieldCount += 1
        }
        break
      }
      case 'i': {
        const normalized = normalizeTorrentInfoHash(entry.value)
        if (normalized && !torrentInfoHash) {
          torrentInfoHash = normalized
          validFieldCount += 1
        }
        break
      }
      case 'blurhash': {
        const normalized = sanitizeOptionalText(entry.value, MAX_BLURHASH_CHARS)
        if (normalized && !blurhash) {
          blurhash = normalized
          validFieldCount += 1
        }
        break
      }
      case 'thumb':
        if (!thumb && isSafeMediaURL(entry.value)) {
          thumb = entry.value
          validFieldCount += 1
        }
        break
      case 'image':
        if (
          images.length < MAX_IMAGE_CANDIDATES &&
          isSafeMediaURL(entry.value) &&
          !images.includes(entry.value)
        ) {
          images.push(entry.value)
          validFieldCount += 1
        }
        break
      case 'summary': {
        const normalized = sanitizeOptionalText(entry.value)
        if (normalized && !summary) {
          summary = normalized
          validFieldCount += 1
        }
        break
      }
      case 'alt': {
        const normalized = sanitizeOptionalText(entry.value)
        if (normalized && !alt) {
          alt = normalized
          validFieldCount += 1
        }
        break
      }
      case 'fallback':
        if (isSafeURL(entry.value) && !fallbacks.includes(entry.value)) {
          fallbacks.push(entry.value)
          validFieldCount += 1
        }
        break
      case 'service': {
        const normalized = sanitizeOptionalText(entry.value, MAX_SERVICE_CHARS)
        if (normalized && !service) {
          service = normalized
          validFieldCount += 1
        }
        break
      }
      case 'duration': {
        const normalized = normalizePositiveNumber(entry.value)
        if (normalized !== undefined && durationSeconds === undefined) {
          durationSeconds = normalized
          validFieldCount += 1
        }
        break
      }
      case 'bitrate': {
        const normalized = normalizePositiveNumber(entry.value)
        if (normalized !== undefined && bitrate === undefined) {
          bitrate = normalized
          validFieldCount += 1
        }
        break
      }
    }
  }

  if (!url || validFieldCount === 0) {
    return null
  }

  const [image, ...imageFallbacks] = images

  return {
    url,
    ...(mimeType ? { mimeType } : {}),
    ...(fileHash ? { fileHash } : {}),
    ...(originalHash ? { originalHash } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(dim ? { dim } : {}),
    ...(magnet ? { magnet } : {}),
    ...(torrentInfoHash ? { torrentInfoHash } : {}),
    ...(blurhash ? { blurhash } : {}),
    ...(thumb ? { thumb } : {}),
    ...(image ? { image } : {}),
    ...(imageFallbacks.length > 0 ? { imageFallbacks } : {}),
    ...(summary ? { summary } : {}),
    ...(alt ? { alt } : {}),
    ...(fallbacks.length > 0 ? { fallbacks } : {}),
    ...(service ? { service } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(bitrate !== undefined ? { bitrate } : {}),
    source: 'imeta',
  }
}

function parseImetaTag(tag: string[], contentUrls: Map<string, number>): Nip92MediaAttachment | null {
  const attachment = parseImetaMediaAttachment(tag)
  if (!attachment || !contentUrls.has(attachment.url)) return null
  return attachment
}

function attachmentOrder(contentUrls: Map<string, number>, url: string): number {
  return contentUrls.get(url) ?? Number.MAX_SAFE_INTEGER
}

function buildFallbackAttachment(url: string): Nip92MediaAttachment {
  const mimeType = inferMimeTypeFromUrl(url)
  return {
    url,
    ...(mimeType ? { mimeType } : {}),
    source: 'url',
  }
}

export function buildNip92ImetaTag(metadata: Nip94Tags): string[] | null {
  const entries = [
    `url ${metadata.url}`,
    `m ${metadata.mimeType}`,
    `x ${metadata.fileHash}`,
    ...(metadata.originalHash ? [`ox ${metadata.originalHash}`] : []),
    ...(metadata.size !== undefined ? [`size ${metadata.size}`] : []),
    ...(metadata.dim ? [`dim ${metadata.dim}`] : []),
    ...(metadata.magnet ? [`magnet ${metadata.magnet}`] : []),
    ...(metadata.torrentInfoHash ? [`i ${metadata.torrentInfoHash}`] : []),
    ...(metadata.blurhash ? [`blurhash ${metadata.blurhash}`] : []),
    ...(metadata.thumb ? [`thumb ${metadata.thumb}`] : []),
    ...(metadata.image ? [`image ${metadata.image}`] : []),
    ...(metadata.summary ? [`summary ${metadata.summary}`] : []),
    ...(metadata.alt ? [`alt ${metadata.alt}`] : []),
    ...((metadata.fallbacks ?? []).map((fallback) => `fallback ${fallback}`)),
    ...(metadata.service ? [`service ${metadata.service}`] : []),
  ]

  return entries.length >= 2 ? ['imeta', ...entries] : null
}

export function buildNip92ImetaTags(metadataList: Nip94Tags[]): string[][] {
  const seen = new Set<string>()
  const tags: string[][] = []

  for (const metadata of metadataList) {
    if (seen.has(metadata.url)) continue
    const tag = buildNip92ImetaTag(metadata)
    if (!tag) continue
    seen.add(metadata.url)
    tags.push(tag)
  }

  return tags
}

export function parseNip92MediaAttachments(event: NostrEvent): Nip92MediaAttachment[] {
  const contentUrls = getContentUrlPositions(event.content)
  if (contentUrls.size === 0) return []

  const seen = new Set<string>()
  const attachments: Nip92MediaAttachment[] = []

  for (const tag of event.tags) {
    const attachment = parseImetaTag(tag, contentUrls)
    if (!attachment || seen.has(attachment.url)) continue
    seen.add(attachment.url)
    attachments.push(attachment)
  }

  return attachments.sort((left, right) => (
    attachmentOrder(contentUrls, left.url) - attachmentOrder(contentUrls, right.url)
  ))
}

export function getEventMediaAttachments(event: NostrEvent): Nip92MediaAttachment[] {
  const contentUrls = getContentUrlPositions(event.content)
  const attachments = parseNip92MediaAttachments(event)
  const seen = new Set(attachments.map((attachment) => attachment.url))

  for (const url of extractMediaURLs(event.content)) {
    if (seen.has(url)) continue
    if (!contentUrls.has(url)) continue
    attachments.push(buildFallbackAttachment(url))
    seen.add(url)
  }

  return attachments.sort((left, right) => (
    attachmentOrder(contentUrls, left.url) - attachmentOrder(contentUrls, right.url)
  ))
}

export function getImetaHiddenUrls(event: NostrEvent): string[] {
  // Hide only the URLs we can actually render inline. Non-renderable links
  // should remain in the note body so LinkPreviewCard can surface them.
  return getEventMediaAttachments(event)
    .filter((attachment) => canRenderMediaAttachmentInline(attachment))
    .map((attachment) => attachment.url)
}

export function getMediaAttachmentKind(attachment: Nip92MediaAttachment): MediaAttachmentKind {
  const mimeType = inferAttachmentMimeType(attachment)

  if (mimeType?.startsWith('image/')) return 'image'
  if (mimeType?.startsWith('video/')) return 'video'
  if (mimeType?.startsWith('audio/')) return 'audio'

  if (attachment.durationSeconds !== undefined || attachment.bitrate !== undefined) {
    return attachment.dim || attachment.image || attachment.thumb ? 'video' : 'audio'
  }

  if (attachment.image || attachment.thumb || (attachment.imageFallbacks?.length ?? 0) > 0) {
    return 'image'
  }

  if (attachment.dim) {
    return 'image'
  }

  // Extensionless CDN/Blossom URLs: only assume image when the final path segment
  // looks like a hash or opaque ID (all alphanumeric, ≥16 chars, no hyphens).
  // This matches Blossom SHA-256 hashes, IPFS CIDs, etc. while excluding
  // tracking/redirect URLs like /t/j-e-ydihdyjl-jtlliymdh-r/ that happen to
  // have no file extension.
  if (hasOpaqueMediaPath(attachment.url)) return 'image'

  for (const candidate of attachment.fallbacks ?? []) {
    if (hasOpaqueMediaPath(candidate)) return 'image'
  }

  return 'file'
}

export function getMediaAttachmentPreviewUrl(attachment: Nip92MediaAttachment): string | null {
  const kind = getMediaAttachmentKind(attachment)

  // Prioritize explicit preview fields first (thumb, image, etc.)
  const previewCandidates = [
    attachment.image,
    ...(attachment.imageFallbacks ?? []),
    attachment.thumb,
    // Generate YouTube thumbnail if applicable
    (() => {
      const ytId = getYouTubeVideoId(attachment.url)
      return ytId ? `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg` : undefined
    })(),
  ]

  for (const candidate of previewCandidates) {
    if (typeof candidate === 'string' && isSafeMediaURL(candidate)) {
      return candidate
    }
  }

  // If the attachment is an image and we have no explicit preview,
  // treat the source URL itself as the preview. This is more aggressive
  // and prevents images from degrading to generic file cards.
  if (kind === 'image') {
    const sourceUrl = getMediaAttachmentSourceUrl(attachment)
    if (sourceUrl && isLikelyRenderableImageUrl(sourceUrl)) {
      return sourceUrl
    }
  }

  return null
}

export function getMediaAttachmentSourceUrl(attachment: Nip92MediaAttachment): string | null {
  const candidates = [attachment.url, ...(attachment.fallbacks ?? [])]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && isSafeURL(candidate)) {
      return candidate
    }
  }

  return null
}

export function canRenderMediaAttachmentInline(attachment: Nip92MediaAttachment): boolean {
  const kind = getMediaAttachmentKind(attachment)

  if (kind === 'image') {
    return getMediaAttachmentPreviewUrl(attachment) !== null
  }

  if (kind === 'video' || kind === 'audio') {
    const playbackSources = buildPlaybackSourceList(kind, attachment)
    const hasTypedSource = playbackSources.some((source) => typeof source.type === 'string' && source.type.length > 0)
    if (!hasTypedSource) return false

    const playbackPlan = buildAttachmentPlaybackPlan(attachment, kind)
    return playbackPlan.playability !== 'unsupported' && playbackPlan.sources.length > 0
  }

  return false
}

export function hasRenderableImeta(event: NostrEvent): boolean {
  return getEventMediaAttachments(event).some((attachment) => canRenderMediaAttachmentInline(attachment))
}

export function getEventContentUrls(event: NostrEvent): string[] {
  return extractURLs(event.content)
}
