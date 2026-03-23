import {
  buildContactListTags,
  isNewerReplaceableEvent,
  normalizeContactRelayHint,
  parseContactListEvent,
  removeContactListEntry,
  upsertContactListEntry,
} from './contactList'
import type { ContactListEntry, NostrEvent } from '@/types'
import { Kind } from '@/types'

function baseEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: Kind.Contacts,
    tags: [],
    content: '',
    sig: 'c'.repeat(128),
    ...overrides,
  }
}

describe('normalizeContactRelayHint', () => {
  it('normalizes relay hints and strips fragments', () => {
    expect(normalizeContactRelayHint(' wss://relay.example.com#ignore ')).toBe(
      'wss://relay.example.com/',
    )
  })

  it('rejects invalid relay hints', () => {
    expect(normalizeContactRelayHint('https://relay.example.com')).toBeUndefined()
    expect(normalizeContactRelayHint('')).toBeUndefined()
  })
})

describe('parseContactListEvent', () => {
  it('parses valid p tags and keeps relay hints and petnames', () => {
    const parsed = parseContactListEvent(baseEvent({
      tags: [
        ['p', '1'.repeat(64), 'wss://relay.one', 'alice'],
        ['p', '2'.repeat(64), '', 'bob'],
      ],
    }))

    expect(parsed).not.toBeNull()
    expect(parsed?.entries).toEqual<ContactListEntry[]>([
      {
        pubkey: '1'.repeat(64),
        relayUrl: 'wss://relay.one/',
        petname: 'alice',
        position: 0,
      },
      {
        pubkey: '2'.repeat(64),
        petname: 'bob',
        position: 1,
      },
    ])
  })

  it('deduplicates malformed repeated pubkeys by keeping the last valid occurrence', () => {
    const parsed = parseContactListEvent(baseEvent({
      tags: [
        ['p', '1'.repeat(64), '', 'first'],
        ['p', 'x-not-a-pubkey'],
        ['p', '1'.repeat(64), 'wss://relay.two', 'second'],
      ],
    }))

    expect(parsed?.entries).toEqual([
      {
        pubkey: '1'.repeat(64),
        relayUrl: 'wss://relay.two/',
        petname: 'second',
        position: 2,
      },
    ])
  })
})

describe('buildContactListTags', () => {
  it('emits compact NIP-02 p tags in order', () => {
    const tags = buildContactListTags([
      { pubkey: '2'.repeat(64), position: 1, petname: 'bob' },
      { pubkey: '1'.repeat(64), position: 0, relayUrl: 'wss://relay.one/' },
    ])

    expect(tags).toEqual([
      ['p', '1'.repeat(64), 'wss://relay.one/'],
      ['p', '2'.repeat(64), '', 'bob'],
    ])
  })
})

describe('contact list mutations', () => {
  it('preserves position when updating an existing follow and appends new follows', () => {
    const initial: ContactListEntry[] = [
      { pubkey: '1'.repeat(64), position: 0, petname: 'alice' },
      { pubkey: '2'.repeat(64), position: 1, petname: 'bob' },
    ]

    const updated = upsertContactListEntry(initial, {
      pubkey: '1'.repeat(64),
      relayUrl: 'wss://relay.one',
      petname: 'alice-updated',
    })
    const appended = upsertContactListEntry(updated, {
      pubkey: '3'.repeat(64),
      petname: 'carol',
    })

    expect(updated[0]).toEqual({
      pubkey: '1'.repeat(64),
      position: 0,
      relayUrl: 'wss://relay.one/',
      petname: 'alice-updated',
    })
    expect(appended[2]).toEqual({
      pubkey: '3'.repeat(64),
      position: 2,
      petname: 'carol',
    })
  })

  it('removes follows by pubkey', () => {
    expect(removeContactListEntry([
      { pubkey: '1'.repeat(64), position: 0 },
      { pubkey: '2'.repeat(64), position: 1 },
    ], '1'.repeat(64))).toEqual([
      { pubkey: '2'.repeat(64), position: 1 },
    ])
  })
})

describe('isNewerReplaceableEvent', () => {
  it('compares by created_at and then event id', () => {
    expect(isNewerReplaceableEvent(
      { createdAt: 11, eventId: 'b' },
      { createdAt: 10, eventId: 'z' },
    )).toBe(true)

    expect(isNewerReplaceableEvent(
      { createdAt: 10, eventId: 'b' },
      { createdAt: 10, eventId: 'c' },
    )).toBe(false)
  })
})
