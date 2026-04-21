import { describe, expect, it } from 'vitest'
import { Kind, type NostrEvent, type Profile } from '@/types'
import {
  buildSearchGroundedAnswerPrompt,
  buildSearchGroundingDocuments,
} from './groundedAnswer'

function makeEvent(overrides: Partial<NostrEvent>): NostrEvent {
  return {
    id: '1'.repeat(64),
    pubkey: '2'.repeat(64),
    created_at: 1_720_000_000,
    kind: Kind.ShortNote,
    tags: [],
    content: 'Nostr zaps use Lightning payments.',
    sig: '3'.repeat(128),
    ...overrides,
  }
}

describe('buildSearchGroundingDocuments', () => {
  it('uses profile documents first, then event documents', () => {
    const profiles: Profile[] = [{
      pubkey: '4'.repeat(64),
      updatedAt: 123,
      name: 'Alice',
      about: 'Builds Lightning wallets',
    }]
    const events = [makeEvent({ content: 'Zaps are Lightning payments attached to notes.' })]

    const documents = buildSearchGroundingDocuments('what is a zap', events, profiles)

    expect(documents[0]?.source).toBe(`profile:${profiles[0]!.pubkey}`)
    expect(documents[1]?.source).toBe(`event:${events[0]!.id}`)
  })
})

describe('buildSearchGroundedAnswerPrompt', () => {
  it('returns a grounded prompt when there are search documents', () => {
    const prompt = buildSearchGroundedAnswerPrompt(
      'what is a zap',
      [makeEvent({ content: 'A zap is a Lightning payment sent in response to a note.' })],
      [],
    )

    expect(prompt).toContain('<documents>')
    expect(prompt).toContain('<question>what is a zap</question>')
  })

  it('returns null when there is no usable search content', () => {
    const prompt = buildSearchGroundedAnswerPrompt(
      'what is a zap',
      [makeEvent({ content: '' })],
      [],
    )

    expect(prompt).toBeNull()
  })
})
