import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { insertEvent } from '@/lib/db/nostr'
import { withOptionalClientTag } from '@/lib/nostr/appHandlers'
import { publishEventWithNip65Outbox } from '@/lib/nostr/outbox'
import { buildQuoteTagsFromContent } from '@/lib/nostr/repost'
import {
  isSafeMediaURL,
  isSafeURL,
  isValidHex32,
  sanitizeText,
} from '@/lib/security/sanitize'
import type { BlossomBlob, Nip94FileMetadata, Nip94Tags, NostrEvent } from '@/types'
import { Kind } from '@/types'

const MIME_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:\s*;\s*[a-z0-9!#$&^_.+-]+=[a-z0-9!#$&^_.+-]+)*$/i
const DIM_PATTERN = /^[1-9]\d{0,6}x[1-9]\d{0,6}$/
const TORRENT_INFOHASH_PATTERN = /^[a-f0-9]{40,64}$/i
const MAX_TEXT_CHARS = 1_000
const MAX_DESCRIPTION_CHARS = 4_000
const MAX_BLURHASH_CHARS = 200
const MAX_SERVICE_CHARS = 64

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeOptionalText(value: string | undefined, maxChars = MAX_TEXT_CHARS): string | undefined {
  if (typeof value !== 'string') return undefined
  const sanitized = sanitizeText(value).trim().slice(0, maxChars)
  return sanitized.length > 0 ? sanitized : undefined
}

function normalizeMimeType(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (normalized.length === 0 || normalized.length > 255) return null
  return MIME_TYPE_PATTERN.test(normalized) ? normalized : null
}

function normalizePositiveInteger(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined
  const numeric = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(numeric) || numeric < 0) return undefined
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

export interface NormalizeNip94Input {
  url: string
  mimeType: string
  fileHash: string
  originalHash?: string | undefined
  size?: number | string | undefined
  dim?: string | undefined
  magnet?: string | undefined
  torrentInfoHash?: string | undefined
  blurhash?: string | undefined
  thumb?: string | undefined
  thumbHash?: string | undefined
  image?: string | undefined
  imageHash?: string | undefined
  summary?: string | undefined
  alt?: string | undefined
  fallbacks?: string[] | undefined
  service?: string | undefined
}

export function normalizeNip94Tags(input: NormalizeNip94Input): Nip94Tags | null {
  if (!isSafeURL(input.url)) return null
  const mimeType = normalizeMimeType(input.mimeType)
  if (!mimeType) return null
  if (!isValidHex32(input.fileHash)) return null

  const originalHash = normalizeOptionalHash(input.originalHash)
  const size = normalizePositiveInteger(input.size)
  const dim = normalizeDim(input.dim)
  const magnet = normalizeMagnetUri(input.magnet)
  const torrentInfoHash = normalizeTorrentInfoHash(input.torrentInfoHash)
  const blurhash = sanitizeOptionalText(input.blurhash, MAX_BLURHASH_CHARS)
  const thumb = input.thumb && isSafeMediaURL(input.thumb) ? input.thumb : undefined
  const thumbHash = normalizeOptionalHash(input.thumbHash)
  const image = input.image && isSafeMediaURL(input.image) ? input.image : undefined
  const imageHash = normalizeOptionalHash(input.imageHash)
  const summary = sanitizeOptionalText(input.summary)
  const alt = sanitizeOptionalText(input.alt)
  const fallbacks = normalizeFallbackUrls(input.fallbacks)
  const service = sanitizeOptionalText(input.service, MAX_SERVICE_CHARS)

  return {
    url: input.url,
    mimeType,
    fileHash: input.fileHash,
    ...(originalHash ? { originalHash } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(dim ? { dim } : {}),
    ...(magnet ? { magnet } : {}),
    ...(torrentInfoHash ? { torrentInfoHash } : {}),
    ...(blurhash ? { blurhash } : {}),
    ...(thumb ? { thumb } : {}),
    ...(thumbHash ? { thumbHash } : {}),
    ...(image ? { image } : {}),
    ...(imageHash ? { imageHash } : {}),
    ...(summary ? { summary } : {}),
    ...(alt ? { alt } : {}),
    ...(fallbacks ? { fallbacks } : {}),
    ...(service ? { service } : {}),
  }
}

export interface BuildFileMetadataTagsOptions extends NormalizeNip94Input {
  description?: string
}

export function buildFileMetadataTags(metadata: Nip94Tags): string[][] {
  const tags: string[][] = [
    ['url', metadata.url],
    ['m', metadata.mimeType],
    ['x', metadata.fileHash],
  ]

  if (metadata.originalHash) tags.push(['ox', metadata.originalHash])
  if (metadata.size !== undefined) tags.push(['size', String(metadata.size)])
  if (metadata.dim) tags.push(['dim', metadata.dim])
  if (metadata.magnet) tags.push(['magnet', metadata.magnet])
  if (metadata.torrentInfoHash) tags.push(['i', metadata.torrentInfoHash])
  if (metadata.blurhash) tags.push(['blurhash', metadata.blurhash])
  if (metadata.thumb) {
    tags.push(metadata.thumbHash
      ? ['thumb', metadata.thumb, metadata.thumbHash]
      : ['thumb', metadata.thumb])
  }
  if (metadata.image) {
    tags.push(metadata.imageHash
      ? ['image', metadata.image, metadata.imageHash]
      : ['image', metadata.image])
  }
  if (metadata.summary) tags.push(['summary', metadata.summary])
  if (metadata.alt) tags.push(['alt', metadata.alt])
  for (const fallback of metadata.fallbacks ?? []) {
    tags.push(['fallback', fallback])
  }
  if (metadata.service) tags.push(['service', metadata.service])

  return tags
}

function getFirstTag(event: NostrEvent, name: string): string[] | undefined {
  return event.tags.find(tag => tag[0] === name && typeof tag[1] === 'string')
}

function getTagValues(event: NostrEvent, name: string): string[][] {
  return event.tags.filter(tag => tag[0] === name && typeof tag[1] === 'string')
}

export function parseFileMetadataEvent(event: NostrEvent): Nip94FileMetadata | null {
  if (event.kind !== Kind.FileMetadata) return null

  const urlTag = getFirstTag(event, 'url')
  const mimeTag = getFirstTag(event, 'm')
  const hashTag = getFirstTag(event, 'x')

  if (!urlTag?.[1] || !mimeTag?.[1] || !hashTag?.[1]) return null

  const thumbTag = getFirstTag(event, 'thumb')
  const imageTag = getFirstTag(event, 'image')

  const normalized = normalizeNip94Tags({
    url: urlTag[1],
    mimeType: mimeTag[1],
    fileHash: hashTag[1],
    ...(getFirstTag(event, 'ox')?.[1] ? { originalHash: getFirstTag(event, 'ox')?.[1] } : {}),
    ...(getFirstTag(event, 'size')?.[1] ? { size: getFirstTag(event, 'size')?.[1] } : {}),
    ...(getFirstTag(event, 'dim')?.[1] ? { dim: getFirstTag(event, 'dim')?.[1] } : {}),
    ...(getFirstTag(event, 'magnet')?.[1] ? { magnet: getFirstTag(event, 'magnet')?.[1] } : {}),
    ...(getFirstTag(event, 'i')?.[1] ? { torrentInfoHash: getFirstTag(event, 'i')?.[1] } : {}),
    ...(getFirstTag(event, 'blurhash')?.[1] ? { blurhash: getFirstTag(event, 'blurhash')?.[1] } : {}),
    ...(thumbTag?.[1] ? { thumb: thumbTag[1] } : {}),
    ...(thumbTag?.[2] ? { thumbHash: thumbTag[2] } : {}),
    ...(imageTag?.[1] ? { image: imageTag[1] } : {}),
    ...(imageTag?.[2] ? { imageHash: imageTag[2] } : {}),
    ...(getFirstTag(event, 'summary')?.[1] ? { summary: getFirstTag(event, 'summary')?.[1] } : {}),
    ...(getFirstTag(event, 'alt')?.[1] ? { alt: getFirstTag(event, 'alt')?.[1] } : {}),
    ...(getTagValues(event, 'fallback').length > 0
      ? { fallbacks: getTagValues(event, 'fallback').map(tag => tag[1]!).filter(Boolean) }
      : {}),
    ...(getFirstTag(event, 'service')?.[1] ? { service: getFirstTag(event, 'service')?.[1] } : {}),
  })

  if (!normalized) return null

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    description: sanitizeText(event.content).trim().slice(0, MAX_DESCRIPTION_CHARS),
    metadata: normalized,
  }
}

export async function deriveMediaDimensions(file: File | Blob): Promise<string | undefined> {
  if (typeof window === 'undefined' || typeof URL === 'undefined') return undefined
  if (!(file instanceof Blob)) return undefined

  if (file.type.startsWith('image/')) {
    const objectUrl = URL.createObjectURL(file)
    try {
      const dim = await new Promise<string | undefined>((resolve) => {
        const img = new Image()
        const timer = window.setTimeout(() => resolve(undefined), 5_000)
        img.onload = () => {
          window.clearTimeout(timer)
          resolve(
            img.naturalWidth > 0 && img.naturalHeight > 0
              ? `${img.naturalWidth}x${img.naturalHeight}`
              : undefined,
          )
        }
        img.onerror = () => {
          window.clearTimeout(timer)
          resolve(undefined)
        }
        img.src = objectUrl
      })
      return normalizeDim(dim)
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }

  if (file.type.startsWith('video/')) {
    const objectUrl = URL.createObjectURL(file)
    try {
      const dim = await new Promise<string | undefined>((resolve) => {
        const video = document.createElement('video')
        const timer = window.setTimeout(() => resolve(undefined), 5_000)
        video.preload = 'metadata'
        video.onloadedmetadata = () => {
          window.clearTimeout(timer)
          resolve(
            video.videoWidth > 0 && video.videoHeight > 0
              ? `${video.videoWidth}x${video.videoHeight}`
              : undefined,
          )
        }
        video.onerror = () => {
          window.clearTimeout(timer)
          resolve(undefined)
        }
        video.src = objectUrl
      })
      return normalizeDim(dim)
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }

  return undefined
}

export interface PublishFileMetadataOptions extends Partial<NormalizeNip94Input> {
  caption?: string
  signal?: AbortSignal
}

export async function publishFileMetadata(
  ndk: NDK,
  blob: BlossomBlob,
  options: PublishFileMetadataOptions = {},
): Promise<NostrEvent> {
  if (!ndk.signer) {
    throw new Error('No signer available — cannot publish kind-1063 metadata.')
  }

  const metadata = normalizeNip94Tags({
    url: options.url ?? blob.url,
    mimeType: options.mimeType ?? blob.type,
    fileHash: options.fileHash ?? blob.sha256,
    ...(options.originalHash ? { originalHash: options.originalHash } : {}),
    ...(options.size !== undefined ? { size: options.size } : { size: blob.size }),
    ...(options.dim ? { dim: options.dim } : {}),
    ...(options.magnet ? { magnet: options.magnet } : {}),
    ...(options.torrentInfoHash ? { torrentInfoHash: options.torrentInfoHash } : {}),
    ...(options.blurhash ? { blurhash: options.blurhash } : {}),
    ...(options.thumb ? { thumb: options.thumb } : {}),
    ...(options.thumbHash ? { thumbHash: options.thumbHash } : {}),
    ...(options.image ? { image: options.image } : {}),
    ...(options.imageHash ? { imageHash: options.imageHash } : {}),
    ...(options.summary ? { summary: options.summary } : {}),
    ...(options.alt ? { alt: options.alt } : {}),
    ...(options.fallbacks ? { fallbacks: options.fallbacks } : {}),
    ...(options.service ? { service: options.service } : {}),
  })

  if (!metadata) {
    throw new Error('Invalid NIP-94 metadata.')
  }

  const event = new NDKEvent(ndk)
  event.kind = Kind.FileMetadata
  const caption = sanitizeText(options.caption ?? '').trim().slice(0, MAX_DESCRIPTION_CHARS)
  event.content = caption
  event.tags = await withOptionalClientTag([
    ...buildFileMetadataTags(metadata),
    ...buildQuoteTagsFromContent(caption),
  ], options.signal)

  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  await event.sign()
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  await publishEventWithNip65Outbox(event, options.signal)

  const rawEvent = event.rawEvent() as unknown as NostrEvent
  await insertEvent(rawEvent)
  return rawEvent
}

export function normalizeNip94FromObject(
  input: unknown,
  defaults: Pick<NormalizeNip94Input, 'url' | 'mimeType' | 'fileHash'>,
): Nip94Tags | undefined {
  if (!isRecord(input)) return undefined

  const normalized = normalizeNip94Tags({
    url: typeof input.url === 'string' ? input.url : defaults.url,
    mimeType: typeof input.mimeType === 'string'
      ? input.mimeType
      : (typeof input.m === 'string' ? input.m : defaults.mimeType),
    fileHash: typeof input.fileHash === 'string'
      ? input.fileHash
      : (typeof input.x === 'string' ? input.x : defaults.fileHash),
    ...(typeof input.originalHash === 'string'
      ? { originalHash: input.originalHash }
      : (typeof input.ox === 'string' ? { originalHash: input.ox } : {})),
    ...(input.size !== undefined ? { size: input.size as number | string } : {}),
    ...(typeof input.dim === 'string' ? { dim: input.dim } : {}),
    ...(typeof input.magnet === 'string' ? { magnet: input.magnet } : {}),
    ...(typeof input.torrentInfoHash === 'string'
      ? { torrentInfoHash: input.torrentInfoHash }
      : (typeof input.i === 'string' ? { torrentInfoHash: input.i } : {})),
    ...(typeof input.blurhash === 'string' ? { blurhash: input.blurhash } : {}),
    ...(typeof input.thumb === 'string' ? { thumb: input.thumb } : {}),
    ...(typeof input.thumbHash === 'string' ? { thumbHash: input.thumbHash } : {}),
    ...(typeof input.image === 'string' ? { image: input.image } : {}),
    ...(typeof input.imageHash === 'string' ? { imageHash: input.imageHash } : {}),
    ...(typeof input.summary === 'string' ? { summary: input.summary } : {}),
    ...(typeof input.alt === 'string' ? { alt: input.alt } : {}),
    ...(Array.isArray(input.fallbacks)
      ? { fallbacks: input.fallbacks.filter((value): value is string => typeof value === 'string') }
      : (typeof input.fallback === 'string' ? { fallbacks: [input.fallback] } : {})),
    ...(typeof input.service === 'string' ? { service: input.service } : {}),
  })

  return normalized ?? undefined
}
