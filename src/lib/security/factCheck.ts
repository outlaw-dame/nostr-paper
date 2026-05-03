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

const cache = new Map<string, FactCheckResult>()
const inflight = new Map<string, Promise<FactCheckResult>>()

function evictIfNeeded(): void {
  if (cache.size <= MAX_CACHE) return
  const firstKey = cache.keys().next().value
  if (firstKey !== undefined) cache.delete(firstKey)
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase()
}

function pickFirstRating(claim: FactCheckProxyClaim): FactCheckRating | null {
  const review = (claim.claimReview ?? [])[0]
  if (!review) return null

  const textualRating = (review.textualRating ?? '').trim()
  const reviewUrl = (review.url ?? '').trim()
  if (!textualRating || !reviewUrl) return null

  return {
    claim: (claim.text ?? '').trim(),
    ...(claim.claimant ? { claimant: claim.claimant.trim() } : {}),
    ...(review.publisher?.name ? { publisherName: review.publisher.name } : {}),
    ...(review.publisher?.site ? { publisherSite: review.publisher.site } : {}),
    textualRating,
    reviewUrl,
    ...(review.reviewDate ? { reviewedAt: review.reviewDate } : {}),
    ...(review.languageCode ? { languageCode: review.languageCode } : {}),
  }
}

async function doSearch(query: string): Promise<FactCheckResult> {
  const result: FactCheckResult = { query, ratings: [], fetchedAt: Date.now() }
  try {
    const response = await fetch(PROXY_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query }),
      cache: 'no-store',
      signal: AbortSignal.timeout(6_000),
    })

    if (!response.ok) return result

    const payload = (await response.json()) as FactCheckProxyResponse
    const claims = Array.isArray(payload.claims) ? payload.claims : []

    for (const claim of claims) {
      const rating = pickFirstRating(claim)
      if (rating) result.ratings.push(rating)
      if (result.ratings.length >= 5) break
    }
  } catch {
    // Fail open
  }
  return result
}

export function peekFactCheck(query: string): FactCheckResult | undefined {
  const key = normalizeQuery(query)
  if (!key) return undefined
  return cache.get(key)
}

export async function searchFactChecks(query: string): Promise<FactCheckResult> {
  const key = normalizeQuery(query)
  if (!key) return { query, ratings: [], fetchedAt: Date.now() }

  const cached = cache.get(key)
  if (cached) return cached

  const existing = inflight.get(key)
  if (existing) return existing

  const promise = doSearch(key).then((result) => {
    evictIfNeeded()
    cache.set(key, result)
    inflight.delete(key)
    return result
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
