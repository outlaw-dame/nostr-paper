/**
 * Retry & Backoff Utilities
 *
 * Implements full-jitter exponential backoff with:
 * - Configurable base/max delay
 * - Full jitter to prevent thundering herd
 * - Abort signal support
 * - Typed error classification
 */

export interface RetryOptions {
  /** Maximum number of attempts (including first) */
  maxAttempts?: number
  /** Base delay in ms (default: 500) */
  baseDelayMs?: number
  /** Maximum delay cap in ms (default: 30_000) */
  maxDelayMs?: number
  /** Jitter strategy (default: 'full') */
  jitter?: 'none' | 'full' | 'decorrelated'
  /** Optional abort signal to cancel retries */
  signal?: AbortSignal
  /** Called before each retry with attempt number and delay */
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void
  /** Predicate — if returns false, do not retry this error */
  shouldRetry?: (error: unknown, attempt: number) => boolean
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'signal' | 'onRetry' | 'shouldRetry'>> = {
  maxAttempts:   5,
  baseDelayMs:   500,
  maxDelayMs:    30_000,
  jitter:        'full',
}

/**
 * Calculate backoff delay with full jitter.
 * Full jitter: random in [0, min(cap, base * 2^attempt)]
 * Prevents synchronized retries across many clients.
 */
export function calculateBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter: RetryOptions['jitter'] = 'full',
  previousDelayMs = 0,
): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt))

  switch (jitter) {
    case 'none':
      return exponential

    case 'full':
      // Uniform random in [0, exponential]
      return Math.random() * exponential

    case 'decorrelated':
      // Decorrelated jitter: random in [base, min(cap, prev * 3)]
      // Avoids correlation between retries
      return Math.min(
        maxDelayMs,
        baseDelayMs + Math.random() * (Math.max(previousDelayMs * 3, baseDelayMs) - baseDelayMs),
      )

    default:
      return exponential
  }
}

/** Sleep for ms, respecting an optional abort signal */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Retry an async operation with exponential backoff.
 *
 * @example
 * const data = await withRetry(
 *   () => fetch('https://relay.example.com'),
 *   { maxAttempts: 3, baseDelayMs: 1000 }
 * )
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  let lastError: unknown
  let prevDelay = 0

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    // Check abort before each attempt
    if (opts.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    try {
      return await fn(attempt)
    } catch (error) {
      lastError = error

      // Never retry abort errors
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }

      // Check if error is retryable
      if (opts.shouldRetry && !opts.shouldRetry(error, attempt)) {
        throw error
      }

      // If last attempt, throw immediately
      if (attempt === opts.maxAttempts - 1) {
        break
      }

      const delay = calculateBackoff(attempt, opts.baseDelayMs, opts.maxDelayMs, opts.jitter, prevDelay)
      prevDelay = delay

      opts.onRetry?.(attempt + 1, delay, error)

      await sleep(delay, opts.signal)
    }
  }

  throw lastError
}

/**
 * Creates a retry-aware fetch that classifies errors correctly.
 * Network errors and 5xx responses are retried; 4xx are not.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  retryOptions?: RetryOptions,
): Promise<Response> {
  return withRetry(
    async () => {
      const response = await fetch(input, init)

      // 5xx errors are transient and worth retrying
      if (response.status >= 500) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      return response
    },
    {
      ...retryOptions,
      shouldRetry: (error, attempt) => {
        // Use custom predicate if provided, otherwise retry all thrown errors
        // (only 5xx throws reach here — 4xx are returned as Response objects above)
        if (retryOptions?.shouldRetry) return retryOptions.shouldRetry(error, attempt)
        return true
      },
    },
  )
}

/**
 * Relay connection backoff state machine.
 * Tracks per-relay failure count and computes next retry time.
 */
export class RelayBackoff {
  private failures = 0
  private lastAttempt = 0
  private readonly baseDelayMs: number
  private readonly maxDelayMs: number
  private readonly maxFailures: number

  constructor(
    baseDelayMs = 1_000,
    maxDelayMs = 300_000, // 5 minutes max
    maxFailures = 12,
  ) {
    this.baseDelayMs = baseDelayMs
    this.maxDelayMs = maxDelayMs
    this.maxFailures = maxFailures
  }

  /** Record a failed connection attempt */
  recordFailure(): void {
    this.failures = Math.min(this.failures + 1, this.maxFailures)
    this.lastAttempt = Date.now()
  }

  /** Record a successful connection — resets failure count */
  recordSuccess(): void {
    this.failures = 0
    this.lastAttempt = 0
  }

  /** Whether we should attempt a reconnection now */
  shouldRetryNow(): boolean {
    if (this.failures === 0) return true
    return Date.now() >= this.nextRetryAt()
  }

  /** Milliseconds until next retry is appropriate */
  msUntilRetry(): number {
    return Math.max(0, this.nextRetryAt() - Date.now())
  }

  /** Absolute timestamp for next retry */
  nextRetryAt(): number {
    const exponential = Math.min(
      this.maxDelayMs,
      this.baseDelayMs * Math.pow(2, this.failures - 1),
    )
    const jitter = Math.random() * exponential
    return this.lastAttempt + jitter
  }

  get failureCount(): number {
    return this.failures
  }

  /** True if failures exceed threshold — may want to stop auto-reconnecting */
  get isExhausted(): boolean {
    return this.failures >= this.maxFailures
  }
}
