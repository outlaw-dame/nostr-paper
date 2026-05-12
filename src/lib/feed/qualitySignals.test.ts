import { describe, expect, it } from 'vitest'
import { getEventQualitySignals, isDeepReadEvent } from './qualitySignals'
import { Kind, type NostrEvent } from '@/types'

function makeEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: Kind.ShortNote,
    tags: [],
    content: 'Short note',
    sig: 'c'.repeat(128),
    ...overrides,
  }
}

describe('qualitySignals', () => {
  it('returns explainable reasons for longform article events', () => {
    const event = makeEvent({
      kind: Kind.LongFormContent,
      tags: [['title', 'Deep topic'], ['summary', 'Strong summary'], ['t', 'nostr'], ['t', 'ai']],
      content: 'x'.repeat(500),
    })

    const signals = getEventQualitySignals(event)
    expect(signals.score).toBeGreaterThan(2)
    expect(signals.reasons.length).toBeGreaterThan(0)
    expect(signals.primaryTopic).toBe('nostr')
  })

  it('marks long text notes as deep reads', () => {
    const deepNote = makeEvent({ content: 'x'.repeat(320) })
    expect(isDeepReadEvent(deepNote)).toBe(true)

    const shortNote = makeEvent({ content: 'small update' })
    expect(isDeepReadEvent(shortNote)).toBe(false)
  })
})
