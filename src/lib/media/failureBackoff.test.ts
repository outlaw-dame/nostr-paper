import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getMediaUrlBackoffRemainingMs,
  recordMediaUrlFailure,
  recordMediaUrlSuccess,
  resetMediaUrlFailureBackoffForTests,
  shouldAttemptMediaUrl,
} from '@/lib/media/failureBackoff'

describe('media failure backoff', () => {
  const url = 'https://example.com/dead.jpg'

  afterEach(() => {
    resetMediaUrlFailureBackoffForTests()
    vi.restoreAllMocks()
  })

  it('blocks immediate retries after a failure and allows retry after backoff window', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)

    expect(shouldAttemptMediaUrl(url, 1_000)).toBe(true)

    recordMediaUrlFailure(url, 1_000)

    expect(shouldAttemptMediaUrl(url, 4_999)).toBe(false)
    expect(shouldAttemptMediaUrl(url, 5_000)).toBe(true)
  })

  it('clears failure state after a successful load', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)

    recordMediaUrlFailure(url, 10_000)
    expect(shouldAttemptMediaUrl(url, 10_100)).toBe(false)

    recordMediaUrlSuccess(url)

    expect(shouldAttemptMediaUrl(url, 10_100)).toBe(true)
    expect(getMediaUrlBackoffRemainingMs(url, 10_100)).toBe(0)
  })

  it('backs off more aggressively after repeated failures', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)

    recordMediaUrlFailure(url, 0)
    const firstDelay = getMediaUrlBackoffRemainingMs(url, 0)

    recordMediaUrlFailure(url, 5_000)
    const secondDelay = getMediaUrlBackoffRemainingMs(url, 5_000)

    expect(firstDelay).toBe(4_000)
    expect(secondDelay).toBe(8_000)
  })
})
