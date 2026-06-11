import { describe, expect, it } from 'vitest'
import { classifyPublishError, getPublishErrorMessage } from './publishErrors'

describe('publishErrors', () => {
  it('classifies abort errors as non-retryable cancellations', () => {
    const result = classifyPublishError(new DOMException('Aborted', 'AbortError'))

    expect(result).toEqual({
      kind: 'aborted',
      message: 'Publish cancelled.',
      retryable: false,
    })
  })

  it('classifies signer denial separately from retryable network failures', () => {
    const result = classifyPublishError(new Error('User rejected signing request'))

    expect(result.kind).toBe('signer_denied')
    expect(result.retryable).toBe(false)
    expect(result.message).toContain('Signing was denied')
  })

  it('treats signer cancelled-by-user messages as signer denial, not app aborts', () => {
    expect(classifyPublishError(new Error('cancelled by user'))).toMatchObject({
      kind: 'signer_denied',
      retryable: false,
    })
    expect(classifyPublishError(new Error('canceled by user'))).toMatchObject({
      kind: 'signer_denied',
      retryable: false,
    })
  })

  it('does not classify generic relay rejections as signer denial', () => {
    expect(classifyPublishError(new Error('relay rejected: event is too old'))).toMatchObject({
      kind: 'relay',
      retryable: true,
    })
    expect(classifyPublishError(new Error('restricted: permission denied'))).toMatchObject({
      kind: 'unknown',
      retryable: true,
    })
    expect(classifyPublishError(new Error('blocked: rejected by spam filter'))).toMatchObject({
      kind: 'unknown',
      retryable: true,
    })
  })

  it('extracts signer denial messages from plain RPC-style error objects', () => {
    expect(classifyPublishError({ message: 'signer rejected request' })).toMatchObject({
      kind: 'signer_denied',
      retryable: false,
    })
    expect(classifyPublishError({ error: 'denied signing' })).toMatchObject({
      kind: 'signer_denied',
      retryable: false,
    })
    expect(classifyPublishError({ reason: 'user declined' })).toMatchObject({
      kind: 'signer_denied',
      retryable: false,
    })
  })

  it('classifies missing signer errors as actionable non-retryable failures', () => {
    const result = classifyPublishError(new Error('No signer available — install a NIP-07 extension.'))

    expect(result.kind).toBe('signer_unavailable')
    expect(result.retryable).toBe(false)
    expect(result.message).toBe('Connect and unlock a Nostr signer before publishing.')
  })

  it('preserves validation messages and does not retry them', () => {
    const result = classifyPublishError(new Error('Article content must not be empty.'))

    expect(result.kind).toBe('validation')
    expect(result.retryable).toBe(false)
    expect(result.message).toBe('Article content must not be empty.')
  })

  it('classifies timeout and relay errors as retryable', () => {
    expect(classifyPublishError(new Error('NIP-46 signer timed out while connecting'))).toMatchObject({
      kind: 'timeout',
      retryable: true,
    })
    expect(classifyPublishError(new Error('relay publish failed'))).toMatchObject({
      kind: 'relay',
      retryable: true,
    })
  })

  it('returns a user-facing message helper', () => {
    expect(getPublishErrorMessage(new Error('Failed to fetch relay response'))).toBe(
      'Network connectivity failed while publishing. Check your connection and try again.',
    )
  })
})
