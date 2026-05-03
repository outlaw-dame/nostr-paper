/**
 * Google Fact Check Tools API client.
 *
 * Mirrors safeBrowsing.ts: same-origin proxy in dev (`/__dev/fact-check`)
 * or production endpoint (`/api/fact-check/search` or
 * `VITE_FACT_CHECK_PROXY_URL`). Caches by query, dedupes inflight requests.
 *
 * Fails open (returns null / empty) on errors so missing fact-checks never
 * break feed rendering.
 *
 * API reference:
 *   https://developers.google.com/fact-check/tools/api/reference/rest/v1alpha1/claims/search
 */

const PROD_PROXY_URL = import.meta.env.VITE_FACT_CHECK_PROXY_URL as string | undefined
const DEV_PROXY_PATH = '/__dev/fact-check'
const PROD_PROXY_PATH = '/api/fact-check/search'
const DEFAULT_PROXY_PATH = import.meta.env.DEV ? DEV_PROXY_PATH : PROD_PROXY_PATH
const PROXY_BASE = PROD_PROXY_URL ?? DEFAULT_PROXY_PATH

const MAX_CACHE = 500
const MAX_QUERY_LENGTH = 500
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const CACHE_STALE_MS = 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 6_000
const MAX_RETRIES = 2
const RETRY_BASE_DELAY_MS = 250
const RETRY_MAX_DELAY_MS = 2_000

export interface FactCheckRating {
  claim: string
  claimant?: string
  publisherName?: string
  publisherSite?: string
  textualRating: string
  reviewUrl: string
  reviewedAt?: string
  languageCode?: string
}

export interface FactCheckResult {
  query: string
  ratings: FactCheckRating[]
  fetchedAt: number
}

interface FactCheckProxyClaimReview {
  publisher?: { name?: string; site?: string }
  url?: string
  title?: string
  textualRating?: string
  languageCode?: string
  reviewDate?: string
}

interface FactCheckProxyClaim {
  text?: string
  claimant?: string
  claimDate?: string
  claimReview?: FactCheckProxyClaimReview[]
}

interface FactCheckProxyResponse {
  claims?: FactCheckProxyClaim[]
}

interface CacheEntry {
  value: FactCheckResult
  expiresAt: number
  staleUntil: number
}

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<FactCheckResult>>()

function isLikelyLanguageCode(value: string): boolean {
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(value)
}

function sanitizeQuery(query: string): string {
  const normalized = query.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.slice(0, MAX_QUERY_LENGTH)
}

function sanitizeReviewUrl(raw: string): string {
  const url = raw.trim()
  if (!url) return ''
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return ''
    parsed.username = ''
    parsed.password = ''
    return parsed.toString()
  } catch {
    return ''
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function backoffDelay(attempt: number): number {
  const exp = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * (2 ** attempt))
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(exp / 3)))
  return Math.min(RETRY_MAX_DELAY_MS, exp + jitter)
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === 'TimeoutError' || error.name === 'AbortError'
  if (error instanceof TypeError) return true
  return false
}

function evictIfNeeded(): void {
  if (cache.size <= MAX_CACHE) return
  const firstKey = cache.keys().next().value
  if (firstKey !== undefined) cache.delete(firstKey)
}

function normalizeQuery(query: string): string {
  return sanitizeQuery(query).toLowerCase()
}

function pickFirstRating(claim: FactCheckProxyClaim): FactCheckRating | null {
  const review = (claim.claimReview ?? [])[0]
  if (!review) return null

  const textualRating = (review.textualRating ?? '').trim()
  const reviewUrl = sanitizeReviewUrl(review.url ?? '')
  if (!textualRating || !reviewUrl) return null

  const languageCode = (review.languageCode ?? '').trim()
  const reviewDate = (review.reviewDate ?? '').trim()

  return {
    claim: (claim.text ?? '').trim(),
    ...(claim.claimant ? { claimant: claim.claimant.trim() } : {}),
    ...(review.publisher?.name ? { publisherName: review.publisher.name } : {}),
    ...(review.publisher?.site ? { publisherSite: review.publisher.site } : {}),
    textualRating,
    reviewUrl,
    ...(reviewDate ? { reviewedAt: reviewDate } : {}),
    ...(isLikelyLanguageCode(languageCode) ? { languageCode } : {}),
  }
}

async function fetchFactCheckPayload(query: string, attempt = 0): Promise<FactCheckProxyResponse | null> {
  try {
    const response = await fetch(PROXY_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query }),
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      if (attempt < MAX_RETRIES && isRetryableStatus(response.status)) {
        await sleep(backoffDelay(attempt))
        return fetchFactCheckPayload(query, attempt + 1)
      }
      return null
    }

    return (await response.json()) as FactCheckProxyResponse
  } catch (error) {
    if (attempt < MAX_RETRIES && isRetryableError(error)) {
      await sleep(backoffDelay(attempt))
      return fetchFactCheckPayload(query, attempt + 1)
    }
    return null
  }
}

async function doSearch(query: string): Promise<FactCheckResult> {
  const result: FactCheckResult = { query, ratings: [], fetchedAt: Date.now() }
  const payload = await fetchFactCheckPayload(query)
  const claims = Array.isArray(payload?.claims) ? payload.claims : []

  for (const claim of claims) {
    const rating = pickFirstRating(claim)
    if (rating) result.ratings.push(rating)
    if (result.ratings.length >= 5) break
  }
  return result
}

export function peekFactCheck(query: string): FactCheckResult | undefined {
  const key = normalizeQuery(query)
  if (!key) return undefined
  const entry = cache.get(key)
  if (!entry) return undefined
  return entry.value
}

function setCache(key: string, value: FactCheckResult): void {
  evictIfNeeded()
  const now = Date.now()
  cache.set(key, {
    value,
    expiresAt: now + CACHE_TTL_MS,
    staleUntil: now + CACHE_STALE_MS,
  })
}

export async function searchFactChecks(query: string): Promise<FactCheckResult> {
  const key = normalizeQuery(query)
  if (!key) return { query, ratings: [], fetchedAt: Date.now() }

  const now = Date.now()
  const cached = cache.get(key)
  if (cached && cached.expiresAt > now) return cached.value

  const existing = inflight.get(key)
  if (existing) return existing

  const promise = doSearch(key)
    .then((result) => {
      setCache(key, result)
      return result
    })
    .catch(() => {
      if (cached && cached.staleUntil > now) return cached.value
      return { query: key, ratings: [], fetchedAt: Date.now() }
    })
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, promise)
  return promise
}

/**
 * Heuristic for fact-check rating "verdict":
 *   - "false-ish" ratings (False, Pants on Fire, Fake, Misleading, Incorrect)
 *     → 'false'
 *   - "true-ish" ratings (True, Correct, Accurate)
 *     → 'true'
 *   - Anything in between or unknown → 'mixed'
 */
export function classifyFactCheckRating(rating: string): 'true' | 'false' | 'mixed' {
  const text = rating.toLowerCase().trim()
  const falseHints = [
    'false',
    'pants on fire',
    'incorrect',
    'misleading',
    'fake',
    'fabricated',
    'no evidence',
    'not true',
    'unproven',
    'distorts',
    'debunked',
  ]
  const trueHints = ['true', 'correct', 'accurate', 'verified']

  if (falseHints.some((hint) => text.includes(hint))) return 'false'
  if (trueHints.some((hint) => text.includes(hint))) return 'true'
  return 'mixed'
}
