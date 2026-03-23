interface SyndicationSourceResponse {
  url: string
  contentType: string
  content: string
}

const DEV_FEED_PROXY_PATH = '/__dev/feed'
const PROD_FEED_PROXY_URL = import.meta.env.VITE_FEED_PROXY_URL as string | undefined
const MAX_CACHE = 100

const sourceCache = new Map<string, SyndicationSourceResponse | null>()
const inflight = new Map<string, Promise<SyndicationSourceResponse | null>>()

function getProxyBase(): string | null {
  if (import.meta.env.DEV) return DEV_FEED_PROXY_PATH
  return PROD_FEED_PROXY_URL ?? null
}

function evictIfNeeded(): void {
  if (sourceCache.size <= MAX_CACHE) return
  const firstKey = sourceCache.keys().next().value
  if (firstKey !== undefined) sourceCache.delete(firstKey)
}

function isSyndicationSourceResponse(value: unknown): value is SyndicationSourceResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).url === 'string' &&
    typeof (value as Record<string, unknown>).contentType === 'string' &&
    typeof (value as Record<string, unknown>).content === 'string'
  )
}

async function fetchViaProxy(url: string, proxyBase: string): Promise<SyndicationSourceResponse | null> {
  const endpoint = `${proxyBase}?url=${encodeURIComponent(url)}`
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(12_000),
  })

  if (!response.ok) return null

  const payload: unknown = await response.json()
  return isSyndicationSourceResponse(payload) ? payload : null
}

async function fetchDirect(url: string): Promise<SyndicationSourceResponse | null> {
  const response = await fetch(url, {
    headers: {
      Accept: [
        'application/feed+json',
        'application/json',
        'application/atom+xml',
        'application/rss+xml',
        'application/rdf+xml',
        'application/xml',
        'text/xml',
        'text/plain;q=0.8',
        '*/*;q=0.1',
      ].join(', '),
    },
    signal: AbortSignal.timeout(12_000),
  })

  if (!response.ok) return null

  return {
    url: response.url || url,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    content: await response.text(),
  }
}

async function doFetchSyndicationSource(url: string): Promise<SyndicationSourceResponse | null> {
  const proxyBase = getProxyBase()

  try {
    if (proxyBase) {
      return await fetchViaProxy(url, proxyBase)
    }

    return await fetchDirect(url)
  } catch {
    return null
  }
}

export async function fetchSyndicationSource(url: string): Promise<SyndicationSourceResponse | null> {
  if (sourceCache.has(url)) return sourceCache.get(url) ?? null

  const existing = inflight.get(url)
  if (existing) return existing

  const promise = doFetchSyndicationSource(url).then((result) => {
    evictIfNeeded()
    sourceCache.set(url, result)
    inflight.delete(url)
    return result
  })

  inflight.set(url, promise)
  return promise
}
