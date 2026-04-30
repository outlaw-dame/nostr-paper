import { NDKEvent } from '@nostr-dev-kit/ndk'
import { updateCachedBlobMetadata } from '@/lib/db/blossom'
import { getEventReadRelayHints, insertEvent } from '@/lib/db/nostr'
import { withOptionalClientTag } from '@/lib/nostr/appHandlers'
import { normalizeNip94Tags, publishFileMetadata } from '@/lib/nostr/fileMetadata'
import { buildExpirationTag, normalizeExpiration } from '@/lib/nostr/expiration'
import { buildNip92ImetaTags } from '@/lib/nostr/imeta'
import { buildEventReferenceUri, decodeProfileReference } from '@/lib/nostr/nip21'
import { buildQuoteTagsFromContent } from '@/lib/nostr/repost'
import { publishEventWithNip65Outbox } from '@/lib/nostr/outbox'
import { getNDK } from '@/lib/nostr/ndk'
import { withRetry } from '@/lib/retry'
import {
  LIMITS,
  extractHashtags,
  extractNostrURIs,
  isSafeURL,
  isValidHex32,
  sanitizeText,
} from '@/lib/security/sanitize'
import type { BlossomBlob, Nip94Tags, NostrEvent } from '@/types'
import { Kind } from '@/types'

const LINE_BREAK = '\n\n'
const URL_LIST_BREAK = '\n'

export interface PrepareNoteContentOptions {
  body?: string
  quoteReferenceUri?: string | null
  quoteAuthorPubkey?: string | null
  media?: Nip94Tags[]
  expiresAt?: number | null
  /** External GIF URLs (Tenor etc.) appended to content without imeta tags. */
  gifUrls?: string[]
}

export interface PreparedNoteContent {
  content: string
  tags: string[][]
}

export interface PublishNoteOptions {
  body?: string
  quoteTarget?: NostrEvent | null
  media?: BlossomBlob[]
  expiresAt?: number | null
  /** External GIF URLs (Tenor etc.) appended to content without imeta tags. */
  gifUrls?: string[]
  /** User-supplied alt text keyed by blob sha256; overrides any existing alt in nip94 metadata. */
  mediaAlt?: Record<string, string>
  signal?: AbortSignal
}

function normalizeBody(body: string | undefined): string {
  if (typeof body !== 'string') return ''
  return sanitizeText(body).replace(/\r\n?/g, '\n').trim()
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0 || value.length === 0) return ''

  let low = 0
  let high = value.length

  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (utf8ByteLength(value.slice(0, mid)) <= maxBytes) {
      low = mid
    } else {
      high = mid - 1
    }
  }

  return value.slice(0, low)
}

function buildMentionTags(
  content: string,
  quoteTags: string[][],
  quoteAuthorPubkey?: string | null,
): string[][] {
  const pubkeys = new Set<string>()

  if (quoteAuthorPubkey && isValidHex32(quoteAuthorPubkey)) {
    pubkeys.add(quoteAuthorPubkey)
  }

  for (const tag of quoteTags) {
    const pubkey = tag[3]
    if (typeof pubkey === 'string' && isValidHex32(pubkey)) {
      pubkeys.add(pubkey)
    }
  }

  for (const uri of extractNostrURIs(content)) {
    const profile = decodeProfileReference(uri)
    if (profile?.pubkey) {
      pubkeys.add(profile.pubkey)
    }
  }

  return [...pubkeys].map((pubkey) => ['p', pubkey])
}

function buildHashtagTags(content: string): string[][] {
  return extractHashtags(content).map((tag) => ['t', tag])
}

function normalizeMediaMetadata(media: Nip94Tags[] | undefined): Nip94Tags[] {
  if (!Array.isArray(media) || media.length === 0) return []

  const normalized: Nip94Tags[] = []
  const seen = new Set<string>()

  for (const item of media) {
    const candidate = normalizeNip94Tags({
      url: item.url,
      mimeType: item.mimeType,
      fileHash: item.fileHash,
      ...(item.originalHash ? { originalHash: item.originalHash } : {}),
      ...(item.size !== undefined ? { size: item.size } : {}),
      ...(item.dim ? { dim: item.dim } : {}),
      ...(item.magnet ? { magnet: item.magnet } : {}),
      ...(item.torrentInfoHash ? { torrentInfoHash: item.torrentInfoHash } : {}),
      ...(item.blurhash ? { blurhash: item.blurhash } : {}),
      ...(item.thumb ? { thumb: item.thumb } : {}),
      ...(item.thumbHash ? { thumbHash: item.thumbHash } : {}),
      ...(item.image ? { image: item.image } : {}),
      ...(item.imageHash ? { imageHash: item.imageHash } : {}),
      ...(item.summary ? { summary: item.summary } : {}),
      ...(item.alt ? { alt: item.alt } : {}),
      ...(item.fallbacks ? { fallbacks: item.fallbacks } : {}),
      ...(item.service ? { service: item.service } : {}),
    })

    if (!candidate || seen.has(candidate.url)) continue
    seen.add(candidate.url)
    normalized.push(candidate)
  }

  return normalized
}

function buildMediaUrlBlock(media: Nip94Tags[], extraUrls: string[] = []): string {
  return [...media.map((item) => item.url), ...extraUrls].join(URL_LIST_BREAK)
}

function hasAltOverride(altOverrides: Record<string, string>, sha256: string): boolean {
  return Object.prototype.hasOwnProperty.call(altOverrides, sha256)
}

function normalizeBlobMediaMetadata(
  blob: BlossomBlob,
  altOverride?: string,
  overrideAlt = false,
): Nip94Tags {
  const source = blob.nip94 ?? normalizeNip94Tags({
    url: blob.url,
    mimeType: blob.type,
    fileHash: blob.sha256,
    size: blob.size,
  })

  if (!source) {
    throw new Error('Invalid media attachment metadata.')
  }

  const normalized = normalizeNip94Tags({
    url: source.url,
    mimeType: source.mimeType,
    fileHash: source.fileHash,
    ...(source.originalHash ? { originalHash: source.originalHash } : {}),
    ...(source.size !== undefined ? { size: source.size } : {}),
    ...(source.dim ? { dim: source.dim } : {}),
    ...(source.magnet ? { magnet: source.magnet } : {}),
    ...(source.torrentInfoHash ? { torrentInfoHash: source.torrentInfoHash } : {}),
    ...(source.blurhash ? { blurhash: source.blurhash } : {}),
    ...(source.thumb ? { thumb: source.thumb } : {}),
    ...(source.thumbHash ? { thumbHash: source.thumbHash } : {}),
    ...(source.image ? { image: source.image } : {}),
    ...(source.imageHash ? { imageHash: source.imageHash } : {}),
    ...(source.summary ? { summary: source.summary } : {}),
    ...(
      overrideAlt
        ? (typeof altOverride === 'string' && altOverride.length > 0 ? { alt: altOverride } : {})
        : (source.alt ? { alt: source.alt } : {})
    ),
    ...(source.fallbacks ? { fallbacks: source.fallbacks } : {}),
    ...(source.service ? { service: source.service } : {}),
  })

  if (!normalized) {
    throw new Error('Invalid media attachment metadata.')
  }

  return normalized
}

function normalizePublishedMedia(
  media: BlossomBlob[] | undefined,
  altOverrides: Record<string, string> = {},
): Nip94Tags[] {
  if (!Array.isArray(media) || media.length === 0) return []

  return media.map((blob) => normalizeBlobMediaMetadata(
    blob,
    altOverrides[blob.sha256],
    hasAltOverride(altOverrides, blob.sha256),
  ))
}

async function syncPublishedMediaAltMetadata(
  media: BlossomBlob[] | undefined,
  altOverrides: Record<string, string>,
  signal?: AbortSignal,
): Promise<void> {
  if (!Array.isArray(media) || media.length === 0) return

  const ndk = getNDK()

  for (const blob of media) {
    if (!hasAltOverride(altOverrides, blob.sha256)) continue
    if (signal?.aborted) return

    const current = normalizeBlobMediaMetadata(blob)
    const next = normalizeBlobMediaMetadata(blob, altOverrides[blob.sha256], true)
    if ((current.alt ?? '') === (next.alt ?? '')) continue

    try {
      const metadataEvent = await withRetry(
        async () => publishFileMetadata(ndk, blob, {
          ...(next.originalHash ? { originalHash: next.originalHash } : {}),
          ...(next.size !== undefined ? { size: next.size } : {}),
          ...(next.dim ? { dim: next.dim } : {}),
          ...(next.magnet ? { magnet: next.magnet } : {}),
          ...(next.torrentInfoHash ? { torrentInfoHash: next.torrentInfoHash } : {}),
          ...(next.blurhash ? { blurhash: next.blurhash } : {}),
          ...(next.thumb ? { thumb: next.thumb } : {}),
          ...(next.thumbHash ? { thumbHash: next.thumbHash } : {}),
          ...(next.image ? { image: next.image } : {}),
          ...(next.imageHash ? { imageHash: next.imageHash } : {}),
          ...(next.summary ? { summary: next.summary } : {}),
          ...(next.alt ? { alt: next.alt } : {}),
          ...(next.fallbacks ? { fallbacks: next.fallbacks } : {}),
          ...(next.service ? { service: next.service } : {}),
        }),
        {
          maxAttempts: 2,
          baseDelayMs: 1_000,
          maxDelayMs: 4_000,
          ...(signal ? { signal } : {}),
        },
      )

      await updateCachedBlobMetadata(blob.sha256, next, metadataEvent.id)
    } catch (error) {
      if (signal?.aborted) return
      console.warn('[publishNote] Failed to sync media alt metadata:', blob.sha256, error)
    }
  }
}

export function prepareNoteContent({
  body = '',
  quoteReferenceUri = null,
  quoteAuthorPubkey = null,
  media = [],
  expiresAt = null,
  gifUrls = [],
}: PrepareNoteContentOptions): PreparedNoteContent {
  const normalizedBody = normalizeBody(body)
  const normalizedQuoteUri = typeof quoteReferenceUri === 'string'
    ? quoteReferenceUri.trim()
    : ''
  const normalizedMedia = normalizeMediaMetadata(media)
  // Validate external GIF URLs; reject anything that doesn't pass the URL safety check
  const safeGifUrls = gifUrls.filter((url) => typeof url === 'string' && isSafeURL(url))
  const mediaBlock = (normalizedMedia.length > 0 || safeGifUrls.length > 0)
    ? buildMediaUrlBlock(normalizedMedia, safeGifUrls)
    : ''
  const suffixSegments = [
    ...(mediaBlock ? [mediaBlock] : []),
    ...(normalizedQuoteUri ? [normalizedQuoteUri] : []),
  ]
  const suffixText = suffixSegments.join(LINE_BREAK)
  const suffixBytes = suffixText ? utf8ByteLength(suffixText) : 0

  let content = normalizedBody

  if (suffixText) {
    const separatorBytes = normalizedBody ? utf8ByteLength(LINE_BREAK) : 0
    const maxBodyBytes = LIMITS.CONTENT_BYTES - suffixBytes - separatorBytes

    if (maxBodyBytes < 0) {
      throw new Error('Attached media and quote reference exceed the maximum note size.')
    }

    const truncatedBody = truncateUtf8(normalizedBody, maxBodyBytes).trim()
    content = truncatedBody
      ? `${truncatedBody}${LINE_BREAK}${suffixText}`
      : suffixText
  } else if (utf8ByteLength(content) > LIMITS.CONTENT_BYTES) {
    content = truncateUtf8(content, LIMITS.CONTENT_BYTES).trim()
  }

  if (content.length === 0) {
    throw new Error('Notes cannot be empty.')
  }

  const quoteTags = buildQuoteTagsFromContent(content)
  const expirationTag = expiresAt !== null && expiresAt !== undefined
    ? buildExpirationTag(expiresAt)
    : null

  if (normalizedQuoteUri && quoteTags.length === 0) {
    throw new Error('Invalid quote reference URI.')
  }

  return {
    content,
    tags: [
      ...buildMentionTags(content, quoteTags, quoteAuthorPubkey),
      ...buildHashtagTags(normalizedBody),
      ...buildNip92ImetaTags(normalizedMedia),
      ...quoteTags,
      ...(expirationTag ? [expirationTag] : []),
    ],
  }
}

export async function publishNote({
  body = '',
  quoteTarget = null,
  media = [],
  expiresAt = null,
  gifUrls = [],
  mediaAlt = {},
  signal,
}: PublishNoteOptions): Promise<NostrEvent> {
  const ndk = getNDK()
  if (!ndk.signer) {
    throw new Error('No signer available — install a NIP-07 extension to publish notes.')
  }

  if (expiresAt !== null && expiresAt !== undefined) {
    const normalizedExpiration = normalizeExpiration(expiresAt)
    if (
      normalizedExpiration === undefined ||
      normalizedExpiration <= Math.floor(Date.now() / 1000)
    ) {
      throw new Error('Note expiration must be a future Unix timestamp.')
    }
  }

  const relayHints = quoteTarget
    ? await getEventReadRelayHints(quoteTarget.pubkey, 2)
    : []
  const quoteReferenceUri = quoteTarget
    ? buildEventReferenceUri(quoteTarget, relayHints)
    : null

  if (quoteTarget && !quoteReferenceUri) {
    throw new Error('Unable to encode the quoted event as a NIP-21 reference.')
  }

  const prepared = prepareNoteContent({
    body,
    quoteReferenceUri,
    quoteAuthorPubkey: quoteTarget?.pubkey ?? null,
    media: normalizePublishedMedia(media, mediaAlt),
    expiresAt,
    gifUrls,
  })

  const event = new NDKEvent(ndk)
  event.kind = Kind.ShortNote
  event.content = prepared.content
  event.tags = await withOptionalClientTag(prepared.tags, signal)

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  await event.sign()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  await publishEventWithNip65Outbox(event, signal)

  await syncPublishedMediaAltMetadata(media, mediaAlt, signal)

  const rawEvent = event.rawEvent() as unknown as NostrEvent
  await insertEvent(rawEvent)
  return rawEvent
}
