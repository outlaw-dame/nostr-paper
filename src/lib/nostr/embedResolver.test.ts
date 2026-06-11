import { describe, expect, it } from 'vitest'
import { neventEncode } from 'nostr-tools/nip19'
import {
  buildEmbedFetchFilter,
  normalizeEmbedRelayHints,
  normalizeEventEmbedReference,
  verifyEmbedEvent,
} from './embedResolver'
import { Kind, type NostrEvent } from '@/types'

const FAKE_EVENT: NostrEvent = {
  id: '1'.repeat(64),
  pubkey: '2'.repeat(64),
  created_at: 1_700_000_000,
  kind: Kind.ShortNote,
  tags: [],
  content: 'synthetic event fixture',
  sig: '0'.repeat(128),
}

describe('normalizeEmbedRelayHints', () => {
  it('keeps safe unique wss relay hints and rejects cleartext or malformed hints', () => {
    expect(normalizeEmbedRelayHints([
      ' wss://relay.example.com/ ',
      'wss://relay.example.com',
      'ws://cleartext.example.com',
      'not-a-relay',
      'wss://relay.two.example.com/path/',
    ])).toEqual([
      'wss://relay.example.com',
      'wss://relay.two.example.com/path',
    ])
  })

  it('caps relay hints so pasted references cannot grow the shared pool unbounded', () => {
    expect(normalizeEmbedRelayHints([
      'wss://one.example.com',
      'wss://two.example.com',
      'wss://three.example.com',
    ], 2)).toEqual([
      'wss://one.example.com',
      'wss://two.example.com',
    ])
  })
})

describe('normalizeEventEmbedReference', () => {
  it('preserves nevent author, kind, bech32, and normalized relay hints', () => {
    const nevent = neventEncode({
      id: '1'.repeat(64),
      author: '2'.repeat(64),
      kind: Kind.LongFormContent,
      relays: ['wss://relay.example.com/'],
    })

    expect(normalizeEventEmbedReference(`nostr:${nevent}`)).toEqual({
      eventId: '1'.repeat(64),
      author: '2'.repeat(64),
      kind: Kind.LongFormContent,
      relays: ['wss://relay.example.com'],
      bech32: nevent,
    })
  })

  it('rejects invalid ids or malformed author constraints before relay fetch', () => {
    expect(normalizeEventEmbedReference('not-a-note')).toBeNull()
    expect(normalizeEventEmbedReference({
      eventId: '1'.repeat(64),
      author: 'not-a-pubkey',
      relays: [],
    })).toBeNull()
  })
})

describe('buildEmbedFetchFilter', () => {
  it('uses requested id plus optional author and kind constraints', () => {
    expect(buildEmbedFetchFilter({
      eventId: '1'.repeat(64),
      author: '2'.repeat(64),
      kind: Kind.ShortNote,
      relays: [],
    })).toEqual({
      ids: ['1'.repeat(64)],
      authors: ['2'.repeat(64)],
      kinds: [Kind.ShortNote],
      limit: 1,
    })
  })
})

describe('verifyEmbedEvent', () => {
  it('rejects invalid signature data when full verification is requested', () => {
    expect(verifyEmbedEvent(FAKE_EVENT, {
      eventId: FAKE_EVENT.id,
      relays: [],
    })).toEqual({ ok: false, reason: 'invalid-structure-or-signature' })
  })

  it('allows structurally valid database-backed events to skip redundant signature work', () => {
    expect(verifyEmbedEvent(FAKE_EVENT, {
      eventId: FAKE_EVENT.id,
      relays: [],
    }, false)).toEqual({ ok: true })
  })

  it('still enforces requested author and kind constraints in structural mode', () => {
    expect(verifyEmbedEvent(FAKE_EVENT, {
      eventId: FAKE_EVENT.id,
      author: 'f'.repeat(64),
      relays: [],
    }, false)).toEqual({ ok: false, reason: 'requested-author-mismatch' })

    expect(verifyEmbedEvent(FAKE_EVENT, {
      eventId: FAKE_EVENT.id,
      kind: Kind.LongFormContent,
      relays: [],
    }, false)).toEqual({ ok: false, reason: 'requested-kind-mismatch' })
  })
})
