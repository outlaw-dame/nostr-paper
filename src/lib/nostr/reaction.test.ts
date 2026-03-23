import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { getReactionLabel, parseReactionEvent } from './reaction'
import type { NostrEvent, UnsignedEvent } from '@/types'

function signEvent(event: UnsignedEvent): NostrEvent {
  const secretKey = generateSecretKey()
  return finalizeEvent(event, secretKey) as NostrEvent
}

describe('parseReactionEvent', () => {
  it('treats empty or plus content as a like', () => {
    const reaction = signEvent({
      kind: 7,
      pubkey: 'a'.repeat(64),
      created_at: 1_700_000_000,
      tags: [
        ['e', 'b'.repeat(64)],
        ['p', 'c'.repeat(64)],
        ['k', '1'],
      ],
      content: '',
    })

    const parsed = parseReactionEvent(reaction)

    expect(parsed).not.toBeNull()
    expect(parsed?.type).toBe('like')
    expect(parsed?.targetEventId).toBe('b'.repeat(64))
    expect(parsed?.targetPubkey).toBe('c'.repeat(64))
    expect(parsed?.targetKind).toBe(1)
  })

  it('parses custom emoji reactions only when a matching emoji tag is present', () => {
    const reaction = signEvent({
      kind: 7,
      pubkey: 'a'.repeat(64),
      created_at: 1_700_000_001,
      tags: [
        ['e', 'b'.repeat(64)],
        ['emoji', 'party', 'https://example.com/party.png'],
      ],
      content: ':party:',
    })

    const parsed = parseReactionEvent(reaction)

    expect(parsed?.type).toBe('custom-emoji')
    expect(parsed?.emojiName).toBe('party')
    expect(parsed?.emojiUrl).toBe('https://example.com/party.png')
    expect(getReactionLabel(parsed!)).toBe('Reacted with :party:')
  })

  it('does not treat malformed multiple emoji tags as a valid custom emoji reaction', () => {
    const reaction = signEvent({
      kind: 7,
      pubkey: 'a'.repeat(64),
      created_at: 1_700_000_001,
      tags: [
        ['e', 'b'.repeat(64)],
        ['emoji', 'party', 'https://example.com/party.png'],
        ['emoji', 'party', 'https://example.com/party-2.png'],
      ],
      content: ':party:',
    })

    expect(parseReactionEvent(reaction)?.type).toBe('other')
  })

  it('falls back to generic reactions for arbitrary text', () => {
    const reaction = signEvent({
      kind: 7,
      pubkey: 'a'.repeat(64),
      created_at: 1_700_000_002,
      tags: [['e', 'b'.repeat(64)]],
      content: 'nostr!',
    })

    expect(parseReactionEvent(reaction)?.type).toBe('other')
  })
})
