import type { Atom, Json, Rdf, Rss } from 'feedsmith/types'
import { isSafeURL, sanitizeText } from '@/lib/security/sanitize'
import type {
  SyndicationAttachment,
  SyndicationEntry,
  SyndicationFeed,
} from '@/lib/syndication/types'

type DeepPartial<T> =
  T extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function asText(value: unknown): string | undefined {
  const raw = asString(value)
  if (!raw) return undefined
  const cleaned = sanitizeText(raw).trim()
  return cleaned.length > 0 ? cleaned : undefined
}

function asUrl(value: unknown): string | undefined {
  const raw = asString(value)
  return raw && isSafeURL(raw) ? raw : undefined
}

function toIsoString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString()
  }

  if (value instanceof Date) {
    return Number.isNaN(value.valueOf()) ? undefined : value.toISOString()
  }

  return undefined
}

function toPositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : undefined
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }

  return undefined
}

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function normalizeAuthors(value: unknown): string[] {
  const entries = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value]

  return uniq(entries.flatMap((entry) => {
    if (typeof entry === 'string') {
      const text = asText(entry)
      return text ? [text] : []
    }

    if (!isRecord(entry)) return []

    const name = asText(entry.name)
    const email = asText(entry.email)
    return [name, email].filter((item): item is string => typeof item === 'string')
  }))
}

function normalizeCategories(value: unknown, key: 'name' | 'term' = 'name'): string[] {
  const entries = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value]

  return uniq(entries.flatMap((entry) => {
    if (typeof entry === 'string') {
      const text = asText(entry)
      return text ? [text] : []
    }

    if (!isRecord(entry)) return []

    const text = asText(entry[key])
    return text ? [text] : []
  }))
}

function normalizeJsonAttachments(value: unknown): SyndicationAttachment[] {
  if (!Array.isArray(value)) return []

  const attachments: SyndicationAttachment[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const url = asUrl(entry.url)
    if (!url) continue

    attachments.push(compactRecord({
      url,
      mimeType: asString(entry.mime_type),
      title: asText(entry.title),
      sizeInBytes: toPositiveNumber(entry.size_in_bytes),
      durationSeconds: toPositiveNumber(entry.duration_in_seconds),
    }) as SyndicationAttachment)
  }

  return attachments
}

function normalizeRssEnclosures(value: unknown): SyndicationAttachment[] {
  if (!Array.isArray(value)) return []

  const attachments: SyndicationAttachment[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const url = asUrl(entry.url)
    if (!url) continue

    attachments.push(compactRecord({
      url,
      mimeType: asString(entry.type),
      sizeInBytes: toPositiveNumber(entry.length),
    }) as SyndicationAttachment)
  }

  return attachments
}

function normalizeAtomAttachments(value: unknown): SyndicationAttachment[] {
  if (!Array.isArray(value)) return []

  const attachments: SyndicationAttachment[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    if ((asString(entry.rel) ?? 'alternate') !== 'enclosure') continue
    const url = asUrl(entry.href)
    if (!url) continue

    attachments.push(compactRecord({
      url,
      mimeType: asString(entry.type),
      sizeInBytes: toPositiveNumber(entry.length),
      title: asText(entry.title),
    }) as SyndicationAttachment)
  }

  return attachments
}

function getFirstImageCandidate(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const url = getFirstImageCandidate(entry)
      if (url) return url
    }
    return undefined
  }

  if (typeof value === 'string') {
    return asUrl(value)
  }

  if (!isRecord(value)) return undefined

  const directUrl = asUrl(value.url ?? value.href)
  const directType = asString(value.type)
  if (directUrl && (!directType || directType.startsWith('image/'))) return directUrl

  for (const nested of [
    value.thumbnail,
    value.thumbnails,
    value.content,
    value.contents,
    value.image,
    value.images,
    value.group,
    value.groups,
  ]) {
    const nestedUrl = getFirstImageCandidate(nested)
    if (nestedUrl) return nestedUrl
  }

  return undefined
}

function getAtomAlternateUrl(links: DeepPartial<Atom.Link<string>>[] | undefined): string | undefined {
  if (!Array.isArray(links)) return undefined

  const alternate = links.find((link) => (link.rel ?? 'alternate') === 'alternate')
  return asUrl(alternate?.href) ?? asUrl(links[0]?.href)
}

function normalizeMediaAttachments(value: unknown): SyndicationAttachment[] {
  if (!isRecord(value)) return []

  const candidateGroups: unknown[] = []
  if (Array.isArray(value.contents)) candidateGroups.push(...value.contents)
  if (isRecord(value.group) && Array.isArray(value.group.contents)) candidateGroups.push(...value.group.contents)
  if (Array.isArray(value.groups)) {
    for (const group of value.groups) {
      if (isRecord(group) && Array.isArray(group.contents)) {
        candidateGroups.push(...group.contents)
      }
    }
  }

  const attachments: SyndicationAttachment[] = []
  for (const entry of candidateGroups) {
    if (!isRecord(entry)) continue
    const url = asUrl(entry.url)
    if (!url) continue

    attachments.push(compactRecord({
      url,
      mimeType: asString(entry.type) ?? asString(entry.medium),
      title: asText(entry.title),
      sizeInBytes: toPositiveNumber(entry.fileSize),
      durationSeconds: toPositiveNumber(entry.duration),
    }) as SyndicationAttachment)
  }

  return attachments
}

function uniqByUrl(attachments: SyndicationAttachment[]): SyndicationAttachment[] {
  const seen = new Set<string>()
  return attachments.filter((attachment) => {
    if (seen.has(attachment.url)) return false
    seen.add(attachment.url)
    return true
  })
}

function normalizeJsonEntry(item: DeepPartial<Json.Item<string>>): SyndicationEntry | null {
  const id = asText(item.id)
  if (!id) return null

  return compactRecord({
    id,
    url: asUrl(item.url),
    externalUrl: asUrl(item.external_url),
    title: asText(item.title),
    summary: asText(item.summary),
    contentText: asText(item.content_text),
    contentHtml: asString(item.content_html),
    image: asUrl(item.image ?? item.banner_image),
    publishedAt: toIsoString(item.date_published),
    updatedAt: toIsoString(item.date_modified),
    authors: normalizeAuthors(item.authors),
    tags: normalizeCategories(item.tags),
    attachments: normalizeJsonAttachments(item.attachments),
  }) as SyndicationEntry
}

function normalizeRssEntry(item: DeepPartial<Rss.Item<string>>): SyndicationEntry | null {
  const id = asText(item.guid?.value) ?? asUrl(item.link) ?? asText(item.title) ?? asText(item.description)
  if (!id) return null

  return compactRecord({
    id,
    url: asUrl(item.link),
    title: asText(item.title),
    summary: asText(item.description),
    contentHtml: asString(item.content?.encoded),
    image: getFirstImageCandidate(item.media) ?? asUrl(item.itunes?.image),
    publishedAt: toIsoString(item.pubDate),
    authors: uniq([
      ...normalizeAuthors(item.authors),
      ...normalizeAuthors(item.dc?.creators),
      ...normalizeAuthors(item.itunes?.author),
    ]),
    tags: uniq([
      ...normalizeCategories(item.categories),
      ...normalizeCategories(item.media?.keywords),
      ...normalizeCategories(item.itunes?.keywords),
    ]),
    attachments: uniqByUrl([
      ...normalizeRssEnclosures(item.enclosures),
      ...normalizeMediaAttachments(item.media),
    ]),
  }) as SyndicationEntry
}

function normalizeAtomEntry(item: DeepPartial<Atom.Entry<string>>): SyndicationEntry | null {
  const id = asText(item.id)
  if (!id) return null

  return compactRecord({
    id,
    url: getAtomAlternateUrl(item.links),
    title: asText(item.title),
    summary: asText(item.summary),
    contentText: asText(item.content),
    image: getFirstImageCandidate(item.media),
    publishedAt: toIsoString(item.published),
    updatedAt: toIsoString(item.updated),
    authors: normalizeAuthors(item.authors),
    tags: normalizeCategories(item.categories, 'term'),
    attachments: uniqByUrl([
      ...normalizeAtomAttachments(item.links),
      ...normalizeMediaAttachments(item.media),
    ]),
  }) as SyndicationEntry
}

function normalizeRdfEntry(item: DeepPartial<Rdf.Item<string>>): SyndicationEntry | null {
  const id = asUrl(item.link) ?? asText(item.title)
  if (!id) return null

  return compactRecord({
    id,
    url: asUrl(item.link),
    title: asText(item.title),
    summary: asText(item.description),
    contentHtml: asString(item.content?.encoded),
    image: getFirstImageCandidate(item.media),
    publishedAt: toIsoString(item.dc?.date),
    updatedAt: toIsoString(item.dcterms?.modified),
    authors: normalizeAuthors(item.dc?.creators),
    tags: normalizeCategories(item.media?.keywords),
    attachments: normalizeMediaAttachments(item.media),
  }) as SyndicationEntry
}

function normalizeJsonFeed(feed: DeepPartial<Json.Feed<string>>, sourceUrl?: string): SyndicationFeed | null {
  const title = asText(feed.title)
  if (!title) return null

  return compactRecord({
    format: 'json',
    sourceUrl,
    feedUrl: asUrl(feed.feed_url),
    homePageUrl: asUrl(feed.home_page_url),
    title,
    description: asText(feed.description),
    icon: asUrl(feed.icon),
    favicon: asUrl(feed.favicon),
    language: asText(feed.language),
    authors: normalizeAuthors(feed.authors),
    items: (feed.items ?? [])
      .map(normalizeJsonEntry)
      .filter((item): item is SyndicationEntry => item !== null),
  }) as SyndicationFeed
}

function normalizeRssFeed(feed: DeepPartial<Rss.Feed<string>>, sourceUrl?: string): SyndicationFeed | null {
  const title = asText(feed.title)
  if (!title) return null

  return compactRecord({
    format: 'rss',
    sourceUrl,
    feedUrl: sourceUrl,
    homePageUrl: asUrl(feed.link),
    title,
    description: asText(feed.description),
    icon: asUrl(feed.image?.url) ?? asUrl(feed.itunes?.image),
    language: asText(feed.language),
    authors: uniq([
      ...normalizeAuthors(feed.managingEditor),
      ...normalizeAuthors(feed.webMaster),
      ...normalizeAuthors(feed.dc?.creators),
      ...normalizeAuthors(feed.itunes?.author),
    ]),
    items: (feed.items ?? [])
      .map(normalizeRssEntry)
      .filter((item): item is SyndicationEntry => item !== null),
  }) as SyndicationFeed
}

function normalizeAtomFeed(feed: DeepPartial<Atom.Feed<string>>, sourceUrl?: string): SyndicationFeed | null {
  const title = asText(feed.title)
  if (!title) return null

  const homePageUrl = getAtomAlternateUrl(feed.links)
  const selfLink = Array.isArray(feed.links)
    ? asUrl(feed.links.find((link) => link.rel === 'self')?.href)
    : undefined

  return compactRecord({
    format: 'atom',
    sourceUrl,
    feedUrl: selfLink ?? sourceUrl,
    homePageUrl,
    title,
    description: asText(feed.subtitle),
    icon: asUrl(feed.icon) ?? asUrl(feed.logo),
    authors: normalizeAuthors(feed.authors),
    items: (feed.entries ?? [])
      .map(normalizeAtomEntry)
      .filter((item): item is SyndicationEntry => item !== null),
  }) as SyndicationFeed
}

function normalizeRdfFeed(feed: DeepPartial<Rdf.Feed<string>>, sourceUrl?: string): SyndicationFeed | null {
  const title = asText(feed.title)
  if (!title) return null

  return compactRecord({
    format: 'rdf',
    sourceUrl,
    feedUrl: sourceUrl,
    homePageUrl: asUrl(feed.link),
    title,
    description: asText(feed.description),
    icon: asUrl(feed.image?.url),
    authors: normalizeAuthors(feed.dc?.creators),
    items: (feed.items ?? [])
      .map(normalizeRdfEntry)
      .filter((item): item is SyndicationEntry => item !== null),
  }) as SyndicationFeed
}

export function looksLikeFeedUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const pathname = parsed.pathname.toLowerCase()
    const normalizedPath = pathname.replace(/\/+$/, '')
    const formatHint = parsed.searchParams.get('format')?.toLowerCase()
    const feedHint = parsed.searchParams.get('feed')?.toLowerCase()

    return (
      normalizedPath.endsWith('.rss') ||
      normalizedPath.endsWith('.xml') ||
      normalizedPath.endsWith('.atom') ||
      normalizedPath.endsWith('.rdf') ||
      normalizedPath.endsWith('.jsonfeed') ||
      normalizedPath.endsWith('/feed') ||
      normalizedPath.endsWith('/rss') ||
      normalizedPath.endsWith('/atom') ||
      normalizedPath.includes('/feeds/') ||
      formatHint === 'rss' ||
      formatHint === 'atom' ||
      formatHint === 'jsonfeed' ||
      feedHint === 'rss' ||
      feedHint === 'atom'
    )
  } catch {
    return false
  }
}

export async function parseSyndicationFeedDocument(
  value: string,
  sourceUrl?: string,
): Promise<SyndicationFeed | null> {
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    const { parseFeed } = await import('feedsmith')
    const parsed = parseFeed(trimmed)

    switch (parsed.format) {
      case 'json':
        return normalizeJsonFeed(parsed.feed, sourceUrl)
      case 'rss':
        return normalizeRssFeed(parsed.feed, sourceUrl)
      case 'atom':
        return normalizeAtomFeed(parsed.feed, sourceUrl)
      case 'rdf':
        return normalizeRdfFeed(parsed.feed, sourceUrl)
      default:
        return null
    }
  } catch {
    return null
  }
}
