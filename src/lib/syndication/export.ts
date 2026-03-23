import type { Atom, Json, Rss } from 'feedsmith/types'
import { parseLongFormEvent } from '@/lib/nostr/longForm'
import { getVideoPreviewImage, parseVideoEvent } from '@/lib/nostr/video'
import { markdownToPlainText } from '@/lib/translation/text'
import type { NostrEvent, Profile } from '@/types'
import type {
  SyndicationDocument,
  SyndicationDocumentFormat,
} from '@/lib/syndication/types'

function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)

  return normalized || 'nostr-paper-export'
}

function summarizeText(value: string, maxLength = 280): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function getPublicOrigin(): string | undefined {
  const fromEnv = typeof import.meta !== 'undefined'
    ? (import.meta.env.VITE_PUBLIC_APP_ORIGIN as string | undefined)
    : undefined

  for (const candidate of [
    fromEnv,
    typeof window !== 'undefined' ? window.location.origin : undefined,
  ]) {
    if (!candidate) continue

    try {
      const parsed = new URL(candidate)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin
      }
    } catch {
      // Ignore invalid candidates.
    }
  }

  return undefined
}

function buildAbsoluteUrl(route: string | undefined): string | undefined {
  if (!route) return undefined
  const origin = getPublicOrigin()
  if (!origin) return undefined

  try {
    return new URL(route, origin).toString()
  } catch {
    return undefined
  }
}

function guessMimeType(url: string | undefined): string | undefined {
  if (!url) return undefined

  try {
    const extension = new URL(url).pathname.toLowerCase().split('.').pop() ?? ''
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
      case 'svg':
        return 'image/svg+xml'
      case 'mp4':
        return 'video/mp4'
      case 'm4v':
        return 'video/x-m4v'
      case 'mov':
        return 'video/quicktime'
      case 'webm':
        return 'video/webm'
      case 'm3u8':
        return 'application/x-mpegurl'
      case 'mp3':
        return 'audio/mpeg'
      case 'm4a':
        return 'audio/mp4'
      case 'ogg':
      case 'oga':
        return 'audio/ogg'
      default:
        return undefined
    }
  } catch {
    return undefined
  }
}

function renderParagraphHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
    .join('')
}

function buildAuthorName(profile: Profile | null, pubkey: string): string {
  return profile?.display_name ?? profile?.name ?? `${pubkey.slice(0, 12)}…`
}

function buildJsonAuthors(
  profile: Profile | null,
  pubkey: string,
): Json.Author[] {
  const name = buildAuthorName(profile, pubkey)
  const profileUrl = buildAbsoluteUrl(`/profile/${pubkey}`)

  return [compactRecord({
    name,
    url: profile?.website ?? profileUrl,
    avatar: profile?.picture,
  }) as Json.Author]
}

function buildAtomAuthors(
  profile: Profile | null,
  pubkey: string,
): Atom.Person[] {
  const name = buildAuthorName(profile, pubkey)
  const profileUrl = buildAbsoluteUrl(`/profile/${pubkey}`)

  return [compactRecord({
    name,
    uri: profile?.website ?? profileUrl,
    email: profile?.nip05,
  }) as Atom.Person]
}

function buildArticleHtml(
  image: string | undefined,
  summary: string | undefined,
  contentText: string,
  canonicalUrl: string | undefined,
): string {
  const blocks: string[] = []

  if (image) {
    blocks.push(`<p><img src="${escapeHtml(image)}" alt="" /></p>`)
  }
  if (summary) {
    blocks.push(`<p><strong>${escapeHtml(summary)}</strong></p>`)
  }
  if (contentText) {
    blocks.push(renderParagraphHtml(contentText))
  }
  if (canonicalUrl) {
    blocks.push(`<p><a href="${escapeHtml(canonicalUrl)}">Read on Nostr Paper</a></p>`)
  }

  return blocks.join('')
}

function buildVideoHtml(
  image: string | undefined,
  summary: string | undefined,
  originUrl: string | undefined,
  canonicalUrl: string | undefined,
): string {
  const blocks: string[] = []

  if (image) {
    blocks.push(`<p><img src="${escapeHtml(image)}" alt="" /></p>`)
  }
  if (summary) {
    blocks.push(renderParagraphHtml(summary))
  }
  if (originUrl) {
    blocks.push(`<p><a href="${escapeHtml(originUrl)}">Original source</a></p>`)
  }
  if (canonicalUrl) {
    blocks.push(`<p><a href="${escapeHtml(canonicalUrl)}">View on Nostr Paper</a></p>`)
  }

  return blocks.join('')
}

function buildDocument(
  format: SyndicationDocumentFormat,
  fileNameBase: string,
  content: string,
): SyndicationDocument {
  switch (format) {
    case 'rss':
      return {
        format,
        mimeType: 'application/rss+xml;charset=utf-8',
        fileName: `${fileNameBase}.rss.xml`,
        content,
      }
    case 'atom':
      return {
        format,
        mimeType: 'application/atom+xml;charset=utf-8',
        fileName: `${fileNameBase}.atom.xml`,
        content,
      }
    case 'json':
      return {
        format,
        mimeType: 'application/feed+json;charset=utf-8',
        fileName: `${fileNameBase}.feed.json`,
        content,
      }
  }
}

function normalizeJsonFeedOutput(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

export async function generateArticleSyndicationDocuments(
  event: NostrEvent,
  profile: Profile | null,
): Promise<SyndicationDocument[]> {
  const article = parseLongFormEvent(event)
  if (!article) return []

  const { generateAtomFeed, generateJsonFeed, generateRssFeed } = await import('feedsmith')
  const canonicalUrl = buildAbsoluteUrl(article.route)
  const bodyText = markdownToPlainText(event.content).trim()
  const description = article.summary ?? summarizeText(bodyText || article.title || 'Untitled Article')
  const authorName = buildAuthorName(profile, event.pubkey)
  const jsonAuthors = buildJsonAuthors(profile, event.pubkey)
  const atomAuthors = buildAtomAuthors(profile, event.pubkey)
  const publishedAt = new Date((article.publishedAt ?? article.updatedAt) * 1000)
  const updatedAt = new Date(article.updatedAt * 1000)
  const contentHtml = buildArticleHtml(article.image, article.summary, bodyText, canonicalUrl)
  const fileNameBase = slugify(article.identifier || article.title || article.id)
  const itemId = canonicalUrl ?? `urn:nostr:article:${article.id}`

  const rssFeed: Rss.Feed<Date> = compactRecord({
    title: article.title ?? 'Untitled Article',
    link: canonicalUrl,
    description,
    managingEditor: authorName,
    image: article.image && canonicalUrl
      ? {
          url: article.image,
          title: article.title ?? 'Untitled Article',
          link: canonicalUrl,
        }
      : undefined,
    items: [
      compactRecord({
        title: article.title ?? 'Untitled Article',
        link: canonicalUrl,
        description,
        authors: [authorName],
        categories: article.hashtags.map((tag) => ({ name: tag })),
        guid: compactRecord({
          value: itemId,
          isPermaLink: Boolean(canonicalUrl),
        }),
        pubDate: publishedAt,
        content: contentHtml ? { encoded: contentHtml } : undefined,
      }) as Rss.Item<Date>,
    ],
  }) as Rss.Feed<Date>

  const atomFeed: Atom.Feed<Date> = compactRecord({
    id: itemId,
    title: article.title ?? 'Untitled Article',
    updated: updatedAt,
    subtitle: description,
    icon: article.image,
    logo: article.image,
    authors: atomAuthors,
    links: canonicalUrl
      ? [{ href: canonicalUrl, rel: 'alternate', type: 'text/html' }]
      : undefined,
    entries: [
      compactRecord({
        id: itemId,
        title: article.title ?? 'Untitled Article',
        updated: updatedAt,
        published: publishedAt,
        summary: description,
        content: contentHtml || bodyText || description,
        authors: atomAuthors,
        categories: article.hashtags.map((tag) => ({ term: tag })),
        links: [
          ...(canonicalUrl ? [{ href: canonicalUrl, rel: 'alternate', type: 'text/html' }] : []),
          ...(article.image ? [{ href: article.image, rel: 'enclosure', type: guessMimeType(article.image) ?? 'image/jpeg' }] : []),
        ],
      }) as Atom.Entry<Date>,
    ],
  }) as Atom.Feed<Date>

  const jsonFeed: Json.Feed<Date> = compactRecord({
    title: article.title ?? 'Untitled Article',
    home_page_url: canonicalUrl,
    description,
    icon: article.image ?? profile?.picture,
    authors: jsonAuthors,
    items: [
      compactRecord({
        id: itemId,
        url: canonicalUrl,
        title: article.title ?? 'Untitled Article',
        summary: description,
        content_html: contentHtml || undefined,
        content_text: bodyText || description,
        image: article.image,
        date_published: publishedAt,
        date_modified: updatedAt,
        tags: article.hashtags,
        authors: jsonAuthors,
      }) as Json.Item<Date>,
    ],
  }) as Json.Feed<Date>

  return [
    buildDocument('rss', fileNameBase, generateRssFeed(rssFeed)),
    buildDocument('atom', fileNameBase, generateAtomFeed(atomFeed)),
    buildDocument('json', fileNameBase, normalizeJsonFeedOutput(generateJsonFeed(jsonFeed))),
  ]
}

export async function generateVideoSyndicationDocuments(
  event: NostrEvent,
  profile: Profile | null,
): Promise<SyndicationDocument[]> {
  const video = parseVideoEvent(event)
  if (!video) return []

  const { generateAtomFeed, generateJsonFeed, generateRssFeed } = await import('feedsmith')
  const canonicalUrl = buildAbsoluteUrl(video.route)
  const primaryUrl = canonicalUrl ?? video.origin?.originalUrl ?? video.variants[0]?.url
  const previewImage = getVideoPreviewImage(video)
  const description = video.summary.trim() || `A ${video.isShort ? 'short video' : 'video'} published on Nostr Paper`
  const authorName = buildAuthorName(profile, event.pubkey)
  const jsonAuthors = buildJsonAuthors(profile, event.pubkey)
  const atomAuthors = buildAtomAuthors(profile, event.pubkey)
  const publishedAt = new Date((video.publishedAt ?? event.created_at) * 1000)
  const updatedAt = new Date(event.created_at * 1000)
  const contentHtml = buildVideoHtml(previewImage, video.summary.trim(), video.origin?.originalUrl, canonicalUrl)
  const fileNameBase = slugify(video.identifier || video.title || video.id)
  const itemId = primaryUrl ?? `urn:nostr:video:${video.id}`
  const topVariants = video.variants.filter((variant) => Boolean(variant.url && variant.mimeType)).slice(0, 4)

  const rssFeed: Rss.Feed<Date> = compactRecord({
    title: video.title,
    link: primaryUrl,
    description,
    managingEditor: authorName,
    image: previewImage && primaryUrl
      ? {
          url: previewImage,
          title: video.title,
          link: primaryUrl,
        }
      : undefined,
    items: [
      compactRecord({
        title: video.title,
        link: primaryUrl,
        description,
        authors: [authorName],
        categories: video.hashtags.map((tag) => ({ name: tag })),
        guid: compactRecord({
          value: itemId,
          isPermaLink: Boolean(primaryUrl),
        }),
        pubDate: publishedAt,
        enclosures: topVariants.map((variant) => ({
          url: variant.url,
          type: variant.mimeType,
          length: variant.size ?? 0,
        })),
        content: contentHtml ? { encoded: contentHtml } : undefined,
      }) as Rss.Item<Date>,
    ],
  }) as Rss.Feed<Date>

  const atomFeed: Atom.Feed<Date> = compactRecord({
    id: itemId,
    title: video.title,
    updated: updatedAt,
    subtitle: description,
    icon: previewImage ?? profile?.picture,
    logo: previewImage,
    authors: atomAuthors,
    links: primaryUrl
      ? [{ href: primaryUrl, rel: 'alternate', type: 'text/html' }]
      : undefined,
    entries: [
      compactRecord({
        id: itemId,
        title: video.title,
        updated: updatedAt,
        published: publishedAt,
        summary: description,
        content: contentHtml || description,
        authors: atomAuthors,
        categories: video.hashtags.map((tag) => ({ term: tag })),
        links: [
          ...(primaryUrl ? [{ href: primaryUrl, rel: 'alternate', type: 'text/html' }] : []),
          ...topVariants.map((variant) => ({
            href: variant.url,
            rel: 'enclosure',
            type: variant.mimeType,
            length: variant.size,
            title: variant.alt ?? variant.summary,
          })),
        ],
      }) as Atom.Entry<Date>,
    ],
  }) as Atom.Feed<Date>

  const jsonFeed: Json.Feed<Date> = compactRecord({
    title: video.title,
    home_page_url: primaryUrl,
    description,
    icon: previewImage ?? profile?.picture,
    authors: jsonAuthors,
    items: [
      compactRecord({
        id: itemId,
        url: primaryUrl,
        title: video.title,
        summary: description,
        content_html: contentHtml || undefined,
        content_text: video.summary.trim() || description,
        image: previewImage,
        date_published: publishedAt,
        date_modified: updatedAt,
        tags: video.hashtags,
        authors: jsonAuthors,
        attachments: topVariants.map((variant) => compactRecord({
          url: variant.url,
          mime_type: variant.mimeType,
          title: variant.alt ?? variant.summary,
          size_in_bytes: variant.size,
          duration_in_seconds: variant.durationSeconds,
        }) as Json.Attachment),
      }) as Json.Item<Date>,
    ],
  }) as Json.Feed<Date>

  return [
    buildDocument('rss', fileNameBase, generateRssFeed(rssFeed)),
    buildDocument('atom', fileNameBase, generateAtomFeed(atomFeed)),
    buildDocument('json', fileNameBase, normalizeJsonFeedOutput(generateJsonFeed(jsonFeed))),
  ]
}
