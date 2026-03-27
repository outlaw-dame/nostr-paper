interface MediaFailureState {
  failures: number
  retryAt: number
}

const BASE_DELAY_MS = 4_000
const MAX_DELAY_MS = 60_000
const MAX_FAILURES = 6
const JITTER_FACTOR = 0.25

const mediaFailureState = new Map<string, MediaFailureState>()

function normalizeUrl(url: string): string {
  return url.trim()
}

function computeDelayMs(failures: number): number {
  const exponential = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, Math.max(0, failures - 1)))
  const jitter = exponential * JITTER_FACTOR * Math.random()
  return Math.min(MAX_DELAY_MS, Math.floor(exponential + jitter))
}

export function shouldAttemptMediaUrl(url: string | null | undefined, nowMs = Date.now()): boolean {
  if (!url) return false

  const normalizedUrl = normalizeUrl(url)
  if (!normalizedUrl) return false

  const state = mediaFailureState.get(normalizedUrl)
  if (!state) return true
  return nowMs >= state.retryAt
}

export function recordMediaUrlFailure(url: string | null | undefined, nowMs = Date.now()): void {
  if (!url) return

  const normalizedUrl = normalizeUrl(url)
  if (!normalizedUrl) return

  const previousFailures = mediaFailureState.get(normalizedUrl)?.failures ?? 0
  const failures = Math.min(previousFailures + 1, MAX_FAILURES)
  const retryAt = nowMs + computeDelayMs(failures)

  mediaFailureState.set(normalizedUrl, { failures, retryAt })
}

export function recordMediaUrlSuccess(url: string | null | undefined): void {
  if (!url) return

  const normalizedUrl = normalizeUrl(url)
  if (!normalizedUrl) return

  mediaFailureState.delete(normalizedUrl)
}

export function getMediaUrlBackoffRemainingMs(url: string | null | undefined, nowMs = Date.now()): number {
  if (!url) return 0

  const normalizedUrl = normalizeUrl(url)
  if (!normalizedUrl) return 0

  const retryAt = mediaFailureState.get(normalizedUrl)?.retryAt
  if (!retryAt) return 0
  return Math.max(0, retryAt - nowMs)
}

export function resetMediaUrlFailureBackoffForTests(): void {
  mediaFailureState.clear()
}