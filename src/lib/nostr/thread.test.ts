import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { naddrEncode } from 'nostr-tools/nip19'
import {
  getConversationRootReference,
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
