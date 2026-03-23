import { buildExpirationTag, getEventExpiration, isEventExpired, normalizeExpiration } from './expiration'
import type { NostrEvent } from '@/types'

const baseEvent: NostrEvent = {
  id: '1'.repeat(64),
  pubkey: '2'.repeat(64),
  created_at: 1_700_000_000,
  kind: 1,
  tags: [],
  content: 'hello',
  sig: '3'.repeat(128),
}

describe('expiration helpers', () => {
  it('normalizes positive integer timestamps only', () => {
    expect(normalizeExpiration('1700000000')).toBe(1_700_000_000)
    expect(normalizeExpiration(1_700_000_000)).toBe(1_700_000_000)
    expect(normalizeExpiration('')).toBeUndefined()
    expect(normalizeExpiration('1700000000abc')).toBeUndefined()
    expect(normalizeExpiration(-1)).toBeUndefined()
  })

  it('builds an expiration tag from a valid timestamp', () => {
    expect(buildExpirationTag(1_700_000_000)).toEqual(['expiration', '1700000000'])
    expect(buildExpirationTag('bad')).toBeNull()
  })

  it('reads the first valid expiration tag on an event', () => {
    const event: NostrEvent = {
      ...baseEvent,
      tags: [
        ['expiration', 'not-a-timestamp'],
        ['expiration', '1700001111'],
      ],
    }

    expect(getEventExpiration(event)).toBe(1_700_001_111)
  })

  it('marks events as expired when the expiration is in the past', () => {
    const event: NostrEvent = {
      ...baseEvent,
      tags: [['expiration', '1700000005']],
    }

    expect(isEventExpired(event, 1_700_000_006)).toBe(true)
    expect(isEventExpired(event, 1_700_000_004)).toBe(false)
  })
})
