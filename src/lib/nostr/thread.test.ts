import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { naddrEncode } from 'nostr-tools/nip19'
import {
  getConversationRootReference,
  hasQuoteTags,
  isQuoteRepost,
  isTextNoteReply,
  isThreadComment,
  parseCommentEvent,
  parseNumberedThreadMarker,
  parseTextNoteReply,
  parseThreadEvent,
} from './thread'
import type { NostrEvent, UnsignedEvent } from '@/types'
import { Kind } from '@/types'

function signEvent(event: Omit<UnsignedEvent, 'pubkey'> & { pubkey?: string }): NostrEvent {
  const secretKey = generateSecretKey()
  return finalizeEvent({
    pubkey: 'f'.repeat(64),
    ...event,
  }, secretKey) as NostrEvent
}

describe('parseThreadEvent', () => {
  it('parses kind-11 threads with title and plaintext content', () => {
    const event = signEvent({
      kind: Kind.Thread,
      created_at: 1_720_000_000,
      tags: [['title', 'GM']],
      content: 'Good morning',
    })

    expect(parseThreadEvent(event)).toEqual({
      id: event.id,
      pubkey: event.pubkey,
      createdAt: event.created_at,
      title: 'GM',
      content: 'Good morning',
    })
  })
})

describe('parseNumberedThreadMarker', () => {
  it('parses thread counters like "Thread 1/4" and "🧵 2/8"', () => {
    expect(parseNumberedThreadMarker('🧵 Thread 1/4 once i have an implementation')).toEqual({ index: 1, total: 4 })
    expect(parseNumberedThreadMarker('🧵 2/8 continuing this thought')).toEqual({ index: 2, total: 8 })
  })

  it('ignores invalid counters', () => {
    expect(parseNumberedThreadMarker('Thread 0/4')).toBeNull()
    expect(parseNumberedThreadMarker('Thread 5/4')).toBeNull()
    expect(parseNumberedThreadMarker('not a thread marker')).toBeNull()
  })
})

describe('parseTextNoteReply', () => {
  it('parses marked root-only top-level replies', () => {
    const reply = signEvent({
      kind: Kind.ShortNote,
      created_at: 1_720_000_000,
      tags: [
        ['e', '1'.repeat(64), 'wss://relay.example.com', 'root', '2'.repeat(64)],
        ['p', '2'.repeat(64)],
      ],
      content: 'Replying',
    })

    expect(parseTextNoteReply(reply)).toEqual({
      id: reply.id,
      pubkey: reply.pubkey,
      createdAt: reply.created_at,
      rootEventId: '1'.repeat(64),
      parentEventId: '1'.repeat(64),
      rootRelayHint: 'wss://relay.example.com/',
      parentRelayHint: 'wss://relay.example.com/',
      rootAuthorPubkey: '2'.repeat(64),
      parentAuthorPubkey: '2'.repeat(64),
      mentionedPubkeys: ['2'.repeat(64)],
    })
  })

  it('parses marked nested replies', () => {
    const reply = signEvent({
      kind: Kind.ShortNote,
      created_at: 1_720_000_100,
      tags: [
        ['e', '1'.repeat(64), 'wss://relay.example.com', 'root', '2'.repeat(64)],
        ['e', '3'.repeat(64), 'wss://relay.example.com', 'reply', '4'.repeat(64)],
        ['p', '2'.repeat(64)],
        ['p', '4'.repeat(64)],
      ],
      content: 'Nested reply',
    })

    expect(parseTextNoteReply(reply)).toMatchObject({
      rootEventId: '1'.repeat(64),
      parentEventId: '3'.repeat(64),
      rootAuthorPubkey: '2'.repeat(64),
      parentAuthorPubkey: '4'.repeat(64),
    })
  })

  it('falls back to deprecated positional e tags for compatibility', () => {
    const reply = signEvent({
      kind: Kind.ShortNote,
      created_at: 1_720_000_200,
      tags: [
        ['e', '1'.repeat(64), 'wss://relay.example.com'],
        ['e', '2'.repeat(64), 'wss://relay2.example.com'],
      ],
      content: 'Old-school reply',
    })

    expect(parseTextNoteReply(reply)).toMatchObject({
      rootEventId: '1'.repeat(64),
      parentEventId: '2'.repeat(64),
      rootRelayHint: 'wss://relay.example.com/',
      parentRelayHint: 'wss://relay2.example.com/',
    })
  })

  it('prefers reply marker for parent when unmarked mention tags are present', () => {
    const reply = signEvent({
      kind: Kind.ShortNote,
      created_at: 1_720_000_300,
      tags: [
        ['e', '1'.repeat(64), 'wss://relay.example.com', 'root', '2'.repeat(64)],
        ['e', '9'.repeat(64), 'wss://relay-mention.example.com'],
        ['e', '3'.repeat(64), 'wss://relay.example.com', 'reply', '4'.repeat(64)],
      ],
      content: 'Reply with mention',
    })

    expect(parseTextNoteReply(reply)).toMatchObject({
      rootEventId: '1'.repeat(64),
      parentEventId: '3'.repeat(64),
      parentAuthorPubkey: '4'.repeat(64),
    })
  })

  it('uses trailing unmarked e tag as parent fallback when reply marker is missing', () => {
    const reply = signEvent({
      kind: Kind.ShortNote,
      created_at: 1_720_000_400,
      tags: [
        ['e', '1'.repeat(64), 'wss://relay.example.com', 'root', '2'.repeat(64)],
        ['e', '3'.repeat(64), 'wss://relay-parent.example.com', '', '4'.repeat(64)],
      ],
      content: 'Reply missing reply marker',
    })

    expect(parseTextNoteReply(reply)).toMatchObject({
      rootEventId: '1'.repeat(64),
      parentEventId: '3'.repeat(64),
      parentRelayHint: 'wss://relay-parent.example.com/',
      parentAuthorPubkey: '4'.repeat(64),
    })
  })
})

describe('parseCommentEvent', () => {
  it('parses top-level NIP-7D thread replies as kind-1111 comments', () => {
    const comment = signEvent({
      kind: Kind.Comment,
      created_at: 1_720_000_000,
      tags: [
        ['K', '11'],
        ['E', '1'.repeat(64), 'wss://relay.example.com', '2'.repeat(64)],
        ['P', '2'.repeat(64), 'wss://relay.example.com'],
        ['k', '11'],
        ['e', '1'.repeat(64), 'wss://relay.example.com', '2'.repeat(64)],
        ['p', '2'.repeat(64), 'wss://relay.example.com'],
      ],
      content: 'Cool beans',
    })

    const parsed = parseCommentEvent(comment)

    expect(parsed).toMatchObject({
      rootKind: '11',
      parentKind: '11',
      rootEventId: '1'.repeat(64),
      parentEventId: '1'.repeat(64),
      rootAuthorPubkey: '2'.repeat(64),
      parentAuthorPubkey: '2'.repeat(64),
    })
    expect(isThreadComment(parsed!)).toBe(true)
  })

  it('parses comments on addressable roots and keeps both a and e parent refs', () => {
    const articleAddress = `${Kind.LongFormContent}:${'2'.repeat(64)}:hello-world`
    const comment = signEvent({
      kind: Kind.Comment,
      created_at: 1_720_000_100,
      tags: [
        ['A', articleAddress, 'wss://relay.example.com'],
        ['K', String(Kind.LongFormContent)],
        ['P', '2'.repeat(64), 'wss://relay.example.com'],
        ['a', articleAddress, 'wss://relay.example.com', '2'.repeat(64)],
        ['e', '3'.repeat(64), 'wss://relay.example.com', '2'.repeat(64)],
        ['k', String(Kind.LongFormContent)],
        ['p', '2'.repeat(64), 'wss://relay.example.com'],
      ],
      content: 'Great article',
    })

    expect(parseCommentEvent(comment)).toMatchObject({
      rootKind: String(Kind.LongFormContent),
      rootAddress: articleAddress,
      parentAddress: articleAddress,
      parentEventId: '3'.repeat(64),
    })
  })
})

describe('getConversationRootReference', () => {
  it('resolves addressable roots for NIP-22 comments', () => {
    const naddr = naddrEncode({
      kind: Kind.LongFormContent,
      pubkey: '2'.repeat(64),
      identifier: 'hello-world',
    })
    const address = `${Kind.LongFormContent}:${'2'.repeat(64)}:hello-world`
    const comment = signEvent({
      kind: Kind.Comment,
      created_at: 1_720_000_100,
      tags: [
        ['A', address],
        ['K', String(Kind.LongFormContent)],
        ['a', address],
        ['k', String(Kind.LongFormContent)],
      ],
      content: `See nostr:${naddr}`,
    })

    expect(getConversationRootReference(comment)).toEqual({
      kind: Kind.LongFormContent,
      address,
    })
  })
})

describe('isTextNoteReply', () => {
  it('returns true for a kind-1 event with a marked root e-tag', () => {
    const reply = signEvent({
      kind: Kind.ShortNote,
      created_at: 1_720_000_000,
      tags: [['e', '1'.repeat(64), '', 'root', '2'.repeat(64)]],
      content: 'reply',
    })
    expect(isTextNoteReply(reply)).toBe(true)
  })

  it('returns true for a kind-1 event with a legacy positional e-tag', () => {
    const reply = signEvent({
      kind: Kind.ShortNote,
      created_at: 1_720_000_100,
      tags: [['e', '1'.repeat(64), 'wss://relay.example.com']],
      content: 'legacy reply',
    })
    expect(isTextNoteReply(reply)).toBe(true)
  })

  it('returns false for a kind-1 event with no e-tags', () => {
    const note = signEvent({
      kind: Kind.ShortNote,
      created_at: 1_720_000_200,
      tags: [],
      content: 'standalone note',
    })
    expect(isTextNoteReply(note)).toBe(false)
  })

  it('returns false for a non-kind-1 event', () => {
    const thread = signEvent({
      kind: Kind.Thread,
      created_at: 1_720_000_300,
      tags: [['title', 'Test']],
      content: 'a thread',
    })
    expect(isTextNoteReply(thread)).toBe(false)
  })
})

describe('hasQuoteTags', () => {
  it('returns true when the event has a q-tag', () => {
    const event = signEvent({
      kind: Kind.ShortNote,
      created_at: 1_720_000_000,
      tags: [['q', '1'.repeat(64), 'wss://relay.example.com', '2'.repeat(64)]],
      content: 'quoting nostr:note1...',
    })
    expect(hasQuoteTags(event)).toBe(true)
  })

  it('returns false when there are no q-tags', () => {
    const event = signEvent({
      kind: Kind.ShortNote,
      created_at: 1_720_000_100,
      tags: [['e', '1'.repeat(64), '', 'root']],
      content: 'plain reply',
    })
    expect(hasQuoteTags(event)).toBe(false)
  })
})

describe('isQuoteRepost', () => {
  it('returns true for a pure quote (q-tag, no reply e-tags)', () => {
    const quote = signEvent({
      kind: Kind.ShortNote,
      created_at: 1_720_000_000,
      tags: [['q', '1'.repeat(64), 'wss://relay.example.com', '2'.repeat(64)]],
      content: 'look at this: nostr:note1...',
    })
    expect(isQuoteRepost(quote)).toBe(true)
  })

  it('returns false for a quote-reply (has both q-tag and reply e-tags)', () => {
    const quoteReply = signEvent({
      kind: Kind.ShortNote,
      created_at: 1_720_000_100,
      tags: [
        ['e', '1'.repeat(64), '', 'root', '2'.repeat(64)],
        ['q', '3'.repeat(64), 'wss://relay.example.com', '4'.repeat(64)],
      ],
      content: 'reply with quote',
    })
    // isTextNoteReply + hasQuoteTags both true; isQuoteRepost should be false
    expect(isTextNoteReply(quoteReply)).toBe(true)
    expect(hasQuoteTags(quoteReply)).toBe(true)
    expect(isQuoteRepost(quoteReply)).toBe(false)
  })

  it('returns false for a plain reply (no q-tags)', () => {
    const reply = signEvent({
      kind: Kind.ShortNote,
      created_at: 1_720_000_200,
      tags: [['e', '1'.repeat(64), '', 'root', '2'.repeat(64)]],
      content: 'reply',
    })
    expect(isQuoteRepost(reply)).toBe(false)
  })

  it('returns false for a non-kind-1 event even with q-tags', () => {
    const comment = signEvent({
      kind: Kind.Comment,
      created_at: 1_720_000_300,
      tags: [
        ['K', '1'],
        ['E', '1'.repeat(64), '', '2'.repeat(64)],
        ['k', '1'],
        ['e', '1'.repeat(64), '', '2'.repeat(64)],
        ['q', '3'.repeat(64)],
      ],
      content: 'comment with quote ref',
    })
    expect(isQuoteRepost(comment)).toBe(false)
  })
})
