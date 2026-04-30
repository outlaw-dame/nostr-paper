import { describe, expect, it } from 'vitest'
import { shouldRetryNostrPublishError } from './outbox'

describe('shouldRetryNostrPublishError', () => {
  it('retries transient timeout/network failures', () => {
    expect(shouldRetryNostrPublishError(new Error('Network timeout while publishing'))).toBe(true)
    expect(shouldRetryNostrPublishError('HTTP 503 relay unavailable')).toBe(true)
    expect(shouldRetryNostrPublishError('rate limit: 429')).toBe(true)
  })

  it('does not retry permanent validation/auth failures', () => {
    expect(shouldRetryNostrPublishError(new Error('invalid event signature'))).toBe(false)
    expect(shouldRetryNostrPublishError('forbidden by relay policy')).toBe(false)
    expect(shouldRetryNostrPublishError('duplicate event')).toBe(false)
  })

  it('defaults to retry for unknown failures to preserve resilience', () => {
    expect(shouldRetryNostrPublishError(new Error('relay publish failed'))).toBe(true)
    expect(shouldRetryNostrPublishError({ code: 'UNKNOWN' })).toBe(true)
  })
})
