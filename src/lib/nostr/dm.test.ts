import {
  buildDirectMessageFilters,
  getDirectMessageCapability,
  parseDirectMessageEvent,
} from './dm'
import { Kind, type NostrEvent } from '@/types'

function makeEvent(event: Omit<NostrEvent, 'id' | 'sig'>, id = 'e'.repeat(64)): NostrEvent {
  return {
    ...event,
    id,
    sig: 'f'.repeat(128),
  }
}

describe('direct message helpers', () => {
  it('parses inbound and outbound kind-4 message metadata', () => {
    const viewer = 'a'.repeat(64)
    const counterparty = 'b'.repeat(64)
    const inbound = makeEvent({
      kind: Kind.EncryptedDm,
      pubkey: counterparty,
      created_at: 1_700_000_000,
      tags: [['p', viewer], ['encrypted', 'nip44']],
      content: 'ciphertext',
    }, 'c'.repeat(64))
    const outbound = makeEvent({
      kind: Kind.EncryptedDm,
      pubkey: viewer,
      created_at: 1_700_000_100,
      tags: [['p', counterparty], ['encrypted', 'nip04']],
      content: 'ciphertext?iv=abc',
    }, 'd'.repeat(64))

    expect(parseDirectMessageEvent(inbound, viewer)).toMatchObject({
      recipientPubkey: viewer,
      counterpartyPubkey: counterparty,
      direction: 'inbound',
      encryption: 'nip44',
      protocol: 'kind4-nip44',
    })
    expect(parseDirectMessageEvent(outbound, viewer)).toMatchObject({
      recipientPubkey: counterparty,
      counterpartyPubkey: counterparty,
      direction: 'outbound',
      encryption: 'nip04',
      protocol: 'kind4-nip04',
    })
  })

  it('builds paired inbox and thread filters', () => {
    const viewer = 'a'.repeat(64)
    const counterparty = 'b'.repeat(64)

    expect(buildDirectMessageFilters(viewer, counterparty, 50)).toEqual([
      {
        kinds: [Kind.EncryptedDm],
        authors: [counterparty],
        '#p': [viewer],
        limit: 50,
      },
      {
        kinds: [Kind.EncryptedDm],
        authors: [viewer],
        '#p': [counterparty],
        limit: 50,
      },
    ])

    expect(buildDirectMessageFilters(viewer, undefined, 50)).toEqual([
      {
        kinds: [Kind.EncryptedDm],
        '#p': [viewer],
        limit: 50,
      },
      {
        kinds: [Kind.EncryptedDm],
        authors: [viewer],
        limit: 50,
      },
    ])
  })

  it('reports unavailable encryption when no extension crypto is present', () => {
    const originalNostr = window.nostr
    Object.defineProperty(window, 'nostr', {
      value: undefined,
      configurable: true,
      writable: true,
    })
    expect(getDirectMessageCapability()).toEqual({
      canEncrypt: false,
      preferredEncryption: null,
    })
    Object.defineProperty(window, 'nostr', {
      value: originalNostr,
      configurable: true,
      writable: true,
    })
  })
})
