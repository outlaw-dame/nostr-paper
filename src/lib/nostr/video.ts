import { NDKEvent } from '@nostr-dev-kit/ndk'
import { decodeNostrURI, naddrEncode } from 'nostr-tools/nip19'
import { insertEvent } from '@/lib/db/nostr'
import { normalizeAddressIdentifier } from '@/lib/nostr/addressable'
import { withOptionalClientTag } from '@/lib/nostr/appHandlers'
import { parseContentWarning } from '@/lib/nostr/contentWarning'
import { normalizeNip94Tags } from '@/lib/nostr/fileMetadata'
import { parseImetaMediaAttachment } from '@/lib/nostr/imeta'
import { getNDK } from '@/lib/nostr/ndk'
import { publishEventWithNip65Outbox } from '@/lib/nostr/outbox'
import {
  isSafeMediaURL,
  isSafeURL,
  isValidHex32,
  normalizeHashtag,
  sanitizeText,
} from '@/lib/security/sanitize'
import type { Nip92MediaAttachment, NostrEvent } from '@/types'
import { Kind } from '@/types'

const MAX_TITLE_CHARS = 300
const MAX_SUMMARY_CHARS = 4_000
const MAX_ALT_CHARS = 1_000
const MAX_IDENTIFIER_CHARS = 512
const MAX_REFERENCE_URLS = 32
const MAX_HASHTAGS = 32
const MAX_PARTICIPANTS = 32
const MAX_TEXT_TRACKS = 24
const MAX_SEGMENTS = 256
const MAX_ORIGIN_FIELD_CHARS = 512
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/u
const HLS_MIME_TYPES = new Set([
  'application/x-mpegurl',
  'application/vnd.apple.mpegurl',
])
const MEDIA_PLAYLIST_EXTENSIONS = ['.m3u8', '.mpd']
const TIMESTAMP_PATTERN = /^\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/

export interface VideoParticipant {
  pubkey: string
  relayHint?: string
}

export interface VideoTextTrack {
  reference: string
  trackType?: string
  language?: string
}

export interface VideoSegment {
  start: string
  end: string
  startSeconds: number
  endSeconds: number
  title?: string
  thumbnail?: string
}

export interface VideoOrigin {
  platform: string
  externalId: string
  originalUrl?: string
  metadata?: string
}

export interface ParsedVideoEvent {
  id: string
  pubkey: string
  kind: number
  identifier?: string
  isShort: boolean
  isAddressable: boolean
  title: string
  summary: string
  alt?: string
  publishedAt?: number
  durationSeconds?: number
  contentWarningReason?: string | null
  hashtags: string[]
  participants: VideoParticipant[]
  references: string[]
  textTracks: VideoTextTrack[]
  segments: VideoSegment[]
  origin?: VideoOrigin
  variants: Nip92MediaAttachment[]
  route: string
  naddr?: string
}

export interface VideoAddress {
  pubkey: string
  identifier: string
  isShort: boolean
}

export interface VideoVariantInput {
  url: string
  mimeType: string
  fileHash: string
  originalHash?: string
  size?: number
  dim?: string
  magnet?: string
  torrentInfoHash?: string
  blurhash?: string
  thumb?: string
  image?: string
  imageFallbacks?: string[]
  summary?: string
  alt?: string
  fallbacks?: string[]
  service?: string
  durationSeconds?: number
  bitrate?: number
}

export interface PublishVideoOptions {
  title: string
  summary?: string
  alt?: string
  isShort?: boolean
  addressable?: boolean
  identifier?: string
  publishedAt?: number
  durationSeconds?: number
  contentWarning?: { enabled: boolean; reason?: string }
  hashtags?: string[]
  participants?: VideoParticipant[]
  references?: string[]
  textTracks?: VideoTextTrack[]
  segments?: Array<{
    start: string
    end: string
    title?: string
    thumbnail?: string
  }>
  origin?: VideoOrigin
  variants: VideoVariantInput[]
  signal?: AbortSignal
}

function sanitizeOptionalText(value: string | undefined, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = sanitizeText(value).trim().slice(0, maxChars)
  return normalized.length > 0 ? normalized : undefined
}

function normalizeTimestamp(raw: string | undefined): number | undefined {
  if (typeof raw !== 'string' || !/^\d{1,16}$/.test(raw)) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) return undefined
  return value
}

function normalizePositiveNumber(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined
  const numeric = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined
  return numeric
}

function normalizeRelayHint(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > MAX_ORIGIN_FIELD_CHARS) return undefined

  try {
    const parsed = new URL(normalized)
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return undefined
    return normalized
  } catch {
    return undefined
  }
}

function normalizeTrackReference(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 2_048) return undefined
  if (CONTROL_CHARS.test(normalized)) return undefined
  return normalized
}

function normalizeLanguage(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 35) return undefined
  return /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(normalized) ? normalized : undefined
}

function normalizeTimestampString(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return TIMESTAMP_PATTERN.test(normalized) ? normalized : undefined
}

function parseTimestampToSeconds(value: string): number | null {
  if (!TIMESTAMP_PATTERN.test(value)) return null
  const [hours, minutes, seconds] = value.split(':')
  if (!hours || !minutes || !seconds) return null
  const total = (Number(hours) * 3600) + (Number(minutes) * 60) + Number(seconds)
  return Number.isFinite(total) ? total : null
}

function normalizeVideoIdentifier(identifier: string | undefined): string | null {
  if (typeof identifier !== 'string') return null
  if (identifier.length === 0 || identifier.length > MAX_IDENTIFIER_CHARS) return null
  if (CONTROL_CHARS.test(identifier) || identifier.trim().length === 0) return null
  return normalizeAddressIdentifier(identifier)
}

function isVideoKind(kind: number): boolean {
  return (
    kind === Kind.Video ||
    kind === Kind.ShortVideo ||
    kind === Kind.AddressableVideo ||
    kind === Kind.AddressableShortVideo
  )
}

export function isAddressableVideoKind(kind: number): boolean {
  return kind === Kind.AddressableVideo || kind === Kind.AddressableShortVideo
}

export function isRegularVideoKind(kind: number): boolean {
  return kind === Kind.Video || kind === Kind.ShortVideo
}

function getVariantPixelArea(dim: string | undefined): number {
  if (!dim || !/^\d{1,6}x\d{1,6}$/.test(dim)) return 0
  const [width, height] = dim.split('x').map(Number)
  if (!width || !height) return 0
  return width * height
}

function isVideoVariantMimeType(mimeType: string | undefined, url: string): boolean {
  const normalizedMime = typeof mimeType === 'string' ? mimeType.toLowerCase() : undefined
  if (normalizedMime?.startsWith('video/') || normalizedMime?.startsWith('audio/')) return true
  if (normalizedMime && HLS_MIME_TYPES.has(normalizedMime)) return true

  try {
    const pathname = new URL(url).pathname.toLowerCase()
    return MEDIA_PLAYLIST_EXTENSIONS.some((extension) => pathname.endsWith(extension))
  } catch {
    return false
  }
}

function getFirstTagValue(event: NostrEvent, name: string): string | undefined {
  for (const tag of event.tags) {
    if (tag[0] === name && typeof tag[1] === 'string') return tag[1]
  }
  return undefined
}

function getTagValues(event: NostrEvent, name: string): string[] {
  const values: string[] = []
  for (const tag of event.tags) {
    if (tag[0] === name && typeof tag[1] === 'string') values.push(tag[1])
  }
  return values
}

function parseVideoParticipants(event: NostrEvent): VideoParticipant[] {
  const seen = new Set<string>()
  const participants: VideoParticipant[] = []

  for (const tag of event.tags) {
    if (participants.length >= MAX_PARTICIPANTS) break
    if (tag[0] !== 'p' || !tag[1] || !isValidHex32(tag[1]) || seen.has(tag[1])) continue
    seen.add(tag[1])

    const relayHint = normalizeRelayHint(tag[2])
    participants.push({
      pubkey: tag[1],
      ...(relayHint ? { relayHint } : {}),
    })
  }

  return participants
}

function parseVideoHashtags(event: NostrEvent): string[] {
  const tags = new Set<string>()

  for (const rawTag of getTagValues(event, 't')) {
    if (tags.size >= MAX_HASHTAGS) break
    const normalized = normalizeHashtag(rawTag)
    if (normalized) tags.add(normalized)
  }

  return [...tags]
}

function parseVideoReferences(event: NostrEvent): string[] {
  const references: string[] = []
  const seen = new Set<string>()

  for (const rawReference of getTagValues(event, 'r')) {
    if (references.length >= MAX_REFERENCE_URLS) break
    if (!isSafeURL(rawReference) || seen.has(rawReference)) continue
    seen.add(rawReference)
    references.push(rawReference)
  }

  return references
}

function parseVideoTextTracks(event: NostrEvent): VideoTextTrack[] {
  const tracks: VideoTextTrack[] = []
  const seen = new Set<string>()

  for (const tag of event.tags) {
    if (tracks.length >= MAX_TEXT_TRACKS) break
    if (tag[0] !== 'text-track') continue

    const reference = normalizeTrackReference(tag[1])
    if (!reference || seen.has(reference)) continue
    seen.add(reference)

    const trackType = sanitizeOptionalText(tag[2], 64)
    const language = normalizeLanguage(tag[3])

    tracks.push({
      reference,
      ...(trackType ? { trackType } : {}),
      ...(language ? { language } : {}),
    })
  }

  return tracks
}

function parseVideoSegments(event: NostrEvent): VideoSegment[] {
  const segments: VideoSegment[] = []
  const seen = new Set<string>()

  for (const tag of event.tags) {
    if (segments.length >= MAX_SEGMENTS) break
    if (tag[0] !== 'segment') continue

    const start = normalizeTimestampString(tag[1])
    const end = normalizeTimestampString(tag[2])
    if (!start || !end) continue

    const startSeconds = parseTimestampToSeconds(start)
    const endSeconds = parseTimestampToSeconds(end)
    if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds) continue

    const key = `${start}:${end}`
    if (seen.has(key)) continue
    seen.add(key)

    const title = sanitizeOptionalText(tag[3], 200)
    const thumbnail = tag[4] && isSafeMediaURL(tag[4]) ? tag[4] : undefined

    segments.push({
      start,
      end,
      startSeconds,
      endSeconds,
      ...(title ? { title } : {}),
      ...(thumbnail ? { thumbnail } : {}),
    })
  }

  return segments
}

function parseVideoOrigin(event: NostrEvent): VideoOrigin | undefined {
  for (const tag of event.tags) {
    if (tag[0] !== 'origin') continue

    const platform = sanitizeOptionalText(tag[1], 64)
    const externalId = sanitizeOptionalText(tag[2], 255)
    if (!platform || !externalId) continue

    const originalUrl = tag[3] && isSafeURL(tag[3]) ? tag[3] : undefined
    const metadata = sanitizeOptionalText(tag[4], MAX_ORIGIN_FIELD_CHARS)

    return {
      platform,
      externalId,
      ...(originalUrl ? { originalUrl } : {}),
      ...(metadata ? { metadata } : {}),
    }
  }

  return undefined
}

function parseVideoVariants(event: NostrEvent): Nip92MediaAttachment[] {
  const variants: Nip92MediaAttachment[] = []
  const seen = new Set<string>()

  for (const tag of event.tags) {
    if (tag[0] !== 'imeta') continue
    const attachment = parseImetaMediaAttachment(tag)
    if (!attachment || seen.has(attachment.url)) continue
    if (!isVideoVariantMimeType(attachment.mimeType, attachment.url)) continue
    seen.add(attachment.url)
    variants.push(attachment)
  }

  return variants
}

function getVideoKindForPublish(isShort: boolean, addressable: boolean): number {
  if (addressable) {
    return isShort ? Kind.AddressableShortVideo : Kind.AddressableVideo
  }
  return isShort ? Kind.ShortVideo : Kind.Video
}

export function getPreferredVideoVariant(
  video: Pick<ParsedVideoEvent, 'variants'>,
): Nip92MediaAttachment | null {
  if (video.variants.length === 0) return null

  return [...video.variants].sort((left, right) => {
    const areaDelta = getVariantPixelArea(right.dim) - getVariantPixelArea(left.dim)
    if (areaDelta !== 0) return areaDelta

    const bitrateDelta = (right.bitrate ?? 0) - (left.bitrate ?? 0)
    if (bitrateDelta !== 0) return bitrateDelta

    const durationDelta = (right.durationSeconds ?? 0) - (left.durationSeconds ?? 0)
    if (durationDelta !== 0) return durationDelta

    const rightPlaylist = isVideoVariantMimeType(right.mimeType, right.url) && HLS_MIME_TYPES.has((right.mimeType ?? '').toLowerCase())
    const leftPlaylist = isVideoVariantMimeType(left.mimeType, left.url) && HLS_MIME_TYPES.has((left.mimeType ?? '').toLowerCase())
    if (leftPlaylist !== rightPlaylist) return leftPlaylist ? 1 : -1

    return left.url.localeCompare(right.url)
  })[0] ?? null
}

export function getVideoPreviewImage(
  video: Pick<ParsedVideoEvent, 'variants'>,
): string | undefined {
  for (const variant of video.variants) {
    const candidates = [
      variant.image,
      ...(variant.imageFallbacks ?? []),
      variant.thumb,
    ]

    for (const candidate of candidates) {
      if (candidate && isSafeMediaURL(candidate)) return candidate
    }
  }

  return undefined
}

export function getVideoVariantLabel(variant: Nip92MediaAttachment): string {
  const parts: string[] = []
  if (variant.dim) parts.push(variant.dim)
  if (variant.mimeType) parts.push(variant.mimeType)
  if (variant.bitrate) parts.push(`${Math.round(variant.bitrate / 1000)} kbps`)
  return parts.join(' • ') || variant.url
}

export async function deriveMediaPlaybackMetadata(
  file: File | Blob,
): Promise<{ durationSeconds?: number; bitrate?: number }> {
  if (typeof window === 'undefined' || typeof URL === 'undefined') {
    return {}
  }
  if (!(file instanceof Blob) || (!file.type.startsWith('video/') && !file.type.startsWith('audio/'))) {
    return {}
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const durationSeconds = await new Promise<number | undefined>((resolve) => {
      const media = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video')
      const timer = window.setTimeout(() => resolve(undefined), 8_000)

      media.preload = 'metadata'
      media.onloadedmetadata = () => {
        window.clearTimeout(timer)
        resolve(Number.isFinite(media.duration) && media.duration > 0 ? media.duration : undefined)
      }
      media.onerror = () => {
        window.clearTimeout(timer)
        resolve(undefined)
      }
      media.src = objectUrl
    })

    const bitrate = durationSeconds && file.size > 0
      ? Math.round((file.size * 8) / durationSeconds)
      : undefined

    return {
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      ...(bitrate !== undefined ? { bitrate } : {}),
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export function getVideoRoute(event: Pick<NostrEvent, 'id' | 'pubkey' | 'kind' | 'tags'>): string | null {
  if (!isVideoKind(event.kind)) return null

  const identifier = normalizeVideoIdentifier(getFirstTagValue(event as NostrEvent, 'd'))
  if (isAddressableVideoKind(event.kind)) {
    if (!identifier || !isValidHex32(event.pubkey)) return null
    return getAddressableVideoRoute(event.pubkey, identifier, event.kind === Kind.AddressableShortVideo)
  }

  return isValidHex32(event.id) ? `/video/${event.id}` : null
}

export function getAddressableVideoRoute(pubkey: string, identifier: string, isShort: boolean): string {
  return `/video/${isShort ? 'short' : 'normal'}/${pubkey}/${encodeURIComponent(identifier)}`
}

export function getAddressableVideoNaddr(pubkey: string, identifier: string, isShort: boolean): string {
  return naddrEncode({
    kind: isShort ? Kind.AddressableShortVideo : Kind.AddressableVideo,
    pubkey,
    identifier,
  })
}

export function getVideoIdentifier(event: NostrEvent): string | null {
  if (!isAddressableVideoKind(event.kind)) return null
  return normalizeVideoIdentifier(getFirstTagValue(event, 'd'))
}

export function decodeVideoAddress(value: string): VideoAddress | null {
  try {
    const decoded = decodeNostrURI(value)
    if (decoded.type !== 'naddr') return null
    const { kind, pubkey, identifier } = decoded.data
    if (!isAddressableVideoKind(kind) || !isValidHex32(pubkey)) return null

    const normalizedIdentifier = normalizeVideoIdentifier(identifier)
    if (!normalizedIdentifier) return null

    return {
      pubkey,
      identifier: normalizedIdentifier,
      isShort: kind === Kind.AddressableShortVideo,
    }
  } catch {
    return null
  }
}

export function isVideoEvent(event: NostrEvent): boolean {
  return parseVideoEvent(event) !== null
}

export function parseVideoEvent(event: NostrEvent): ParsedVideoEvent | null {
  if (!isVideoKind(event.kind)) return null

  const title = sanitizeOptionalText(getFirstTagValue(event, 'title'), MAX_TITLE_CHARS)
  if (!title) return null

  const isAddressable = isAddressableVideoKind(event.kind)
  const isShort = event.kind === Kind.ShortVideo || event.kind === Kind.AddressableShortVideo
  const identifier = isAddressable
    ? normalizeVideoIdentifier(getFirstTagValue(event, 'd'))
    : null
  if (isAddressable && !identifier) return null

  const variants = parseVideoVariants(event)
  if (variants.length === 0) return null

  const summary = sanitizeText(event.content).trim().slice(0, MAX_SUMMARY_CHARS)
  const alt = sanitizeOptionalText(getFirstTagValue(event, 'alt'), MAX_ALT_CHARS)
  const publishedAt = normalizeTimestamp(getFirstTagValue(event, 'published_at'))
  const eventDuration = normalizePositiveNumber(getFirstTagValue(event, 'duration'))
  const contentWarning = parseContentWarning(event)
  const origin = parseVideoOrigin(event)
  const route = isAddressable && identifier
    ? getAddressableVideoRoute(event.pubkey, identifier, isShort)
    : `/video/${event.id}`

  let naddr: string | undefined
  if (isAddressable && identifier) {
    try {
      naddr = getAddressableVideoNaddr(event.pubkey, identifier, isShort)
    } catch {
      naddr = undefined
    }
  }

  const variantDurations = variants
    .map(variant => variant.durationSeconds)
    .filter((duration): duration is number => typeof duration === 'number' && duration > 0)
  const durationSeconds = eventDuration
    ?? (variantDurations.length > 0 ? Math.max(...variantDurations) : undefined)

  return {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    ...(identifier ? { identifier } : {}),
    isShort,
    isAddressable,
    title,
    summary,
    ...(alt ? { alt } : {}),
    ...(publishedAt !== undefined ? { publishedAt } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(contentWarning ? { contentWarningReason: contentWarning.reason } : {}),
    hashtags: parseVideoHashtags(event),
    participants: parseVideoParticipants(event),
    references: parseVideoReferences(event),
    textTracks: parseVideoTextTracks(event),
    segments: parseVideoSegments(event),
    ...(origin ? { origin } : {}),
    variants,
    route,
    ...(naddr ? { naddr } : {}),
  }
}

function normalizeVideoVariantInput(variant: VideoVariantInput): VideoVariantInput | null {
  if (!variant.mimeType || !isVideoVariantMimeType(variant.mimeType, variant.url)) return null
  const normalized = normalizeNip94Tags({
    url: variant.url,
    mimeType: variant.mimeType,
    fileHash: variant.fileHash,
    ...(variant.originalHash ? { originalHash: variant.originalHash } : {}),
    ...(variant.size !== undefined ? { size: variant.size } : {}),
    ...(variant.dim ? { dim: variant.dim } : {}),
    ...(variant.magnet ? { magnet: variant.magnet } : {}),
    ...(variant.torrentInfoHash ? { torrentInfoHash: variant.torrentInfoHash } : {}),
    ...(variant.blurhash ? { blurhash: variant.blurhash } : {}),
    ...(variant.thumb ? { thumb: variant.thumb } : {}),
    ...(variant.image ? { image: variant.image } : {}),
    ...(variant.summary ? { summary: variant.summary } : {}),
    ...(variant.alt ? { alt: variant.alt } : {}),
    ...(variant.fallbacks ? { fallbacks: variant.fallbacks } : {}),
    ...(variant.service ? { service: variant.service } : {}),
  })
  if (!normalized) return null

  const fallbacks = [...new Set((variant.fallbacks ?? []).filter(isSafeURL))]
  const imageFallbacks = [...new Set((variant.imageFallbacks ?? []).filter(isSafeMediaURL))]
  const durationSeconds = normalizePositiveNumber(variant.durationSeconds)
  const bitrate = normalizePositiveNumber(variant.bitrate)

  return {
    ...normalized,
    ...(imageFallbacks.length > 0 ? { imageFallbacks } : {}),
    ...(fallbacks.length > 0 ? { fallbacks } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(bitrate !== undefined ? { bitrate } : {}),
  }
}

function buildVariantImetaTag(variant: VideoVariantInput): string[] {
  return [
    'imeta',
    `url ${variant.url}`,
    `m ${variant.mimeType}`,
    `x ${variant.fileHash}`,
    ...(variant.originalHash ? [`ox ${variant.originalHash}`] : []),
    ...(variant.size !== undefined ? [`size ${variant.size}`] : []),
    ...(variant.dim ? [`dim ${variant.dim}`] : []),
    ...(variant.magnet ? [`magnet ${variant.magnet}`] : []),
    ...(variant.torrentInfoHash ? [`i ${variant.torrentInfoHash}`] : []),
    ...(variant.blurhash ? [`blurhash ${variant.blurhash}`] : []),
    ...(variant.thumb ? [`thumb ${variant.thumb}`] : []),
    ...(variant.image ? [`image ${variant.image}`] : []),
    ...((variant.imageFallbacks ?? []).map((image) => `image ${image}`)),
    ...(variant.summary ? [`summary ${variant.summary}`] : []),
    ...(variant.alt ? [`alt ${variant.alt}`] : []),
    ...((variant.fallbacks ?? []).map((fallback) => `fallback ${fallback}`)),
    ...(variant.service ? [`service ${variant.service}`] : []),
    ...(variant.durationSeconds !== undefined ? [`duration ${variant.durationSeconds}`] : []),
    ...(variant.bitrate !== undefined ? [`bitrate ${Math.round(variant.bitrate)}`] : []),
  ]
}

export async function publishVideoEvent(options: PublishVideoOptions): Promise<NostrEvent> {
  const ndk = getNDK()
  if (!ndk.signer) {
    throw new Error('No signer available — install a NIP-07 extension to publish video events.')
  }

  const title = sanitizeOptionalText(options.title, MAX_TITLE_CHARS)
  if (!title) {
    throw new Error('Video events require a title.')
  }

  const isShort = options.isShort ?? false
  const addressable = options.addressable ?? false
  const kind = getVideoKindForPublish(isShort, addressable)
  const identifier = addressable
    ? normalizeVideoIdentifier(options.identifier)
    : null

  if (addressable && !identifier) {
    throw new Error('Addressable video events require a valid identifier.')
  }

  const variants = options.variants
    .map(normalizeVideoVariantInput)
    .filter((variant): variant is VideoVariantInput => variant !== null)

  if (variants.length === 0) {
    throw new Error('Video events require at least one valid video variant.')
  }

  const summary = sanitizeText(options.summary ?? '').trim().slice(0, MAX_SUMMARY_CHARS)
  const alt = sanitizeOptionalText(options.alt, MAX_ALT_CHARS)
  const publishedAt = normalizePositiveNumber(options.publishedAt)
  const durationSeconds = normalizePositiveNumber(options.durationSeconds)
    ?? variants
      .map((variant) => variant.durationSeconds)
      .filter((duration): duration is number => typeof duration === 'number' && duration > 0)
      .sort((left, right) => right - left)[0]
  const hashtags = [...new Set(
    (options.hashtags ?? [])
      .map(tag => normalizeHashtag(tag))
      .filter((tag): tag is string => typeof tag === 'string'),
  )].slice(0, MAX_HASHTAGS)
  const participants = (options.participants ?? [])
    .filter(participant => isValidHex32(participant.pubkey))
    .slice(0, MAX_PARTICIPANTS)
  const references = [...new Set((options.references ?? []).filter(isSafeURL))].slice(0, MAX_REFERENCE_URLS)
  const textTracks = (options.textTracks ?? [])
    .reduce<Array<{ reference: string; trackType?: string; language?: string }>>((acc, track) => {
      if (acc.length >= MAX_TEXT_TRACKS) return acc
      const reference = normalizeTrackReference(track.reference)
      if (!reference) return acc
      const trackType = sanitizeOptionalText(track.trackType, 64)
      const language = normalizeLanguage(track.language)
      acc.push({
        reference,
        ...(trackType ? { trackType } : {}),
        ...(language ? { language } : {}),
      })
      return acc
    }, [])
  const segments = (options.segments ?? [])
    .reduce<Array<{ start: string; end: string; title?: string; thumbnail?: string }>>((acc, segment) => {
      if (acc.length >= MAX_SEGMENTS) return acc
      const start = normalizeTimestampString(segment.start)
      const end = normalizeTimestampString(segment.end)
      if (!start || !end) return acc
      const startSeconds = parseTimestampToSeconds(start)
      const endSeconds = parseTimestampToSeconds(end)
      if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds) return acc
      const title = sanitizeOptionalText(segment.title, 200)
      const thumbnail = segment.thumbnail && isSafeMediaURL(segment.thumbnail) ? segment.thumbnail : undefined
      acc.push({
        start,
        end,
        ...(title ? { title } : {}),
        ...(thumbnail ? { thumbnail } : {}),
      })
      return acc
    }, [])
  const origin = options.origin
    ? {
        platform: sanitizeOptionalText(options.origin.platform, 64),
        externalId: sanitizeOptionalText(options.origin.externalId, 255),
        originalUrl: options.origin.originalUrl && isSafeURL(options.origin.originalUrl)
          ? options.origin.originalUrl
          : undefined,
        metadata: sanitizeOptionalText(options.origin.metadata, MAX_ORIGIN_FIELD_CHARS),
      }
    : null

  const tags: string[][] = []
  if (addressable && identifier) tags.push(['d', identifier])
  tags.push(['title', title])
  if (publishedAt !== undefined) tags.push(['published_at', String(Math.floor(publishedAt))])
  if (alt) tags.push(['alt', alt])
  tags.push(...variants.map(buildVariantImetaTag))
  if (durationSeconds !== undefined) tags.push(['duration', String(durationSeconds)])

  for (const track of textTracks) {
    const tag = ['text-track', track.reference]
    if (track.trackType) tag.push(track.trackType)
    if (track.language) tag.push(track.language)
    tags.push(tag)
  }

  if (options.contentWarning?.enabled) {
    const warningTag = ['content-warning']
    const reason = sanitizeOptionalText(options.contentWarning.reason, 280)
    if (reason) warningTag.push(reason)
    tags.push(warningTag)
  }

  for (const segment of segments) {
    const tag = ['segment', segment.start, segment.end]
    if (segment.title) tag.push(segment.title)
    if (segment.thumbnail) tag.push(segment.thumbnail)
    tags.push(tag)
  }

  for (const participant of participants) {
    const tag = ['p', participant.pubkey]
    const relayHint = normalizeRelayHint(participant.relayHint)
    if (relayHint) tag.push(relayHint)
    tags.push(tag)
  }

  for (const hashtag of hashtags) {
    tags.push(['t', hashtag])
  }

  for (const reference of references) {
    tags.push(['r', reference])
  }

  if (origin?.platform && origin.externalId) {
    const tag = ['origin', origin.platform, origin.externalId]
    if (origin.originalUrl) tag.push(origin.originalUrl)
    if (origin.metadata) tag.push(origin.metadata)
    tags.push(tag)
  }

  const event = new NDKEvent(ndk)
  event.kind = kind
  event.content = summary
  event.tags = await withOptionalClientTag(tags, options.signal)

  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  await event.sign()
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  await publishEventWithNip65Outbox(event, options.signal)

  const rawEvent = event.rawEvent() as unknown as NostrEvent
  await insertEvent(rawEvent)
  return rawEvent
}
