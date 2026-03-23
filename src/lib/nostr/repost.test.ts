import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { naddrEncode, noteEncode } from 'nostr-tools/nip19'
import {
  buildQuoteTagsFromContent,
  getQuotePostBody,
  getRepostPreviewText,
  parseQuoteTags,
  parseRepostEvent,
} from './repost'
import type { NostrEvent, UnsignedEvent } from '@/types'
import { Kind } from '@/types'

function signEvent(event: UnsignedEvent): NostrEvent {
  const secretKey = generateSecretKey()
  return finalizeEvent(event, secretKey) as NostrEvent
}

function buildNote(content = 'Hello world'): NostrEvent {
  const secretKey = generateSecretKey()
  return finalizeEvent({
    kind: Kind.ShortNote,
    created_at: 1_700_000_000,
    tags: [],
    content,
  }, secretKey) as NostrEvent
}

describe('parseRepostEvent', () => {
  it('parses compliant kind-6 reposts and validates the embedded note', () => {
    const original = buildNote('Original note content')
    const repost = signEvent({
      kind: Kind.Repost,
      pubkey: 'f'.repeat(64),
      created_at: 1_700_000_100,
      tags: [
        ['e', original.id, 'wss://relay.example.com', original.pubkey],
        ['p', original.pubkey, 'wss://relay.example.com'],
      ],
      content: JSON.stringify(original),
    })

    const parsed = parseRepostEvent(repost)

    expect(parsed).not.toBeNull()
    expect(parsed?.targetEventId).toBe(original.id)
    expect(parsed?.targetPubkey).toBe(original.pubkey)
    expect(parsed?.relayHint).toBe('wss://relay.example.com/')
    expect(parsed?.embeddedEvent?.id).toBe(original.id)
  })

  it('ignores malformed embedded JSON and falls back to metadata-only reposts', () => {
    const repost = signEvent({
      kind: Kind.Repost,
      pubkey: 'f'.repeat(64),
      created_at: 1_700_000_100,
      tags: [
        ['e', 'a'.repeat(64), 'wss://relay.example.com', 'b'.repeat(64)],
        ['p', 'b'.repeat(64)],
      ],
      content: '{"bad":true}',
    })

    const parsed = parseRepostEvent(repost)

    expect(parsed).not.toBeNull()
    expect(parsed?.embeddedEvent).toBeUndefined()
    expect(getRepostPreviewText(repost)).toBe('Reposted a note')
  })

  it('parses compliant kind-16 generic reposts of addressable events', () => {
    const article = signEvent({
      kind: Kind.LongFormContent,
      pubkey: 'b'.repeat(64),
      created_at: 1_700_000_001,
      tags: [['d', 'hello-world']],
      content: '# Hello',
    })

    const repost = signEvent({
      kind: Kind.GenericRepost,
      pubkey: 'f'.repeat(64),
      created_at: 1_700_000_100,
      tags: [
        ['e', article.id, 'wss://relay.example.com', article.pubkey],
        ['p', article.pubkey],
        ['k', String(Kind.LongFormContent)],
        ['a', `${Kind.LongFormContent}:${article.pubkey}:hello-world`, 'wss://relay.example.com', article.pubkey],
      ],
      content: JSON.stringify(article),
    })

    const parsed = parseRepostEvent(repost)

    expect(parsed).not.toBeNull()
    expect(parsed?.repostKind).toBe(Kind.GenericRepost)
    expect(parsed?.targetKind).toBe(Kind.LongFormContent)
    expect(parsed?.targetAddress).toBe(`${Kind.LongFormContent}:${article.pubkey}:hello-world`)
    expect(parsed?.embeddedEvent?.id).toBe(article.id)
    expect(getRepostPreviewText(repost)).toBe('Reposted an article')
  })
})

describe('quote repost helpers', () => {
  it('parses q tags for event ids and address coordinates', () => {
    const event = signEvent({
      kind: Kind.ShortNote,
      pubkey: 'f'.repeat(64),
      created_at: 1_700_000_120,
      tags: [
        ['q', 'a'.repeat(64), 'wss://relay.example.com', 'b'.repeat(64)],
        ['q', `${Kind.LongFormContent}:${'c'.repeat(64)}:hello-world`, 'wss://relay.example.com', 'c'.repeat(64)],
      ],
      content: 'Quoted',
    })

    const quotes = parseQuoteTags(event)

    expect(quotes).toEqual([
      {
        key: `event:${'a'.repeat(64)}`,
        eventId: 'a'.repeat(64),
        relayHint: 'wss://relay.example.com/',
        authorPubkey: 'b'.repeat(64),
      },
      {
        key: `address:${Kind.LongFormContent}:${'c'.repeat(64)}:hello-world`,
        address: `${Kind.LongFormContent}:${'c'.repeat(64)}:hello-world`,
        relayHint: 'wss://relay.example.com/',
        authorPubkey: 'c'.repeat(64),
      },
    ])
  })

  it('builds q tags from nostr URIs in content', () => {
    const noteUri = `nostr:${noteEncode('1'.repeat(64))}`
    const addressUri = `nostr:${naddrEncode({
      kind: Kind.LongFormContent,
      pubkey: '2'.repeat(64),
      identifier: 'hello-world',
      relays: ['wss://relay.example.com'],
    })}`
    const tags = buildQuoteTagsFromContent(
      `See ${noteUri} and ${addressUri}`
    )

    expect(tags).toHaveLength(2)
    expect(tags[0]?.[0]).toBe('q')
    expect(tags[1]?.[0]).toBe('q')
  })

  it('strips trailing quoted nostr references from visible note body', () => {
    const noteUri = `nostr:${noteEncode('1'.repeat(64))}`
    const event = signEvent({
      kind: Kind.ShortNote,
      pubkey: 'f'.repeat(64),
      created_at: 1_700_000_150,
      tags: [['q', '1'.repeat(64)]],
      content: `My comment\n\n${noteUri}`,
    })

    expect(getQuotePostBody(event)).toBe('My comment')
  })
})
