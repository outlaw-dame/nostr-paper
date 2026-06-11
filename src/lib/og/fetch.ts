/**
 * OG Data Fetcher
 *
 * Fetches Open Graph metadata for a URL via the dev proxy
 * (/__dev/og?url=...) or a configurable production endpoint
 * (VITE_OG_PROXY_URL env var).
 *
 * Results are cached in a bounded in-memory LRU-style map so the same
 * URL is never fetched twice within a session when successful. Failed/null
 * lookups are cached briefly and retried later. No SQLite persistence —
 * previews are ephemeral UI state.
 *
 * Gracefully returns null when no proxy is reachable, so the app works
 * fully offline and in production without a backend.
 */

import type { OGData } from './types'
import { checkSafeBrowsingURL } from '@/lib/security/safeBrowsing'
import { isSafeURL, sanitizeText } from '@/lib/security/sanitize'
import { withRetry } from '@/lib/retry'

// ── Configuration ─────────────────────────────────────────────

/** In development, use the Vite dev-server proxy. */
const DEV_PROXY  = '/__dev/og'

/**
 * In production, set VITE_OG_PROXY_URL to your own proxy endpoint.
 * The endpoint must accept GET requests with a `url` query parameter
 * and return JSON matching the OGData shape.
 *
 * If unset, previews are silently disabled in production.
 */
const PROD_PROXY = import.meta.env.VITE_OG_PROXY_URL as string | undefined

const PROXY_BASE = import.meta.env.DEV ? DEV_PROXY : (PROD_PROXY ?? null)

// ── Cache ─────────────────────────────────────────────────────

const MAX_CACHE = 200
const NEGATIVE_CACHE_TTL_MS = 2 * 60 * 1000
const TEXT_FIELD_LIMIT = 500
const CREATOR_FIELD_LIMIT = 256

interface OgCacheEntry {
  value: OGData | null
  expiresAt?: number
}

const cache    = new Map<string, OgCacheEntry>()
const inflight = new Map<string, Promise<OGData | null>>()

function evictIfNeeded(): void {
  if (cache.size <= MAX_CACHE) return
  // Drop the oldest entry (Map iteration order = insertion order)
  const firstKey = cache.keys().next().value
  if (firstKey !== undefined) cache.delete(firstKey)
}

// ── Fetch ─────────────────────────────────────────────────────

function normalizePreviewURL(url: string): string | null {
  if (typeof url !== 'string') return null
  const trimmed = url.trim()
  if (!isSafeURL(trimmed)) return null

  try {
    const parsed = new URL(trimmed)
    parsed.hash = ''
    parsed.username = ''
    parsed.password = ''
    return parsed.href
  } catch {
    return null
  }
}

function boundedText(value: unknown, maxLength = TEXT_FIELD_LIMIT): string | undefined {
  if (typeof value !== 'string') return undefined
  const sanitized = sanitizeText(value).replace(/\s+/g, ' ').trim()
  if (!sanitized) return undefined
  return sanitized.slice(0, maxLength)
}

function optionalSafeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = normalizePreviewURL(value)
  return normalized ?? undefined
}

function normalizeOGData(value: unknown): OGData | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const url = normalizePreviewURL(typeof record.url === 'string' ? record.url : '')
  if (!url) return null

  return {
    url,
    ...(boundedText(record.title) ? { title: boundedText(record.title) } : {}),
    ...(boundedText(record.description, 1_000) ? { description: boundedText(record.description, 1_000) } : {}),
    ...(optionalSafeUrl(record.image) ? { image: optionalSafeUrl(record.image) } : {}),
    ...(boundedText(record.siteName) ? { siteName: boundedText(record.siteName) } : {}),
    ...(boundedText(record.author) ? { author: boundedText(record.author) } : {}),
    ...(boundedText(record.nostrCreator, CREATOR_FIELD_LIMIT) ? { nostrCreator: boundedText(record.nostrCreator, CREATOR_FIELD_LIMIT) } : {}),
    ...(boundedText(record.nostrNip05, CREATOR_FIELD_LIMIT) ? { nostrNip05: boundedText(record.nostrNip05, CREATOR_FIELD_LIMIT) } : {}),
    ...(optionalSafeUrl(record.favicon) ? { favicon: optionalSafeUrl(record.favicon) } : {}),
  }
}

async function doFetch(url: string): Promise<OGData | null> {
  if (!PROXY_BASE) return null

  const endpoint = `${PROXY_BASE}?url=${encodeURIComponent(url)}`

  class HttpStatusError extends Error {
    status: number

    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  }

  try {
    return await withRetry(
      async () => {
        const res = await fetch(endpoint, {
          signal: AbortSignal.timeout(12_000),
          headers: {
            Accept: 'application/json',
          },
        })

        if (res.status === 429 || res.status >= 500) {
          throw new HttpStatusError(res.status, `OG proxy retryable status: ${res.status}`)
        }

        if (!res.ok) return null

        const json: unknown = await res.json()
        return normalizeOGData(json)
      },
      {
        maxAttempts: 3,
        baseDelayMs: 400,
        maxDelayMs: 4_000,
        jitter: 'full',
        shouldRetry: (error) => {
          if (error instanceof DOMException && error.name === 'AbortError') return false
          if (error instanceof HttpStatusError) {
            return error.status === 429 || error.status >= 500
          }
          return true
        },
      },
    )
  } catch {
    return null
  }
}

export function peekOGData(url: string): OGData | null | undefined {
  const normalizedUrl = normalizePreviewURL(url)
  if (!normalizedUrl) return null

  const entry = cache.get(normalizedUrl)
  if (!entry) return undefined

  if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
    cache.delete(normalizedUrl)
    return undefined
  }

  return entry.value
}

/**
 * Fetch OG metadata for a URL.
 *
 * - Returns null immediately if no proxy is configured.
 * - Deduplicates concurrent requests for the same URL.
 * - Caches the result (including null) for the lifetime of the session.
 */
export async function fetchOGData(url: string): Promise<OGData | null> {
  const normalizedUrl = normalizePreviewURL(url)
  if (!normalizedUrl) return null
  if (!PROXY_BASE) return null

  const cached = peekOGData(normalizedUrl)
  if (cached !== undefined) return cached

  // Deduplicate concurrent requests
  const existing = inflight.get(normalizedUrl)
  if (existing) return existing

  const promise = (async () => {
    // Link previews are passive remote fetches. Fail closed here: if the
    // reputation proxy is unavailable or returns malformed data, skip the
    // preview instead of fetching remote metadata anyway.
    const safe = await checkSafeBrowsingURL(normalizedUrl, { failOpen: false })
    if (!safe) return null
    return doFetch(normalizedUrl)
  })().then(result => {
    inflight.delete(normalizedUrl)

    // Cache both positive and negative lookups to prevent repeated retries.
    cache.set(normalizedUrl, {
      value: result,
      ...(result === null ? { expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS } : {}),
    })
    evictIfNeeded()

    return result
  })

  inflight.set(normalizedUrl, promise)
  return promise
}
