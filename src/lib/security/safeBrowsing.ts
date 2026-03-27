/**
 * Safe Browsing URL checks.
 *
 * Uses a same-origin proxy in dev and an optional production proxy endpoint.
 * If no proxy is configured or the check fails, this module fails open and
 * treats URLs as safe to avoid breaking core app behavior.
 */

const PROD_PROXY_URL = import.meta.env.VITE_SAFE_BROWSING_PROXY_URL as string | undefined
const DEFAULT_PROXY_PATH = '/api/safe-browsing/check'
const PROXY_BASE = PROD_PROXY_URL ?? DEFAULT_PROXY_PATH

const MAX_CACHE = 500

const cache = new Map<string, boolean>()
const inflight = new Map<string, Promise<boolean>>()

interface SafeBrowsingProxyResponse {
  safe?: unknown
}

function evictIfNeeded(): void {
  if (cache.size <= MAX_CACHE) return
  const firstKey = cache.keys().next().value
  if (firstKey !== undefined) cache.delete(firstKey)
}

async function doCheck(url: string): Promise<boolean> {
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

    if (!response.ok) return true

    const payload = (await response.json()) as SafeBrowsingProxyResponse
    return typeof payload.safe === 'boolean' ? payload.safe : true
  } catch {
    return true
  }
}

export function peekSafeBrowsingDecision(url: string): boolean | undefined {
  if (!cache.has(url)) return undefined
  return cache.get(url)
}

export async function checkSafeBrowsingURL(url: string): Promise<boolean> {
  if (cache.has(url)) return cache.get(url) ?? true

  const existing = inflight.get(url)
  if (existing) return existing

  const promise = doCheck(url).then((safe) => {
    evictIfNeeded()
    cache.set(url, safe)
    inflight.delete(url)
    return safe
  })

  inflight.set(url, promise)
  return promise
}
