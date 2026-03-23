/**
 * OG Data Fetcher
 *
 * Fetches Open Graph metadata for a URL via the dev proxy
 * (/__dev/og?url=...) or a configurable production endpoint
 * (VITE_OG_PROXY_URL env var).
 *
 * Results are cached in a bounded in-memory LRU-style map so the same
 * URL is never fetched twice within a session.  No SQLite persistence —
 * previews are ephemeral UI state.
 *
 * Gracefully returns null when no proxy is reachable, so the app works
 * fully offline and in production without a backend.
 */

import type { OGData } from './types'

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

const cache    = new Map<string, OGData | null>()
const inflight = new Map<string, Promise<OGData | null>>()

function evictIfNeeded(): void {
  if (cache.size <= MAX_CACHE) return
  // Drop the oldest entry (Map iteration order = insertion order)
  const firstKey = cache.keys().next().value
  if (firstKey !== undefined) cache.delete(firstKey)
}

// ── Fetch ─────────────────────────────────────────────────────

function isOGData(value: unknown): value is OGData {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)['url'] === 'string'
  )
}

async function doFetch(url: string): Promise<OGData | null> {
  if (!PROXY_BASE) return null

  const endpoint = `${PROXY_BASE}?url=${encodeURIComponent(url)}`

  try {
    const res = await fetch(endpoint, {
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return null

    const json: unknown = await res.json()
    return isOGData(json) ? json : null
  } catch {
    return null
  }
}

export function peekOGData(url: string): OGData | null | undefined {
  if (!cache.has(url)) return undefined
  return cache.get(url) ?? null
}

/**
 * Fetch OG metadata for a URL.
 *
 * - Returns null immediately if no proxy is configured.
 * - Deduplicates concurrent requests for the same URL.
 * - Caches the result (including null) for the lifetime of the session.
 */
export async function fetchOGData(url: string): Promise<OGData | null> {
  if (!PROXY_BASE) return null

  if (cache.has(url)) return cache.get(url) ?? null

  // Deduplicate concurrent requests
  const existing = inflight.get(url)
  if (existing) return existing

  const promise = doFetch(url).then(result => {
    evictIfNeeded()
    cache.set(url, result)
    inflight.delete(url)
    return result
  })

  inflight.set(url, promise)
  return promise
}
