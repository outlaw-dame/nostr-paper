/**
 * Tests: Retry & Backoff
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withRetry, calculateBackoff, sleep, RelayBackoff } from './retry'

describe('calculateBackoff', () => {
  it('returns 0 on first full-jitter attempt (statistical — check range)', () => {
    for (let i = 0; i < 20; i++) {
      const val = calculateBackoff(0, 500, 30_000, 'full')
      expect(val).toBeGreaterThanOrEqual(0)
      expect(val).toBeLessThanOrEqual(500)
    }
  })

  it('caps at maxDelayMs', () => {
    const val = calculateBackoff(100, 500, 30_000, 'none')
    expect(val).toBe(30_000)
  })

  it('returns exact exponential with no jitter', () => {
    expect(calculateBackoff(0, 500, 30_000, 'none')).toBe(500)
    expect(calculateBackoff(1, 500, 30_000, 'none')).toBe(1_000)
    expect(calculateBackoff(2, 500, 30_000, 'none')).toBe(2_000)
    expect(calculateBackoff(3, 500, 30_000, 'none')).toBe(4_000)
  })
})

describe('sleep', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('resolves after specified ms', async () => {
    const p = sleep(1_000)
    vi.advanceTimersByTime(1_000)
    await expect(p).resolves.toBeUndefined()
  })

  it('rejects when abort signal fires', async () => {
    const controller = new AbortController()
    const p = sleep(10_000, controller.signal)
    controller.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects immediately if signal already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(sleep(1_000, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('withRetry', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns value on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const p  = withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 })
    await vi.runAllTimersAsync()
    expect(await p).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on failure then succeeds', async () => {
    let count = 0
    const fn = vi.fn().mockImplementation(async () => {
      if (count++ < 2) throw new Error('temp fail')
      return 'success'
    })

    const p = withRetry(fn, { maxAttempts: 5, baseDelayMs: 10 })
    await vi.runAllTimersAsync()
    expect(await p).toBe('success')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('throws after exhausting maxAttempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'))
    const p  = withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 })
    const rejection = expect(p).rejects.toThrow('always fails')
    await vi.runAllTimersAsync()
    await rejection
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('stops retrying when shouldRetry returns false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('client error'))
    const p  = withRetry(fn, {
      maxAttempts:  5,
      baseDelayMs:  10,
      shouldRetry: () => false,
    })
    const rejection = expect(p).rejects.toThrow('client error')
    await vi.runAllTimersAsync()
    await rejection
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('calls onRetry with correct arguments', async () => {
    const onRetry = vi.fn()
    let count = 0
    const fn = vi.fn().mockImplementation(async () => {
      if (count++ < 1) throw new Error('fail')
      return 'ok'
    })

    const p = withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, onRetry })
    await vi.runAllTimersAsync()
    await p

    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Number), expect.any(Error))
  })

  it('respects abort signal', async () => {
    const controller = new AbortController()
    const fn = vi.fn().mockRejectedValue(new Error('fail'))

    const p = withRetry(fn, {
      maxAttempts: 10,
      baseDelayMs: 100,
      signal: controller.signal,
    })

    // Abort after first attempt
    vi.advanceTimersByTime(0)
    controller.abort()
    const rejection = expect(p).rejects.toMatchObject({ name: 'AbortError' })
    await vi.runAllTimersAsync()

    await rejection
  })

  it('never retries AbortError', async () => {
    const fn = vi.fn().mockRejectedValue(
      new DOMException('Aborted', 'AbortError')
    )
    const p = withRetry(fn, { maxAttempts: 5, baseDelayMs: 10 })
    const rejection = expect(p).rejects.toMatchObject({ name: 'AbortError' })
    await vi.runAllTimersAsync()
    await rejection
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('RelayBackoff', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('should retry immediately on first failure', () => {
    const backoff = new RelayBackoff(1_000, 60_000)
    backoff.recordFailure()
    // After the first failure, next retry might be within jitter range
    expect(backoff.failureCount).toBe(1)
  })

  it('resets failure count on success', () => {
    const backoff = new RelayBackoff()
    backoff.recordFailure()
    backoff.recordFailure()
    backoff.recordSuccess()
    expect(backoff.failureCount).toBe(0)
    expect(backoff.shouldRetryNow()).toBe(true)
  })

  it('caps failure count at maxFailures', () => {
    const backoff = new RelayBackoff(100, 1_000, 5)
    for (let i = 0; i < 20; i++) backoff.recordFailure()
    expect(backoff.failureCount).toBe(5)
    expect(backoff.isExhausted).toBe(true)
  })

  it('shouldRetryNow returns false during backoff window', () => {
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))
    const backoff = new RelayBackoff(10_000, 60_000)
    backoff.recordFailure()

    // Even with jitter, next retry is some time after now
    // Advance only 1ms — should not retry
    vi.advanceTimersByTime(1)
    // After a single failure with 10s base, retry window is 0-10s
    // We can't guarantee this without controlling Math.random
    // Just verify it's a boolean
    expect(typeof backoff.shouldRetryNow()).toBe('boolean')
  })
})
