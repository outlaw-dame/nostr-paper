import { withRetry } from '@/lib/retry'
import { isSafeURL } from '@/lib/security/sanitize'

interface SyndicationSourceResponse {
  url: string
  contentType: string
  content: string
}

export type SyndicationFetchErrorCode =
  | 'invalid-url'
  | 'private-host-blocked'
  | 'network-error'
  | 'rate-limited'
  | 'server-error'
  | 'http-error'
  | 'payload-too-large'
  | 'invalid-payload'

export class SyndicationFetchError extends Error {
  readonly code: SyndicationFetchErrorCode
  readonly status?: number

  constructor(code: SyndicationFetchErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'SyndicationFetchError'
    this.code = code
    if (status !== undefined) {
      this.status = status
    }
  }
}

export interface FetchSyndicationSourceResult {
  source: SyndicationSourceResponse | null
  error: SyndicationFetchError | null
}

interface FetchSyndicationSourceOptions {
  bypassCache?: boolean
}

const DEV_FEED_PROXY_PATH = '/__dev/feed'
const PROD_FEED_PROXY_URL = import.meta.env.VITE_FEED_PROXY_URL as string | undefined
const MAX_CACHE = 100
const FETCH_TIMEOUT_MS = 12_000
const MAX_FEED_BYTES = 2_000_000

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

function isPrivateHostname(hostname: string): boolean {
  const lowered = hostname.toLowerCase()
  if (lowered === 'localhost' || lowered.endsWith('.localhost')) return true

  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(lowered)
  if (ipv4) {
    const parts = lowered.split('.').map(part => Number.parseInt(part, 10))
    const [a, b] = parts
    if (parts.some(part => !Number.isFinite(part) || part < 0 || part > 255)) return true
    if (a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
  }

  return false
}

function isAllowedFeedUrl(url: string): boolean {
  if (!isSafeURL(url)) return false

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && !(import.meta.env.DEV && parsed.protocol === 'http:')) return false
    if (!import.meta.env.DEV && isPrivateHostname(parsed.hostname)) return false
    return true
  } catch {
    return false
  }
}

function classifyBlockedUrl(url: string): SyndicationFetchError {
  if (!isSafeURL(url)) {
    return new SyndicationFetchError('invalid-url', 'Feed URL must be a valid HTTP(S) URL.')
  }

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && !(import.meta.env.DEV && parsed.protocol === 'http:')) {
      return new SyndicationFetchError('invalid-url', 'Only HTTPS feed URLs are allowed.')
    }
    if (!import.meta.env.DEV && isPrivateHostname(parsed.hostname)) {
      return new SyndicationFetchError('private-host-blocked', 'Private or local hostnames are not allowed.')
    }
  } catch {
    return new SyndicationFetchError('invalid-url', 'Feed URL is malformed.')
  }

  return new SyndicationFetchError('invalid-url', 'Feed URL is not allowed.')
}

function createTimeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs)
  }

  const controller = new AbortController()
  globalThis.setTimeout(() => controller.abort(), timeoutMs)
  return controller.signal
}

function shouldRetryFetchError(error: unknown): boolean {
  if (error instanceof SyndicationFetchError) {
    return error.code === 'network-error' || error.code === 'rate-limited' || error.code === 'server-error'
  }

  if (!(error instanceof Error)) return false
  return false
}

function ensureResponseWithinLimit(response: Response): boolean {
  const contentLength = Number.parseInt(response.headers.get('content-length') ?? '0', 10)
  if (!Number.isFinite(contentLength) || contentLength <= 0) return true
  return contentLength <= MAX_FEED_BYTES
}

async function fetchViaProxy(url: string, proxyBase: string): Promise<SyndicationSourceResponse | null> {
  return withRetry(async () => {
    const endpoint = `${proxyBase}?url=${encodeURIComponent(url)}`
    let response: Response
    try {
      response = await fetch(endpoint, {
        signal: createTimeoutSignal(FETCH_TIMEOUT_MS),
      })
    } catch {
      throw new SyndicationFetchError('network-error', 'Network error while fetching feed via proxy.')
    }

    if (response.status === 429) throw new SyndicationFetchError('rate-limited', 'Feed proxy is rate limiting requests.', 429)
    if (response.status >= 500) throw new SyndicationFetchError('server-error', 'Feed proxy server error.', response.status)
    if (!response.ok) throw new SyndicationFetchError('http-error', 'Feed proxy rejected request.', response.status)
    if (!ensureResponseWithinLimit(response)) {
      throw new SyndicationFetchError('payload-too-large', 'Feed payload exceeded maximum allowed size.')
    }

    const payload: unknown = await response.json()
    if (!isSyndicationSourceResponse(payload)) {
      throw new SyndicationFetchError('invalid-payload', 'Feed proxy response payload is invalid.')
    }
    if (payload.content.length > MAX_FEED_BYTES) {
      throw new SyndicationFetchError('payload-too-large', 'Feed payload exceeded maximum allowed size.')
    }
    return payload
  }, {
    maxAttempts: 3,
    baseDelayMs: 300,
    maxDelayMs: 4_000,
    jitter: 'full',
    shouldRetry: shouldRetryFetchError,
  })
}

async function fetchDirect(url: string): Promise<SyndicationSourceResponse | null> {
  return withRetry(async () => {
    let response: Response
    try {
      response = await fetch(url, {
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
        signal: createTimeoutSignal(FETCH_TIMEOUT_MS),
      })
    } catch {
      throw new SyndicationFetchError('network-error', 'Network error while fetching feed.')
    }

    if (response.status === 429) throw new SyndicationFetchError('rate-limited', 'Feed host is rate limiting requests.', 429)
    if (response.status >= 500) throw new SyndicationFetchError('server-error', 'Feed host server error.', response.status)
    if (!response.ok) throw new SyndicationFetchError('http-error', 'Feed host rejected request.', response.status)
    if (!ensureResponseWithinLimit(response)) {
      throw new SyndicationFetchError('payload-too-large', 'Feed payload exceeded maximum allowed size.')
    }

    const content = await response.text()
    if (content.length > MAX_FEED_BYTES) {
      throw new SyndicationFetchError('payload-too-large', 'Feed payload exceeded maximum allowed size.')
    }

    return {
      url: response.url || url,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      content,
    }
  }, {
    maxAttempts: 3,
    baseDelayMs: 300,
    maxDelayMs: 4_000,
    jitter: 'full',
    shouldRetry: shouldRetryFetchError,
  })
}

async function doFetchSyndicationSource(url: string): Promise<SyndicationSourceResponse> {
  if (!isAllowedFeedUrl(url)) {
    throw classifyBlockedUrl(url)
  }

  const proxyBase = getProxyBase()

  if (proxyBase) {
    const response = await fetchViaProxy(url, proxyBase)
    if (!response) throw new SyndicationFetchError('invalid-payload', 'Feed proxy returned an empty response.')
    return response
  }

  const response = await fetchDirect(url)
  if (!response) throw new SyndicationFetchError('invalid-payload', 'Feed endpoint returned an empty response.')
  return response
}

export async function fetchSyndicationSourceWithDiagnostics(
  url: string,
  options: FetchSyndicationSourceOptions = {},
): Promise<FetchSyndicationSourceResult> {
  if (!options.bypassCache && sourceCache.has(url)) {
    return {
      source: sourceCache.get(url) ?? null,
      error: null,
    }
  }

  if (!options.bypassCache) {
    const existing = inflight.get(url)
    if (existing) {
      const source = await existing
      return {
        source,
        error: null,
      }
    }
  }

  try {
    if (options.bypassCache) {
      const source = await doFetchSyndicationSource(url)
      return { source, error: null }
    }

    const promise = doFetchSyndicationSource(url).then((result) => {
      evictIfNeeded()
      sourceCache.set(url, result)
      inflight.delete(url)
      return result
    }).catch((error: unknown) => {
      inflight.delete(url)
      throw error
    })

    inflight.set(url, promise)
    const source = await promise
    return { source, error: null }
  } catch (error) {
    const normalized = error instanceof SyndicationFetchError
      ? error
      : new SyndicationFetchError('network-error', 'Failed to fetch feed due to an unknown network error.')

    return {
      source: null,
      error: normalized,
    }
  }
}

export async function fetchSyndicationSource(url: string): Promise<SyndicationSourceResponse | null> {
  const { source } = await fetchSyndicationSourceWithDiagnostics(url)
  return source
}
