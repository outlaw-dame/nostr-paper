import {
  fetchSyndicationSource,
  fetchSyndicationSourceWithDiagnostics,
  type SyndicationFetchErrorCode,
} from '@/lib/syndication/fetch'
import { parseSyndicationFeedDocument } from '@/lib/syndication/parse'
import { rankSemanticDocuments } from '@/lib/semantic/client'
import { normalizeSemanticQuery } from '@/lib/semantic/text'
import { isSafeURL } from '@/lib/security/sanitize'
import type { SemanticDocument } from '@/types'
import type { SyndicationFeed } from '@/lib/syndication/types'

const MAX_CACHE = 100
const MAX_DISCOVERY_CANDIDATES = 10
const FEEDSEARCH_MAX_RESULTS = 12
const FEED_MIME_HINTS = [
  'application/rss+xml',
  'application/atom+xml',
  'application/rdf+xml',
  'application/feed+json',
  'application/xml',
  'text/xml',
  'application/json',
]
const FEEDSEARCH_API_BASE = (import.meta.env.VITE_FEEDSEARCH_API_BASE as string | undefined)?.trim() || 'https://feedsearch.dev'

const cache = new Map<string, SyndicationFeed | null>()
const inflight = new Map<string, Promise<SyndicationFeed | null>>()

export type SyndicationVerifyErrorCode = SyndicationFetchErrorCode | 'parse-failed'

export interface VerifySyndicationFeedResult {
  feed: SyndicationFeed | null
  errorCode: SyndicationVerifyErrorCode | null
}

interface FetchSyndicationFeedOptions {
  bypassCache?: boolean
}

type CandidateKind = 'linked' | 'common' | 'feedsearch'

interface DiscoveryCandidate {
  url: string
  kind: CandidateKind
  titleHint?: string
  itemCountHint?: number
}

export interface SyndicationDiscoveredFeedCandidate {
  url: string
  title: string
  format: SyndicationFeed['format']
  itemCount: number
  via: 'direct' | CandidateKind
  rankingReasons: string[]
}

export interface DiscoverSyndicationFeedCandidatesResult {
  candidates: SyndicationDiscoveredFeedCandidate[]
  errorCode: SyndicationVerifyErrorCode | null
  usedFeedsearchFallback: boolean
}

type SyndicationSourceLike = {
  url: string
  contentType: string
  content: string
}

function normalizeUrlString(value: string): string {
  try {
    return new URL(value).toString()
  } catch {
    return value
  }
}

function extractAttribute(tag: string, attribute: string): string | null {
  const pattern = new RegExp(`${attribute}\\s*=\\s*["']([^"']{1,2048})["']`, 'i')
  return tag.match(pattern)?.[1] ?? null
}

function isLikelyHtmlDocument(source: SyndicationSourceLike): boolean {
  const loweredType = source.contentType.toLowerCase()
  if (loweredType.includes('text/html') || loweredType.includes('application/xhtml+xml')) {
    return true
  }

  const trimmed = source.content.trimStart().slice(0, 256).toLowerCase()
  return trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html')
}

function resolveCandidateUrl(rawHref: string, baseUrl: string): string | null {
  const trimmed = rawHref.trim()
  if (!trimmed) return null

  try {
    const resolved = new URL(trimmed, baseUrl)
    const normalized = resolved.toString()
    if (!isSafeURL(normalized)) return null
    if (resolved.protocol !== 'https:' && !(import.meta.env.DEV && resolved.protocol === 'http:')) {
      return null
    }
    return normalized
  } catch {
    return null
  }
}

function parseFeedFormatHint(version: string | null | undefined, contentType: string | null | undefined): SyndicationFeed['format'] | null {
  const normalizedVersion = (version ?? '').toLowerCase()
  const normalizedContentType = (contentType ?? '').toLowerCase()

  if (normalizedVersion.includes('jsonfeed')) return 'json'
  if (normalizedVersion.includes('atom')) return 'atom'
  if (normalizedVersion.includes('rdf')) return 'rdf'
  if (normalizedVersion.includes('rss')) return 'rss'
  if (normalizedContentType.includes('application/feed+json') || normalizedContentType.includes('json')) return 'json'
  if (normalizedContentType.includes('atom')) return 'atom'
  if (normalizedContentType.includes('rdf')) return 'rdf'
  if (normalizedContentType.includes('rss') || normalizedContentType.includes('xml')) return 'rss'
  return null
}

function toPositiveInt(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function fetchFeedsearchCandidates(inputUrl: string): Promise<DiscoveryCandidate[]> {
  const endpoint = `${FEEDSEARCH_API_BASE.replace(/\/+$/, '')}/api/v1/search?url=${encodeURIComponent(inputUrl)}&info=true&opml=false`

  let response: Response
  try {
    response = await fetch(endpoint, {
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    return []
  }

  if (!response.ok) return []

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return []
  }

  if (!Array.isArray(payload)) return []

  const candidates: DiscoveryCandidate[] = []
  for (const row of payload) {
    if (!isRecord(row)) continue
    const rawUrl = typeof row.url === 'string' ? row.url : ''
    const resolved = resolveCandidateUrl(rawUrl, inputUrl)
    if (!resolved) continue

    const titleHint = typeof row.title === 'string'
      ? row.title.trim().slice(0, 180)
      : typeof row.site_name === 'string'
        ? row.site_name.trim().slice(0, 180)
        : undefined

    const itemCountHint = toPositiveInt(row.item_count)
    const formatHint = parseFeedFormatHint(
      typeof row.version === 'string' ? row.version : undefined,
      typeof row.content_type === 'string' ? row.content_type : undefined,
    )

    candidates.push({
      url: resolved,
      kind: 'feedsearch',
      ...(titleHint ? { titleHint } : {}),
      ...(itemCountHint !== undefined ? { itemCountHint } : {}),
      ...(formatHint ? { titleHint: titleHint ?? `${formatHint.toUpperCase()} feed` } : {}),
    })
    if (candidates.length >= FEEDSEARCH_MAX_RESULTS) break
  }

  return candidates
}

function buildSemanticDiscoveryQuery(inputUrl: string): string | null {
  try {
    const parsed = new URL(inputUrl)
    const hostname = parsed.hostname.replace(/^www\./i, '').replace(/\./g, ' ')
    const pathname = parsed.pathname
      .split('/')
      .filter(Boolean)
      .join(' ')

    const query = [hostname, pathname, 'rss atom json feed news updates podcast'].filter(Boolean).join(' ')
    return normalizeSemanticQuery(query)
  } catch {
    return normalizeSemanticQuery(inputUrl)
  }
}

function buildCandidateSemanticText(candidate: SyndicationDiscoveredFeedCandidate): string {
  const sourceHint = candidate.via === 'linked'
    ? 'linked from page'
    : candidate.via === 'common'
      ? 'common feed path'
      : candidate.via === 'feedsearch'
        ? 'feedsearch result'
        : 'direct feed'

  return [
    candidate.title,
    candidate.url,
    candidate.format,
    `${candidate.itemCount} items`,
    sourceHint,
  ].join(' ').slice(0, 320)
}

async function rankCandidatesWithSemanticBoost(
  inputUrl: string,
  candidates: SyndicationDiscoveredFeedCandidate[],
): Promise<SyndicationDiscoveredFeedCandidate[]> {
  if (candidates.length <= 1) return candidates

  const semanticQuery = buildSemanticDiscoveryQuery(inputUrl)
  const semanticScoreById = new Map<string, number>()
  if (semanticQuery) {
    try {
      const docs: SemanticDocument[] = candidates.map((candidate, index) => ({
        id: `${index}`,
        kind: 'profile',
        text: buildCandidateSemanticText(candidate),
        updatedAt: Date.now(),
      }))
      const matches = await rankSemanticDocuments(semanticQuery, docs, candidates.length)
      for (const match of matches) {
        semanticScoreById.set(match.id, match.score)
      }
    } catch {
      // Semantic ranking is best-effort; fallback to deterministic heuristics.
    }
  }

  const viaBaseScore: Record<SyndicationDiscoveredFeedCandidate['via'], number> = {
    direct: 40,
    linked: 24,
    common: 14,
    feedsearch: 10,
  }

  const viaReason: Record<SyndicationDiscoveredFeedCandidate['via'], string> = {
    direct: 'Direct feed URL match',
    linked: 'Linked from page metadata',
    common: 'Matched common feed endpoint',
    feedsearch: 'Found via Feedsearch fallback',
  }

  return candidates
    .map((candidate, index) => {
      const semanticScore = semanticScoreById.get(`${index}`) ?? 0
      const itemScore = Math.min(candidate.itemCount, 200) / 20
      const totalScore = viaBaseScore[candidate.via] + itemScore + (semanticScore * 40)
      const reasons: string[] = [viaReason[candidate.via]]

      if (semanticScore > 0) {
        reasons.push(`Semantic relevance ${(semanticScore * 100).toFixed(0)}%`)
      }

      if (candidate.itemCount > 0) {
        reasons.push(`${candidate.itemCount} items detected`)
      }

      return {
        candidate,
        totalScore,
        reasons,
      }
    })
    .sort((left, right) => {
      if (right.totalScore !== left.totalScore) return right.totalScore - left.totalScore
      return left.candidate.url.localeCompare(right.candidate.url)
    })
    .map((entry) => ({
      ...entry.candidate,
      rankingReasons: entry.reasons,
    }))
}

function discoverFeedLinksFromHtml(html: string, baseUrl: string): DiscoveryCandidate[] {
  const candidates: DiscoveryCandidate[] = []
  const headWindow = html.slice(0, 180_000)
  const linkTags = headWindow.match(/<link\b[^>]*>/gi) ?? []

  for (const tag of linkTags) {
    const rel = (extractAttribute(tag, 'rel') ?? '').toLowerCase()
    if (!rel.includes('alternate')) continue

    const type = (extractAttribute(tag, 'type') ?? '').toLowerCase()
    const hasFeedTypeHint = FEED_MIME_HINTS.some((mime) => type.includes(mime))
    if (!hasFeedTypeHint) continue

    const href = extractAttribute(tag, 'href')
    if (!href) continue

    const resolved = resolveCandidateUrl(href, baseUrl)
    if (resolved) {
      candidates.push({
        url: resolved,
        kind: 'linked',
      })
    }
  }

  return candidates
}

function buildCommonFeedCandidates(pageUrl: string): DiscoveryCandidate[] {
  try {
    const parsed = new URL(pageUrl)
    const origin = parsed.origin
    const path = parsed.pathname.replace(/\/+$/, '')
    const scoped = path && path !== '/'
      ? [
          `${origin}${path}/feed`,
          `${origin}${path}/rss`,
          `${origin}${path}/atom.xml`,
          `${origin}${path}/feed.xml`,
        ]
      : []

    return [
      ...scoped,
      `${origin}/feed`,
      `${origin}/rss`,
      `${origin}/atom.xml`,
      `${origin}/feed.xml`,
      `${origin}/rss.xml`,
      `${origin}/index.xml`,
    ]
      .map((value) => resolveCandidateUrl(value, pageUrl))
      .filter((value): value is string => Boolean(value))
      .map((url) => ({
        url,
        kind: 'common' as const,
      }))
  } catch {
    return []
  }
}

function getDiscoveryCandidates(inputUrl: string, source: SyndicationSourceLike): DiscoveryCandidate[] {
  if (!isLikelyHtmlDocument(source)) return []

  const discovered = discoverFeedLinksFromHtml(source.content, source.url)
  const common = buildCommonFeedCandidates(source.url)
  const blocked = new Set([normalizeUrlString(inputUrl), normalizeUrlString(source.url)])
  const seen = new Set<string>()
  const candidates: DiscoveryCandidate[] = []

  for (const candidate of [...discovered, ...common]) {
    const normalized = normalizeUrlString(candidate.url)
    if (blocked.has(normalized) || seen.has(normalized)) continue
    seen.add(normalized)
    candidates.push(candidate)
    if (candidates.length >= MAX_DISCOVERY_CANDIDATES) break
  }

  return candidates
}

async function parseDiscoveredFeed(
  inputUrl: string,
  source: SyndicationSourceLike,
  options: FetchSyndicationFeedOptions = {},
): Promise<SyndicationFeed | null> {
  const candidates = getDiscoveryCandidates(inputUrl, source)
  if (candidates.length === 0) return null

  for (const candidate of candidates) {
    const candidateResult = await fetchSyndicationSourceWithDiagnostics(
      candidate.url,
      options.bypassCache === undefined
        ? {}
        : { bypassCache: options.bypassCache },
    )
    if (!candidateResult.source) continue

    const parsed = await parseSyndicationFeedDocument(candidateResult.source.content, candidateResult.source.url)
    if (parsed) return parsed
  }

  return null
}

async function discoverParsedFeedCandidates(
  inputUrl: string,
  options: FetchSyndicationFeedOptions = {},
): Promise<DiscoverSyndicationFeedCandidatesResult> {
  const sourceResult = await fetchSyndicationSourceWithDiagnostics(
    inputUrl,
    options.bypassCache === undefined
      ? {}
      : { bypassCache: options.bypassCache },
  )
  if (!sourceResult.source) {
    return {
      candidates: [],
      errorCode: sourceResult.error?.code ?? 'network-error',
      usedFeedsearchFallback: false,
    }
  }

  const directParsed = await parseSyndicationFeedDocument(sourceResult.source.content, sourceResult.source.url)
  if (directParsed) {
    return {
      candidates: [{
        url: sourceResult.source.url,
        title: directParsed.title || sourceResult.source.url,
        format: directParsed.format,
        itemCount: directParsed.items.length,
        via: 'direct',
        rankingReasons: ['Direct feed URL match'],
      }],
      errorCode: null,
      usedFeedsearchFallback: false,
    }
  }

  const localDiscoveryCandidates = getDiscoveryCandidates(inputUrl, sourceResult.source)
  const feedsearchCandidates = localDiscoveryCandidates.length === 0
    ? await fetchFeedsearchCandidates(inputUrl)
    : []
  const discoveryCandidates = localDiscoveryCandidates.length > 0
    ? localDiscoveryCandidates
    : feedsearchCandidates
  const usedFeedsearchFallback = localDiscoveryCandidates.length === 0 && feedsearchCandidates.length > 0

  const parsedCandidates: SyndicationDiscoveredFeedCandidate[] = []
  const seenUrls = new Set<string>()

  for (const candidate of discoveryCandidates) {
    const result = await fetchSyndicationSourceWithDiagnostics(
      candidate.url,
      options.bypassCache === undefined
        ? {}
        : { bypassCache: options.bypassCache },
    )
    if (!result.source) continue

    const parsed = await parseSyndicationFeedDocument(result.source.content, result.source.url)
    if (!parsed) continue

    const normalizedUrl = normalizeUrlString(result.source.url)
    if (seenUrls.has(normalizedUrl)) continue
    seenUrls.add(normalizedUrl)

    const title = parsed.title || candidate.titleHint || result.source.url
    const itemCount = parsed.items.length > 0 ? parsed.items.length : (candidate.itemCountHint ?? 0)

    parsedCandidates.push({
      url: result.source.url,
      title,
      format: parsed.format,
      itemCount,
      via: candidate.kind,
      rankingReasons: [],
    })
  }

  const rankedCandidates = await rankCandidatesWithSemanticBoost(inputUrl, parsedCandidates)

  return {
    candidates: rankedCandidates,
    errorCode: rankedCandidates.length === 0 ? 'parse-failed' : null,
    usedFeedsearchFallback,
  }
}

function evictIfNeeded(): void {
  if (cache.size <= MAX_CACHE) return
  const firstKey = cache.keys().next().value
  if (firstKey !== undefined) cache.delete(firstKey)
}

async function doFetch(url: string): Promise<SyndicationFeed | null> {
  const source = await fetchSyndicationSource(url)
  if (!source) return null

  const parsed = await parseSyndicationFeedDocument(source.content, source.url)
  if (parsed) return parsed

  return parseDiscoveredFeed(url, source)
}

async function doFetchWithDiagnostics(url: string, options: FetchSyndicationFeedOptions = {}): Promise<VerifySyndicationFeedResult> {
  const sourceResult = await fetchSyndicationSourceWithDiagnostics(
    url,
    options.bypassCache === undefined
      ? {}
      : { bypassCache: options.bypassCache },
  )
  if (!sourceResult.source) {
    return {
      feed: null,
      errorCode: sourceResult.error?.code ?? 'network-error',
    }
  }

  const parsed = await parseSyndicationFeedDocument(sourceResult.source.content, sourceResult.source.url)
  if (parsed) {
    return {
      feed: parsed,
      errorCode: null,
    }
  }

  const discovered = await parseDiscoveredFeed(url, sourceResult.source, options)
  if (!discovered) {
    return {
      feed: null,
      errorCode: 'parse-failed',
    }
  }

  return {
    feed: discovered,
    errorCode: null,
  }
}

export function peekSyndicationFeed(url: string): SyndicationFeed | null | undefined {
  if (!cache.has(url)) return undefined
  return cache.get(url) ?? null
}

export async function fetchSyndicationFeed(url: string): Promise<SyndicationFeed | null> {
  if (cache.has(url)) return cache.get(url) ?? null

  const existing = inflight.get(url)
  if (existing) return existing

  const promise = doFetch(url).then((result) => {
    inflight.delete(url)

    if (result !== null) {
      cache.set(url, result)
      evictIfNeeded()
    }

    return result
  })

  inflight.set(url, promise)
  return promise
}

export async function verifySyndicationFeed(url: string): Promise<VerifySyndicationFeedResult> {
  return doFetchWithDiagnostics(url, {
    bypassCache: true,
  })
}

export async function discoverSyndicationFeedCandidates(url: string): Promise<DiscoverSyndicationFeedCandidatesResult> {
  return discoverParsedFeedCandidates(url, {
    bypassCache: true,
  })
}
