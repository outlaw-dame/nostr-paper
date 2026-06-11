/**
 * Safe Browsing URL checks.
 *
 * Uses a same-origin proxy in dev and an optional production proxy endpoint.
 * Core app callers can keep the default fail-open behavior so links still render
 * when a proxy is unavailable. Passive preview fetchers should pass
 * `{ failOpen: false }` so reputation-check outages disable previews instead of
 * fetching untrusted remote metadata.
 */

import { isSafeURL } from '@/lib/security/sanitize'

const PROD_PROXY_URL = import.meta.env.VITE_SAFE_BROWSING_PROXY_URL as string | undefined
const DEV_PROXY_PATH = '/__dev/safe-browsing'
const PROD_PROXY_PATH = '/api/safe-browsing/check'
const DEFAULT_PROXY_PATH = import.meta.env.DEV ? DEV_PROXY_PATH : PROD_PROXY_PATH
const PROXY_BASE = PROD_PROXY_URL ?? DEFAULT_PROXY_PATH

const MAX_CACHE = 500

const cache = new Map<string, boolean>()
const inflight = new Map<string, Promise<boolean>>()

export interface SafeBrowsingCheckOptions {
  /**
   * Whether to treat proxy/network failures as safe.
   * Defaults to true for link rendering compatibility. Set false before
   * fetching untrusted remote previews or media metadata.
   */
  failOpen?: boolean
}

interface SafeBrowsingProxyResponse {
  safe?: unknown
}

function evictIfNeeded(): void {
  if (cache.size <= MAX_CACHE) return
  const firstKey = cache.keys().next().value
  if (firstKey !== undefined) cache.delete(firstKey)
}

function normalizeSafeBrowsingUrl(url: string): string | null {
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

function cacheKey(url: string, failOpen: boolean): string {
  return `${failOpen ? 'open' : 'closed'}:${url}`
}

async function doCheck(url: string, failOpen: boolean): Promise<boolean> {
  try {
    const response = await fetch(PROXY_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ url }),
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    })

    if (!response.ok) return failOpen

    const payload = (await response.json()) as SafeBrowsingProxyResponse
    return typeof payload.safe === 'boolean' ? payload.safe : failOpen
  } catch {
    return failOpen
  }
}

export function peekSafeBrowsingDecision(
  url: string,
  options: SafeBrowsingCheckOptions = {},
): boolean | undefined {
  const normalizedUrl = normalizeSafeBrowsingUrl(url)
  if (!normalizedUrl) return false

  const failOpen = options.failOpen ?? true
  const key = cacheKey(normalizedUrl, failOpen)
  if (!cache.has(key)) return undefined
  return cache.get(key)
}

export async function checkSafeBrowsingURL(
  url: string,
  options: SafeBrowsingCheckOptions = {},
): Promise<boolean> {
  const normalizedUrl = normalizeSafeBrowsingUrl(url)
  if (!normalizedUrl) return false

  const failOpen = options.failOpen ?? true
  const key = cacheKey(normalizedUrl, failOpen)

  if (cache.has(key)) return cache.get(key) ?? failOpen

  const existing = inflight.get(key)
  if (existing) return existing

  const promise = doCheck(normalizedUrl, failOpen).then((safe) => {
    evictIfNeeded()
    cache.set(key, safe)
    inflight.delete(key)
    return safe
  })

  inflight.set(key, promise)
  return promise
}
