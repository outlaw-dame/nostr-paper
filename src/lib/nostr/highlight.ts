/**
 * NIP-84 Highlights
 *
 * Covers:
 *   - Kind 9802 — Highlight
 *   - `content`   the highlighted text excerpt
 *   - `r`         (optional) source URL (web page being highlighted)
 *   - `a`         (optional) coordinate of source Nostr addressable event
 *   - `e`         (optional) ID of source Nostr event
 *   - `context`   (optional) surrounding passage providing wider context
 *   - `comment`   (optional) annotator's note on the highlight
 *   - `p`         (optional) pubkeys of attributed authors
 *   - `alt`       (optional) machine-readable alt description
 *
 * Spec: https://github.com/nostr-protocol/nips/blob/master/84.md
 */

import {
  isSafeURL,
  isValidHex32,
  sanitizeText,
} from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

// ── Constants ────────────────────────────────────────────────

const MAX_HIGHLIGHT_CHARS = 4_000
const MAX_COMMENT_CHARS   = 600
const MAX_CONTEXT_CHARS   = 1_000
const MAX_P_TAGS          = 16

// ── Types ────────────────────────────────────────────────────

export interface ParsedHighlight {
  /** Event id */
  id:            string
  /** Author pubkey */
  pubkey:        string
  /** Unix timestamp */
  createdAt:     number
  /** The highlighted text excerpt (content field) */
  excerpt:       string
  /** Source web URL, if highlighting a web resource */
  sourceUrl?:    string
  /** Raw address coordinate of source event, e.g. "30023:pubkey:identifier" */
  sourceCoordinate?: string
  /** Source event ID (e-tag), if highlighting a Nostr event directly */
  sourceEventId?: string
  /** Surrounding context passage */
  context?:      string
  /** Annotator's comment / reaction to the highlight */
  comment?:      string
  /** Pubkeys of attributed authors */
  attributedPubkeys: string[]
}

// ── Helpers ──────────────────────────────────────────────────

function getFirstTagValue(event: NostrEvent, name: string): string | undefined {
  for (const tag of event.tags) {
    if (tag[0] === name && typeof tag[1] === 'string' && tag[1].length > 0) {
      return tag[1]
    }
  }
  return undefined
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max).trimEnd()}…`
}

// ── Parser ───────────────────────────────────────────────────

export function isHighlightEvent(event: NostrEvent): boolean {
  return event.kind === Kind.Highlight
}

/**
 * Parse a kind-9802 highlight event.
 * Returns null if the event is the wrong kind or has no usable content.
 */
export function parseHighlightEvent(event: NostrEvent): ParsedHighlight | null {
  if (!isHighlightEvent(event)) return null

  const rawExcerpt = sanitizeText(event.content).trim()
  if (rawExcerpt.length === 0) return null

  const excerpt = truncate(rawExcerpt, MAX_HIGHLIGHT_CHARS)

  // Source URL — must be a safe http(s) URL
  const rawUrl = getFirstTagValue(event, 'r')
  const sourceUrl = rawUrl && isSafeURL(rawUrl) ? rawUrl : undefined

  // Source event coordinate (a-tag)
  const rawCoord = getFirstTagValue(event, 'a')
  const sourceCoordinate = rawCoord && rawCoord.includes(':') ? rawCoord : undefined

  // Source event ID (e-tag)
  const rawEId = getFirstTagValue(event, 'e')
  const sourceEventId = rawEId && isValidHex32(rawEId) ? rawEId : undefined

  // Context passage
  const rawContext = getFirstTagValue(event, 'context')
  const context = rawContext
    ? truncate(sanitizeText(rawContext).trim(), MAX_CONTEXT_CHARS) || undefined
    : undefined

  // Annotator comment
  const rawComment = getFirstTagValue(event, 'comment')
  const comment = rawComment
    ? truncate(sanitizeText(rawComment).trim(), MAX_COMMENT_CHARS) || undefined
    : undefined

  // Attributed pubkeys
  const attributedPubkeys: string[] = []
  for (const tag of event.tags) {
    if (tag[0] !== 'p' || typeof tag[1] !== 'string') continue
    if (!isValidHex32(tag[1])) continue
    attributedPubkeys.push(tag[1])
    if (attributedPubkeys.length >= MAX_P_TAGS) break
  }

  return {
    id:            event.id,
    pubkey:        event.pubkey,
    createdAt:     event.created_at,
    excerpt,
    sourceUrl,
    sourceCoordinate,
    sourceEventId,
    context,
    comment,
    attributedPubkeys,
  }
}

/**
 * Returns a short preview string for use in feed cards and notifications.
 */
export function getHighlightPreviewText(event: NostrEvent): string {
  const highlight = parseHighlightEvent(event)
  if (!highlight) return ''
  const label = highlight.comment ? `"${highlight.excerpt}" — ${highlight.comment}` : `"${highlight.excerpt}"`
  return label.length > 180 ? `${label.slice(0, 177)}…` : label
}

/**
 * Returns a human-readable label for the highlight source.
 * Prefers source URL hostname, falls back to coordinate kind, then generic.
 */
export function getHighlightSourceLabel(highlight: ParsedHighlight): string {
  if (highlight.sourceUrl) {
    try {
      return new URL(highlight.sourceUrl).hostname.replace(/^www\./, '')
    } catch {
      return highlight.sourceUrl
    }
  }
  if (highlight.sourceCoordinate) {
    const kind = highlight.sourceCoordinate.split(':')[0]
    if (kind === '30023') return 'Article'
    if (kind === '34235') return 'Video'
    return 'Nostr event'
  }
  if (highlight.sourceEventId) return 'Nostr note'
  return 'Unknown source'
}
