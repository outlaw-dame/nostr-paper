/**
 * NIP-23 Long-form Content
 *
 * Covers:
 *   - Kind 30023 — published long-form articles
 *   - Kind 30024 — draft long-form articles
 *   - `d`            identifier tag (required, addressable key)
 *   - `title`        display title
 *   - `summary`      short excerpt
 *   - `image`        cover image URL
 *   - `published_at` original publication unix timestamp
 *   - `t`            hashtags (up to MAX_HASHTAGS)
 *   - `a`            cross-references to other addressable events
 *
 * Spec: https://github.com/nostr-protocol/nips/blob/master/23.md
 */

import { naddrEncode, decodeNostrURI } from 'nostr-tools/nip19'
import { parseAddressCoordinate } from '@/lib/nostr/addressable'
import { getNip21Route } from '@/lib/nostr/nip21'
import {
  extractURLs,
  isSafeMediaURL,
  isSafeURL,
  isValidHex32,
  sanitizeText,
} from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

// ── Constants ────────────────────────────────────────────────

const MAX_IDENTIFIER_CHARS = 512
const MAX_TITLE_CHARS      = 300
const MAX_SUMMARY_CHARS    = 600
const MAX_HASHTAGS         = 32
const MAX_REFERENCES       = 64
const CONTROL_CHARS        = /[\u0000-\u001f\u007f]/u

// ── Types ────────────────────────────────────────────────────

/**
 * A parsed `a` tag referencing another addressable event.
 * Most commonly points to another kind-30023 article.
 */
export interface ArticleCrossReference {
  /** Raw address string, e.g. "30023:pubkey:identifier" */
  coordinate: string
  kind:        number
  pubkey:      string
  identifier:  string
  /** Optional relay hint — validated as a safe URL */
  relayHint?:  string
  /** NIP-19 naddr encoding for routing */
  naddr:       string
}

export interface LongFormArticle {
  id:           string
  pubkey:       string
  identifier:   string
  /** true for kind-30024 drafts, false for kind-30023 published articles */
  isDraft:      boolean
  title?:       string
  summary?:     string
  image?:       string
  /**
   * Unix timestamp of original publication (from `published_at` tag).
   * May be absent — use updatedAt as the display timestamp in that case.
   */
  publishedAt?: number
  /** Unix timestamp of the event itself (created_at). Always present. */
  updatedAt:    number
  hashtags:     string[]
  /**
   * Cross-references parsed from `a` tags — other articles this one links to.
   * Empty array when no `a` tags are present.
   */
  references:   ArticleCrossReference[]
  route:        string
  naddr:        string
}

interface LongFormTagMap {
  d?:           string
  title?:       string
  image?:       string
  summary?:     string
  publishedAt?: number
  hashtags:     string[]
  references:   ArticleCrossReference[]
}

// ── Tag Helpers ──────────────────────────────────────────────

function getFirstTagValue(event: NostrEvent, name: string): string | undefined {
  for (const tag of event.tags) {
    if (tag[0] === name && typeof tag[1] === 'string') {
      return tag[1]
    }
  }
  return undefined
}

function getTagValues(event: NostrEvent, name: string): string[] {
  const values: string[] = []
  for (const tag of event.tags) {
    if (tag[0] === name && typeof tag[1] === 'string') {
      values.push(tag[1])
    }
  }
  return values
}

// ── Validation Helpers ───────────────────────────────────────

export function normalizeLongFormIdentifier(identifier: string): string | null {
  if (typeof identifier !== 'string') return null
  if (identifier.length === 0 || identifier.length > MAX_IDENTIFIER_CHARS) return null
  if (CONTROL_CHARS.test(identifier)) return null
  if (identifier.trim().length === 0) return null
  return identifier
}

function parsePublishedAt(raw: string | undefined): number | undefined {
  if (typeof raw !== 'string' || !/^\d{1,16}$/.test(raw)) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) return undefined
  return value
}

function sanitizeOptionalText(value: string | undefined, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const sanitized = sanitizeText(value).trim().slice(0, maxChars)
  return sanitized.length > 0 ? sanitized : undefined
}

function normalizeRelayHint(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 512) return undefined

  try {
    const parsed = new URL(normalized)
    if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') return undefined
    return normalized
  } catch {
    return undefined
  }
}

// ── Markdown Fallback Extractors ─────────────────────────────

function extractMarkdownTitle(content: string): string | undefined {
  for (const line of content.split('\n')) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*$/)
    if (!match?.[1]) continue
    return sanitizeOptionalText(match[1], MAX_TITLE_CHARS)
  }
  return undefined
}

function extractMarkdownSummary(content: string): string | undefined {
  const withoutCode = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, ' ')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[>*-]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return sanitizeOptionalText(withoutCode, MAX_SUMMARY_CHARS)
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

function isLikelyArticleImageUrl(url: string): boolean {
  if (!isSafeURL(url)) return false

  if (isSafeMediaURL(url)) {
    try {
      const extension = (new URL(url).pathname.toLowerCase().split('.').pop() ?? '')
      if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(extension)) return true
    } catch {
      return false
    }
  }

  return hasOpaqueMediaPath(url)
}

function extractMarkdownImage(content: string): string | undefined {
  const markdownImageMatches = [...content.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi)]
  for (const match of markdownImageMatches) {
    const candidate = match[1]
    if (candidate && isLikelyArticleImageUrl(candidate)) return candidate
  }

  return extractURLs(content).find((url) => isLikelyArticleImageUrl(url))
}

// ── Cross-Reference (`a` tag) Parser ─────────────────────────

/**
 * Parse all `a` tags from the event into validated ArticleCrossReference objects.
 *
 * Malformed, non-addressable, or unsafe entries are silently dropped.
 * Duplicates (same coordinate) are deduplicated.
 */
function parseCrossReferences(event: NostrEvent): ArticleCrossReference[] {
  const seen = new Set<string>()
  const refs: ArticleCrossReference[] = []

  for (const tag of event.tags) {
    if (refs.length >= MAX_REFERENCES) break
    if (tag[0] !== 'a' || typeof tag[1] !== 'string') continue

    const coord = parseAddressCoordinate(tag[1])
    if (!coord) continue

    const coordinate = `${coord.kind}:${coord.pubkey}:${coord.identifier}`
    if (seen.has(coordinate)) continue
    seen.add(coordinate)

    const relayHint = normalizeRelayHint(typeof tag[2] === 'string' ? tag[2] : undefined)

    try {
      const naddr = naddrEncode({
        kind:       coord.kind,
        pubkey:     coord.pubkey,
        identifier: coord.identifier,
        ...(relayHint ? { relays: [relayHint] } : {}),
      })
      refs.push({
        coordinate,
        kind:       coord.kind,
        pubkey:     coord.pubkey,
        identifier: coord.identifier,
        ...(relayHint ? { relayHint } : {}),
        naddr,
      })
    } catch {
      // naddrEncode can throw on invalid inputs — skip
    }
  }

  return refs
}

// ── Tag Map Parser ───────────────────────────────────────────

function parseLongFormTags(event: NostrEvent): LongFormTagMap {
  const hashtags = [...new Set(
    getTagValues(event, 't')
      .map(value => sanitizeText(value).trim().toLowerCase())
      .filter(value => value.length > 0)
      .slice(0, MAX_HASHTAGS),
  )]

  const identifier = normalizeLongFormIdentifier(getFirstTagValue(event, 'd') ?? '')
  const title      = sanitizeOptionalText(getFirstTagValue(event, 'title'), MAX_TITLE_CHARS)
  const summary    = sanitizeOptionalText(getFirstTagValue(event, 'summary'), MAX_SUMMARY_CHARS)
  const publishedAt = parsePublishedAt(getFirstTagValue(event, 'published_at'))

  const rawImage = getFirstTagValue(event, 'image')
  const image = rawImage && isSafeMediaURL(rawImage) ? rawImage : undefined

  const references = parseCrossReferences(event)

  return {
    ...(identifier  ? { d: identifier }    : {}),
    ...(title       ? { title }             : {}),
    ...(summary     ? { summary }           : {}),
    ...(image       ? { image }             : {}),
    ...(publishedAt !== undefined ? { publishedAt } : {}),
    hashtags,
    references,
  }
}

// ── Public Predicates ────────────────────────────────────────

/** True for published kind-30023 articles with a valid `d` tag. */
export function isLongFormEvent(event: NostrEvent): boolean {
  return event.kind === Kind.LongFormContent && getLongFormIdentifier(event) !== null
}

/** True for draft kind-30024 articles with a valid `d` tag. */
export function isDraftLongFormEvent(event: NostrEvent): boolean {
  return event.kind === Kind.LongFormDraft && getLongFormIdentifier(event) !== null
}

/**
 * Get the `d` tag identifier from a kind-30023 OR kind-30024 event.
 * Returns null if the event is not a long-form kind or has no valid `d` tag.
 */
export function getLongFormIdentifier(event: NostrEvent): string | null {
  if (event.kind !== Kind.LongFormContent && event.kind !== Kind.LongFormDraft) return null
  return normalizeLongFormIdentifier(getFirstTagValue(event, 'd') ?? '')
}

// ── Route / Address Helpers ──────────────────────────────────

export function getArticleRoute(pubkey: string, identifier: string): string {
  return `/article/${pubkey}/${encodeURIComponent(identifier)}`
}

export function getDraftRoute(pubkey: string, identifier: string): string {
  return `/draft/${pubkey}/${encodeURIComponent(identifier)}`
}

export function getArticleNaddr(pubkey: string, identifier: string): string {
  return naddrEncode({
    kind: Kind.LongFormContent,
    pubkey,
    identifier,
  })
}

export function getDraftNaddr(pubkey: string, identifier: string): string {
  return naddrEncode({
    kind: Kind.LongFormDraft,
    pubkey,
    identifier,
  })
}

// ── Core Parsers ─────────────────────────────────────────────

/**
 * Parse a kind-30023 OR kind-30024 long-form event.
 *
 * Returns null if:
 *   - The kind is neither 30023 nor 30024
 *   - The event has no valid `d` tag
 */
export function parseLongFormEvent(event: NostrEvent): LongFormArticle | null {
  const isPublished = event.kind === Kind.LongFormContent
  const isDraft     = event.kind === Kind.LongFormDraft
  if (!isPublished && !isDraft) return null

  const tags = parseLongFormTags(event)
  if (!tags.d) return null

  const title   = tags.title   ?? extractMarkdownTitle(event.content)
  const summary = tags.summary ?? extractMarkdownSummary(event.content)
  const image   = tags.image   ?? extractMarkdownImage(event.content)

  return {
    id:           event.id,
    pubkey:       event.pubkey,
    identifier:   tags.d,
    isDraft,
    ...(title       ? { title }                 : {}),
    ...(summary     ? { summary }               : {}),
    ...(image       ? { image }                 : {}),
    ...(tags.publishedAt !== undefined ? { publishedAt: tags.publishedAt } : {}),
    hashtags:   tags.hashtags,
    references: tags.references,
    updatedAt:  event.created_at,
    route: isDraft
      ? getDraftRoute(event.pubkey, tags.d)
      : getArticleRoute(event.pubkey, tags.d),
    naddr: isDraft
      ? getDraftNaddr(event.pubkey, tags.d)
      : getArticleNaddr(event.pubkey, tags.d),
  }
}

// ── Address Decoding ─────────────────────────────────────────

export interface ArticleAddress {
  pubkey:     string
  identifier: string
  isDraft:    boolean
}

/**
 * Decode a NIP-19 naddr string (or nostr:naddr1... URI) for a long-form address.
 *
 * Accepts both kind-30023 (published) and kind-30024 (draft).
 * Returns null for invalid input or wrong kinds.
 */
export function decodeLongFormAddress(value: string): ArticleAddress | null {
  try {
    const decoded = decodeNostrURI(value)
    if (decoded.type !== 'naddr') return null
    const { kind, pubkey, identifier } = decoded.data

    const isPublished = kind === Kind.LongFormContent
    const isDraft     = kind === Kind.LongFormDraft
    if (!isPublished && !isDraft) return null

    const normalizedIdentifier = normalizeLongFormIdentifier(identifier)
    if (!normalizedIdentifier || !isValidHex32(pubkey)) return null

    return {
      pubkey,
      identifier: normalizedIdentifier,
      isDraft,
    }
  } catch {
    return null
  }
}

// ── Markdown Safety Helpers (used by MarkdownContent) ────────

function isSafeHttpUrlOrNostr(value: string): boolean {
  return value.startsWith('nostr:') || isSafeURL(value)
}

export function getNostrUriRoute(uri: string): string | null {
  return getNip21Route(uri)
}

export function isSafeMarkdownLinkDestination(value: string): boolean {
  return typeof value === 'string' && isSafeHttpUrlOrNostr(value)
}
