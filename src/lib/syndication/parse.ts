import type { Atom, Json, Rdf, Rss } from 'feedsmith/types'
import { isSafeURL, sanitizeText } from '@/lib/security/sanitize'
import type {
  SyndicationAttachment,
  SyndicationEntry,
  SyndicationFeed,
  SyndicationPodcastMeta,
} from '@/lib/syndication/types'

type DeepPartial<T> =
  T extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T

type PodcastValue = NonNullable<SyndicationPodcastMeta['value']>
type PodcastValueRecipient = PodcastValue['recipients'][number]

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

function hasOwnProperties(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0
}

function toPositiveFloat(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : undefined
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }

  return undefined
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value !== 'string') return undefined

  const normalized = value.trim().toLowerCase()
  if (!normalized) return undefined
  if (['true', 'yes', '1'].includes(normalized)) return true
  if (['false', 'no', '0'].includes(normalized)) return false
  return undefined
}

function toDurationSeconds(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : undefined
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  if (!trimmed) return undefined

  const direct = Number.parseFloat(trimmed)
  if (Number.isFinite(direct) && direct > 0) return direct

  const hhmmss = trimmed.split(':').map((part) => Number.parseFloat(part))
  if (hhmmss.some((part) => !Number.isFinite(part) || part < 0)) return undefined
  if (hhmmss.length === 3) {
    const [hours, minutes, seconds] = hhmmss
    if (hours === undefined || minutes === undefined || seconds === undefined) return undefined
    return hours * 3600 + minutes * 60 + seconds
  }
  if (hhmmss.length === 2) {
    const [minutes, seconds] = hhmmss
    if (minutes === undefined || seconds === undefined) return undefined
    return minutes * 60 + seconds
  }

  return undefined
}

function getCaseInsensitiveValue(record: Record<string, unknown>, key: string): unknown {
  const direct = record[key]
  if (direct !== undefined) return direct

  const lowered = key.toLowerCase()
  for (const [entryKey, entryValue] of Object.entries(record)) {
    if (entryKey.toLowerCase() === lowered) return entryValue
  }

  return undefined
}

function toPascalCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1)
}

function getPodcastValue(value: unknown, key: string): unknown {
  if (!isRecord(value)) return undefined

  const namespacedKey = `podcast:${key}`
  const underscoredKey = `podcast_${key}`
  const camelNamespacedKey = `podcast${toPascalCase(key)}`

  const nested = getCaseInsensitiveValue(value, 'podcast')
  if (isRecord(nested)) {
    const nestedValue = getCaseInsensitiveValue(nested, key)
    if (nestedValue !== undefined) return nestedValue
  }

  return (
    getCaseInsensitiveValue(value, key)
    ?? getCaseInsensitiveValue(value, namespacedKey)
    ?? getCaseInsensitiveValue(value, underscoredKey)
    ?? getCaseInsensitiveValue(value, camelNamespacedKey)
  )
}

function normalizePodcastFunding(value: unknown): SyndicationPodcastMeta['funding'] {
  const entries = Array.isArray(value) ? value : value === undefined ? [] : [value]
  const funding = entries.flatMap((entry) => {
    if (typeof entry === 'string') {
      const url = asUrl(entry)
      return url ? [{ url }] : []
    }

    if (!isRecord(entry)) return []
    const url = asUrl(entry.url)
    if (!url) return []

    return [compactRecord({
      url,
      value: asText(entry.value),
    }) as SyndicationPodcastMeta['funding'][number]]
  })

  return funding
}

function normalizePodcastPersons(value: unknown): SyndicationPodcastMeta['persons'] {
  const entries = Array.isArray(value) ? value : value === undefined ? [] : [value]

  return entries.flatMap((entry) => {
    if (typeof entry === 'string') {
      const name = asText(entry)
      return name ? [{ name }] : []
    }

    if (!isRecord(entry)) return []

    const name = asText(entry.name)
    if (!name) return []

    return [compactRecord({
      name,
      role: asText(entry.role),
      group: asText(entry.group),
      href: asUrl(entry.href),
      image: asUrl(entry.img ?? entry.image),
    }) as SyndicationPodcastMeta['persons'][number]]
  })
}

function normalizePodcastTranscripts(value: unknown): SyndicationPodcastMeta['transcripts'] {
  const entries = Array.isArray(value) ? value : value === undefined ? [] : [value]

  return entries.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const url = asUrl(entry.url)
    if (!url) return []

    return [compactRecord({
      url,
      type: asString(entry.type),
      language: asText(entry.language),
      rel: asText(entry.rel),
    }) as SyndicationPodcastMeta['transcripts'][number]]
  })
}

function normalizePodcastChapters(value: unknown): SyndicationPodcastMeta['chapters'] {
  if (!isRecord(value)) return undefined
  const url = asUrl(value.url)
  if (!url) return undefined

  return compactRecord({
    url,
    type: asString(value.type),
  }) as SyndicationPodcastMeta['chapters']
}

function normalizePodcastSoundbites(value: unknown): SyndicationPodcastMeta['soundbites'] {
  const entries = Array.isArray(value) ? value : value === undefined ? [] : [value]

  return entries.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const startTime = toDurationSeconds(entry.startTime ?? entry.start)
    const duration = toDurationSeconds(entry.duration)
    if (!startTime || !duration) return []

    return [compactRecord({
      startTime,
      duration,
      title: asText(entry.title),
    }) as SyndicationPodcastMeta['soundbites'][number]]
  })
}

function normalizePodcastSocial(value: unknown): SyndicationPodcastMeta['social'] {
  const entries = Array.isArray(value) ? value : value === undefined ? [] : [value]

  return entries.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const url = asUrl(entry.url)
    const protocol = asText(entry.protocol)
    const accountId = asText(entry.accountId)
    if (!url && !protocol && !accountId) return []

    return [compactRecord({
      url,
      protocol,
      accountId,
      priority: toPositiveNumber(entry.priority),
    }) as SyndicationPodcastMeta['social'][number]]
  })
}

function normalizePodcastValueRecipients(value: unknown): PodcastValue['recipients'] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const address = asText(entry.address)
    if (!address) return []

    return [compactRecord({
      address,
      name: asText(entry.name),
      type: asText(entry.type),
      split: toPositiveFloat(entry.split),
      customKey: asText(entry.customKey),
      customValue: asText(entry.customValue),
    }) as PodcastValueRecipient]
  })
}

function normalizePodcastValue(value: unknown): SyndicationPodcastMeta['value'] {
  if (!isRecord(value)) return undefined

  const recipients = normalizePodcastValueRecipients(value.recipients ?? value.valueRecipient)
  const candidate = compactRecord({
    type: asText(value.type),
    method: asText(value.method),
    currency: asText(value.currency),
    suggested: toPositiveFloat(value.suggested),
    ...(recipients.length > 0 ? { recipients } : {}),
  })

  if (!hasOwnProperties(candidate)) return undefined

  return {
    recipients,
    ...(candidate.type ? { type: candidate.type as string } : {}),
    ...(candidate.method ? { method: candidate.method as string } : {}),
    ...(candidate.currency ? { currency: candidate.currency as string } : {}),
    ...(candidate.suggested ? { suggested: candidate.suggested as number } : {}),
  }
}

function normalizePodcastMeta(value: unknown): SyndicationPodcastMeta | undefined {
  if (!isRecord(value)) return undefined

  const funding = normalizePodcastFunding(getPodcastValue(value, 'funding'))
  const persons = normalizePodcastPersons(getPodcastValue(value, 'person'))
  const transcripts = normalizePodcastTranscripts(getPodcastValue(value, 'transcript'))
  const soundbites = normalizePodcastSoundbites(getPodcastValue(value, 'soundbite'))
  const social = normalizePodcastSocial(getPodcastValue(value, 'socialInteract'))
  const valueSplit = normalizePodcastValue(getPodcastValue(value, 'value'))

  const candidate = compactRecord({
    guid: asText(getPodcastValue(value, 'guid')),
    medium: asText(getPodcastValue(value, 'medium')),
    episode: toPositiveNumber(getPodcastValue(value, 'episode')),
    season: toPositiveNumber(getPodcastValue(value, 'season')),
    episodeType: asText(getPodcastValue(value, 'episodeType')),
    image: asUrl(getPodcastValue(value, 'image')),
    trailer: toBoolean(getPodcastValue(value, 'trailer')),
    explicit: toBoolean(getPodcastValue(value, 'explicit')),
    complete: toBoolean(getPodcastValue(value, 'complete')),
    block: toBoolean(getPodcastValue(value, 'block')),
    locked: toBoolean(getPodcastValue(value, 'locked')),
    chapters: normalizePodcastChapters(getPodcastValue(value, 'chapters')),
    value: valueSplit,
  })

  const hasCollections =
    funding.length > 0 ||
    persons.length > 0 ||
    transcripts.length > 0 ||
    soundbites.length > 0 ||
    social.length > 0

  if (!hasOwnProperties(candidate) && !hasCollections) return undefined

  return {
    funding,
    persons,
    transcripts,
    soundbites,
    social,
    ...(candidate.guid ? { guid: candidate.guid as string } : {}),
    ...(candidate.medium ? { medium: candidate.medium as string } : {}),
    ...(candidate.episode ? { episode: candidate.episode as number } : {}),
    ...(candidate.season ? { season: candidate.season as number } : {}),
    ...(candidate.episodeType ? { episodeType: candidate.episodeType as string } : {}),
    ...(candidate.image ? { image: candidate.image as string } : {}),
    ...(candidate.trailer !== undefined ? { trailer: candidate.trailer as boolean } : {}),
    ...(candidate.explicit !== undefined ? { explicit: candidate.explicit as boolean } : {}),
    ...(candidate.complete !== undefined ? { complete: candidate.complete as boolean } : {}),
    ...(candidate.block !== undefined ? { block: candidate.block as boolean } : {}),
    ...(candidate.locked !== undefined ? { locked: candidate.locked as boolean } : {}),
    ...(candidate.chapters ? { chapters: candidate.chapters as NonNullable<SyndicationPodcastMeta['chapters']> } : {}),
    ...(candidate.value ? { value: candidate.value as NonNullable<SyndicationPodcastMeta['value']> } : {}),
  }
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
    podcast: normalizePodcastMeta(item),
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
    podcast: normalizePodcastMeta(item),
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
    podcast: normalizePodcastMeta(item),
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
    podcast: normalizePodcastMeta(item),
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
    podcast: normalizePodcastMeta(feed),
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
    podcast: normalizePodcastMeta(feed),
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
    podcast: normalizePodcastMeta(feed),
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
    podcast: normalizePodcastMeta(feed),
  }) as SyndicationFeed
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

function mergeJsonPodcastMetaFromRaw(
  feed: SyndicationFeed,
  rawJson: Record<string, unknown> | null,
): SyndicationFeed {
  if (!rawJson) return feed

  const rawFeedPodcast = normalizePodcastMeta(rawJson)
  const rawItems = Array.isArray(rawJson.items) ? rawJson.items : []

  let itemsChanged = false
  const mergedItems = feed.items.map((item, index) => {
    if (item.podcast) return item

    const rawItem = rawItems[index]
    const rawPodcast = normalizePodcastMeta(rawItem)
    if (!rawPodcast) return item

    itemsChanged = true
    return {
      ...item,
      podcast: rawPodcast,
    }
  })

  if (!rawFeedPodcast && !itemsChanged) {
    return feed
  }

  return {
    ...feed,
    ...(feed.podcast ? {} : rawFeedPodcast ? { podcast: rawFeedPodcast } : {}),
    items: itemsChanged ? mergedItems : feed.items,
  }
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
        {
          const normalized = normalizeJsonFeed(parsed.feed, sourceUrl)
          if (!normalized) return null
          const rawJson = parseJsonRecord(trimmed)
          return mergeJsonPodcastMetaFromRaw(normalized, rawJson)
        }
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
