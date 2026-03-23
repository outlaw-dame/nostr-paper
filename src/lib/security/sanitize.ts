/**
 * Security & Sanitization
 *
 * All user-originated content must pass through these utilities
 * before being displayed or stored. Defense-in-depth:
 *
 * 1. Input validation (type + length + format guards)
 * 2. Content sanitization (DOMPurify for HTML, custom for text)
 * 3. URL validation (allowlist-based scheme + hostname checks)
 * 4. Content Security Policy helpers
 * 5. Nostr-specific validation (event structure + signature)
 */

import DOMPurify from 'dompurify'
import { verifyEvent } from 'nostr-tools'
import type { NostrEvent, HexString, RelayURL } from '@/types'

// ── Constants ────────────────────────────────────────────────

/** Maximum allowed byte lengths */
export const LIMITS = {
  CONTENT_BYTES:    65_536,    // 64KB note content
  PUBKEY_BYTES:     64,        // 32 bytes hex
  EVENT_ID_BYTES:   64,        // 32 bytes hex
  SIG_BYTES:        128,       // 64 bytes hex
  URL_CHARS:        2_048,
  NIP05_CHARS:      256,
  NAME_CHARS:       150,
  ABOUT_CHARS:      1_024,
  TAG_NAME_CHARS:   1,         // NIP-01: single-letter tags for indexing
  RELAY_URL_CHARS:  512,
  MAX_TAGS:         2_000,
} as const

/** Allowed URL schemes for media and links */
const ALLOWED_SCHEMES = new Set(['https:', 'http:'])
const MEDIA_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'apng', 'bmp', 'ico', 'jfif', 'svg', 'tif', 'tiff',
  'heic', 'heif', 'jxl',
  'mp4', 'webm', 'mov', 'm4v', 'ogv',
  'mp3', 'ogg', 'oga', 'flac', 'wav', 'aac', 'm4a', 'opus',
])

/**
 * Known non-media file extensions to reject in isSafeMediaURL.
 * Declared at module level to avoid re-allocation on every call.
 */
const NON_MEDIA_EXTENSIONS = new Set([
  'js', 'ts', 'mjs', 'cjs',
  'php', 'asp', 'aspx', 'jsp',
  'html', 'htm', 'xhtml',
  'exe', 'sh', 'bat', 'cmd',
  'py', 'rb', 'pl',
  'xml', 'json', 'csv',
])

/** Hex character pattern */
const HEX_PATTERN = /^[0-9a-f]+$/
const HASHTAG_BODY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,100}$/

/** WebSocket URL pattern */
const WS_URL_PATTERN = /^wss?:\/\/.+/

// ── DOMPurify Configuration ──────────────────────────────────

// Configure DOMPurify once with strict allowlist
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's',
    'code', 'pre', 'blockquote',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'a',
    'img',
    'hr',
  ],
  ALLOWED_ATTR: [
    'href', 'title', 'rel', 'target',
    'src', 'alt', 'width', 'height', 'loading',
  ],
  ALLOW_DATA_ATTR: false,
  FORBID_CONTENTS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
  FORCE_BODY: false,
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
  // Hooks to enforce additional constraints
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'style', 'class'],
}

// Add hook to sanitize hrefs and srcs after parsing
if (typeof window !== 'undefined') {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if ('href' in node) {
      const href = (node as HTMLAnchorElement).href
      if (!isSafeURL(href)) {
        node.removeAttribute('href')
      } else {
        // Force noopener noreferrer on all external links
        ;(node as HTMLAnchorElement).rel = 'noopener noreferrer nofollow'
        ;(node as HTMLAnchorElement).target = '_blank'
      }
    }

    if ('src' in node) {
      const src = (node as HTMLImageElement).src
      if (!isSafeMediaURL(src)) {
        node.removeAttribute('src')
      }
      // Force lazy loading on all images
      ;(node as HTMLImageElement).loading = 'lazy'
    }
  })
}

// ── Sanitization Functions ───────────────────────────────────

/**
 * Sanitize arbitrary HTML from Nostr note content.
 * Returns a safe HTML string or empty string on failure.
 */
export function sanitizeHTML(html: string): string {
  if (typeof html !== 'string') return ''
  if (html.length > LIMITS.CONTENT_BYTES) {
    html = html.slice(0, LIMITS.CONTENT_BYTES)
  }
  try {
    return DOMPurify.sanitize(html, PURIFY_CONFIG) as string
  } catch {
    return ''
  }
}

/**
 * Sanitize plain text content — strips all HTML.
 * Use for display in text-only contexts (previews, notifications).
 */
export function sanitizeText(text: string): string {
  if (typeof text !== 'string') return ''
  if (text.length > LIMITS.CONTENT_BYTES) {
    text = text.slice(0, LIMITS.CONTENT_BYTES)
  }
  // Strip all HTML tags
  try {
    return DOMPurify.sanitize(text, {
      ALLOWED_TAGS: [],
      ALLOWED_ATTR: [],
    }) as string
  } catch {
    // If DOMPurify fails, do basic tag stripping
    return text.replace(/<[^>]*>/g, '').trim()
  }
}

/**
 * Sanitize a display name or username.
 */
export function sanitizeName(name: string): string {
  if (typeof name !== 'string') return ''
  return sanitizeText(name).slice(0, LIMITS.NAME_CHARS).trim()
}

/**
 * Sanitize about/bio text.
 */
export function sanitizeAbout(about: string): string {
  if (typeof about !== 'string') return ''
  return sanitizeText(about).slice(0, LIMITS.ABOUT_CHARS).trim()
}

// ── URL Validation ───────────────────────────────────────────

/**
 * Validate a URL is safe to render as a link.
 * Allowlist: http and https only.
 */
export function isSafeURL(url: string): boolean {
  if (typeof url !== 'string') return false
  const normalized = url.trim()
  if (normalized.length === 0 || normalized.length > LIMITS.URL_CHARS) return false

  try {
    const parsed = new URL(normalized)
    return ALLOWED_SCHEMES.has(parsed.protocol)
  } catch {
    return false
  }
}

/**
 * Validate a URL is safe to render as media (img/video src).
 * Requires https and known media extension or content-type path.
 */
export function isSafeMediaURL(url: string): boolean {
  if (!isSafeURL(url)) return false

  try {
    const parsed = new URL(url.trim())
    // Require HTTPS for media
    if (parsed.protocol !== 'https:') return false

    // Check extension or allow CDN-style URLs without extension
    const path = parsed.pathname.toLowerCase()
    const ext = path.split('.').pop() ?? ''
    if (ext && !MEDIA_EXTENSIONS.has(ext)) {
      // Allow extensionless URLs (CDN, proxy) but reject known non-media types
      if (NON_MEDIA_EXTENSIONS.has(ext)) return false
    }

    return true
  } catch {
    return false
  }
}

/**
 * Validate a Nostr relay WebSocket URL.
 */
export function isValidRelayURL(url: string): url is RelayURL {
  if (typeof url !== 'string') return false
  if (url.length > LIMITS.RELAY_URL_CHARS) return false
  if (!WS_URL_PATTERN.test(url)) return false

  try {
    const parsed = new URL(url)
    // Only allow ws:// and wss://
    if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') return false
    // Warn (but allow) non-TLS in production
    if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
      if (parsed.protocol !== 'wss:') return false
    }
    return true
  } catch {
    return false
  }
}

// ── Nostr-Specific Validation ────────────────────────────────

/** Validate a 32-byte hex string (pubkey or event id) */
export function isValidHex32(value: string): value is HexString {
  return (
    typeof value === 'string' &&
    value.length === 64 &&
    HEX_PATTERN.test(value)
  )
}

/** Validate a 64-byte hex signature */
export function isValidSig(value: string): value is HexString {
  return (
    typeof value === 'string' &&
    value.length === 128 &&
    HEX_PATTERN.test(value)
  )
}

/**
 * Validate Nostr event structure (without verifying signature).
 * Fast structural check for malformed events.
 */
export function isStructurallyValidEvent(event: unknown): event is NostrEvent {
  if (typeof event !== 'object' || event === null) return false

  const e = event as Record<string, unknown>

  return (
    isValidHex32(e['id'] as string) &&
    isValidHex32(e['pubkey'] as string) &&
    typeof e['created_at'] === 'number' &&
    Number.isInteger(e['created_at']) &&
    e['created_at'] > 0 &&
    // Reject events too far in the future (>10 min clock skew)
    e['created_at'] <= Math.floor(Date.now() / 1000) + 600 &&
    typeof e['kind'] === 'number' &&
    Number.isInteger(e['kind']) &&
    e['kind'] >= 0 &&
    Array.isArray(e['tags']) &&
    (e['tags'] as unknown[]).every(
      tag => Array.isArray(tag) && tag.every(item => typeof item === 'string')
    ) &&
    (e['tags'] as unknown[]).length <= LIMITS.MAX_TAGS &&
    typeof e['content'] === 'string' &&
    e['content'].length <= LIMITS.CONTENT_BYTES &&
    isValidSig(e['sig'] as string)
  )
}

/**
 * Full event validation including cryptographic signature verification.
 * This is the primary event acceptance gate.
 *
 * Returns false (not throws) on invalid events to avoid crashing
 * on adversarial relay data.
 */
export function isValidEvent(event: unknown): event is NostrEvent {
  if (!isStructurallyValidEvent(event)) return false

  try {
    return verifyEvent(event as Parameters<typeof verifyEvent>[0])
  } catch {
    return false
  }
}

/**
 * Validate NIP-05 identifier format (user@domain.tld).
 * Does NOT verify the identifier against `/.well-known/nostr.json`.
 */
export function isValidNip05Format(nip05: string): boolean {
  return normalizeNip05Identifier(nip05) !== null
}

/** Normalize a NIP-05 identifier to lowercase local-part and domain. */
export function normalizeNip05Identifier(nip05: string): string | null {
  if (typeof nip05 !== 'string') return null
  if (nip05.length > LIMITS.NIP05_CHARS) return null
  const trimmed = nip05.trim()
  const parts = trimmed.split('@')
  if (parts.length !== 2) return null
  const [rawLocal, rawDomain] = parts
  if (!rawLocal || !rawDomain) return null

  const local = rawLocal.toLowerCase()
  const domain = normalizeDomain(rawDomain)
  if (!local || !domain) return null
  if (!/^[a-z0-9._-]+$/.test(local)) return null

  return `${local}@${domain}`
}

/** Normalize a bare DNS domain for matching and storage. */
export function normalizeDomain(domain: string): string | null {
  if (typeof domain !== 'string') return null

  const normalized = domain.trim().toLowerCase().replace(/\.+$/, '')
  if (normalized.length === 0 || normalized.length > 253) return null

  const labels = normalized.split('.')
  if (labels.length < 2) return null

  for (const label of labels) {
    if (!/^[a-z0-9-]{1,63}$/i.test(label)) return null
    if (label.startsWith('-') || label.endsWith('-')) return null
  }

  return normalized
}

/** Extract the normalized domain portion from a valid NIP-05 identifier. */
export function extractNip05Domain(nip05: string): string | null {
  const normalized = normalizeNip05Identifier(nip05)
  if (!normalized) return null
  const domain = normalized.split('@')[1]
  return domain ? normalizeDomain(domain) : null
}

// ── Content Parsing ──────────────────────────────────────────

/**
 * Strip trailing punctuation that is not part of the URL.
 *
 * Greedily matching regexes absorb trailing characters like `)`, `.` and `,`
 * that authors write immediately after a URL (e.g. markdown `[text](url)`,
 * sentence-ending periods, bracketed references).
 *
 * Rule: always strip `. , ; ! ? ' "` from the end; strip `)` only when
 * unbalanced (more `)` than `(` in the URL — handles URLs like
 * `https://example.com/foo(bar)` correctly).
 */
export function stripUrlTrailingPunct(url: string): string {
  let result = url.replace(/[.,;!?'"]+$/, '')
  // Strip unbalanced closing parens
  const opens  = (result.match(/\(/g) ?? []).length
  let closes   = (result.match(/\)/g) ?? []).length
  while (result.endsWith(')') && closes > opens) {
    result = result.slice(0, -1)
    closes--
  }
  return result
}

/** Extract URLs from Nostr note content */
export function extractURLs(content: string): string[] {
  const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi
  const matches = content.match(URL_REGEX) ?? []
  return matches
    .map(stripUrlTrailingPunct)
    .filter(isSafeURL)
    .slice(0, 10) // max 10 URLs per note
}

/** Extract media URLs (images/video) from note content */
export function extractMediaURLs(content: string): string[] {
  return extractURLs(content).filter(isSafeMediaURL)
}

/** Extract nostr: URIs (NIP-19) from content */
export function extractNostrURIs(content: string): string[] {
  const NOSTR_REGEX = /nostr:[a-zA-Z0-9]+/g
  return content.match(NOSTR_REGEX) ?? []
}

/** Normalize a hashtag body for routing, indexing, and querying. */
export function normalizeHashtag(value: string): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim().replace(/^#+/, '')
  if (!HASHTAG_BODY_PATTERN.test(trimmed)) return null

  return trimmed.toLowerCase()
}

/** Extract hashtags from note content */
export function extractHashtags(content: string): string[] {
  const HASHTAG_REGEX = /#([a-zA-Z][a-zA-Z0-9_]{0,100})/g
  const matches = [...content.matchAll(HASHTAG_REGEX)]
  return [...new Set(matches
    .map(match => normalizeHashtag(match[1] ?? ''))
    .filter((tag): tag is string => tag !== null))].slice(0, 20)
}

// ── Storage Security ─────────────────────────────────────────

/**
 * Request persistent storage to prevent browser eviction of IndexedDB / OPFS.
 * Should be called after user gesture (e.g., on first meaningful interaction).
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false
  if (!navigator.storage?.persist) return false
  try {
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

/**
 * Get current storage quota and usage.
 */
export async function getStorageEstimate(): Promise<{ used: number; quota: number } | null> {
  if (typeof navigator === 'undefined') return null
  if (!navigator.storage?.estimate) return null
  try {
    const estimate = await navigator.storage.estimate()
    return {
      used:  estimate.usage  ?? 0,
      quota: estimate.quota  ?? 0,
    }
  } catch {
    return null
  }
}
