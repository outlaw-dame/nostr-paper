import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import {
  getDvmEncryptionCounterparty,
  getDvmRequestKindForResultKind,
  getDvmResultKindForRequestKind,
  parseDvmJobFeedbackEvent,
  parseDvmJobRequestEvent,
  parseDvmJobResultEvent,
  parseDvmPrivateTagsPayload,
} from './dvm'
import type { NostrEvent, UnsignedEvent } from '@/types'
import { Kind } from '@/types'

function signEvent(event: UnsignedEvent): NostrEvent {
  const secretKey = generateSecretKey()
  return finalizeEvent(event, secretKey) as NostrEvent
}

describe('NIP-90 DVM helpers', () => {
  it('maps request kinds to result kinds and back', () => {
    expect(getDvmResultKindForRequestKind(5001)).toBe(6001)
    expect(getDvmRequestKindForResultKind(6001)).toBe(5001)
    expect(getDvmResultKindForRequestKind(6001)).toBeNull()
    expect(getDvmRequestKindForResultKind(7000)).toBeNull()
  })

  it('parses compliant job requests, including relays and bids', () => {
    const event = signEvent({
      kind: 5001,
      pubkey: 'a'.repeat(64),
      created_at: 1_700_000_000,
      tags: [
        ['i', 'What is the capital of France?', 'text', '', 'prompt'],
        ['output', 'text/plain'],
        ['param', 'model', 'llama-3'],
        ['relays', 'wss://relay.example.com', 'wss://relay.two.example.com'],
        ['bid', '25000'],
        ['p', 'b'.repeat(64)],
      ],
      content: '',
    })

    const parsed = parseDvmJobRequestEvent(event)

    expect(parsed).toMatchObject({
      requestKind: 5001,
      outputs: ['text/plain'],
      params: [{ name: 'model', value: 'llama-3' }],
      responseRelays: [
        'wss://relay.example.com/',
        'wss://relay.two.example.com/',
      ],
      providers: ['b'.repeat(64)],
      maxBidMsats: 25000,
      isEncrypted: false,
      hasEncryptedPayload: false,
    })
    expect(parsed?.inputs).toEqual([
      {
        value: 'What is the capital of France?',
        type: 'text',
        role: 'prompt',
      },
    ])
  })

  it('parses encrypted job requests that move i/param tags into content', () => {
    const event = signEvent({
      kind: 5002,
      pubkey: 'a'.repeat(64),
      created_at: 1_700_000_001,
      tags: [
        ['output', 'text/plain'],
        ['p', 'b'.repeat(64)],
        ['encrypted'],
      ],
      content: 'ciphertext',
    })

    const parsed = parseDvmJobRequestEvent(event)

    expect(parsed).toMatchObject({
      requestKind: 5002,
      isEncrypted: true,
      hasEncryptedPayload: true,
      providers: ['b'.repeat(64)],
    })
    expect(parsed?.inputs).toEqual([])
    expect(parsed?.params).toEqual([])
  })

  it('parses encrypted private tag payload JSON', () => {
    const parsed = parseDvmPrivateTagsPayload(JSON.stringify([
      ['i', 'Summarize this', 'text', '', 'prompt'],
      ['param', 'model', 'llama-3'],
    ]))

    expect(parsed).toEqual({
      rawTags: [
        ['i', 'Summarize this', 'text', '', 'prompt'],
        ['param', 'model', 'llama-3'],
      ],
      inputs: [
        {
          value: 'Summarize this',
          type: 'text',
          role: 'prompt',
        },
      ],
      params: [
        {
          name: 'model',
          value: 'llama-3',
        },
      ],
    })
  })

  it('parses compliant job results with embedded request JSON', () => {
    const request = signEvent({
      kind: 5005,
      pubkey: 'a'.repeat(64),
      created_at: 1_700_000_010,
      tags: [
        ['i', 'Hola mundo', 'text'],
        ['output', 'text/plain'],
      ],
      content: '',
    })

    const result = signEvent({
      kind: 6005,
      pubkey: 'b'.repeat(64),
      created_at: 1_700_000_020,
      tags: [
        ['request', JSON.stringify(request)],
        ['e', request.id],
        ['p', request.pubkey],
        ['i', 'Hola mundo', 'text'],
        ['amount', '21000', 'lnbc1invoice'],
      ],
      content: 'Hello world',
    })

    const parsed = parseDvmJobResultEvent(result)

    expect(parsed).toMatchObject({
      requestKind: 5005,
      requestEventId: request.id,
      customerPubkey: request.pubkey,
      isEncrypted: false,
      hasEncryptedPayload: false,
      content: 'Hello world',
      amount: {
        msats: 21000,
        invoice: 'lnbc1invoice',
      },
    })
    expect(parsed?.requestEvent?.id).toBe(request.id)
  })

  it('parses compliant job feedback events', () => {
    const feedback = signEvent({
      kind: Kind.DvmJobFeedback,
      pubkey: 'b'.repeat(64),
      created_at: 1_700_000_030,
      tags: [
        ['status', 'payment-required', 'Pay before full output'],
        ['e', 'c'.repeat(64)],
        ['p', 'a'.repeat(64)],
        ['amount', '42000', 'lnbc1invoice'],
      ],
      content: '',
    })

    const parsed = parseDvmJobFeedbackEvent(feedback)

    expect(parsed).toEqual({
      id: feedback.id,
      pubkey: feedback.pubkey,
      createdAt: feedback.created_at,
      requestEventId: 'c'.repeat(64),
      customerPubkey: 'a'.repeat(64),
      status: 'payment-required',
      statusMessage: 'Pay before full output',
      amount: {
        msats: 42000,
        invoice: 'lnbc1invoice',
      },
      isEncrypted: false,
      hasEncryptedPayload: false,
      content: '',
    })
  })

  it('derives the NIP-04 counterparty for encrypted requests and results', () => {
    const request = signEvent({
      kind: 5003,
      pubkey: 'a'.repeat(64),
      created_at: 1_700_000_040,
      tags: [
        ['p', 'b'.repeat(64)],
        ['encrypted'],
      ],
      content: 'ciphertext',
    })
    const result = signEvent({
      kind: 6003,
      pubkey: 'b'.repeat(64),
      created_at: 1_700_000_041,
      tags: [
        ['e', request.id],
        ['p', request.pubkey],
        ['encrypted'],
      ],
      content: 'ciphertext',
    })

    expect(getDvmEncryptionCounterparty(request, request.pubkey)).toBe('b'.repeat(64))
    expect(getDvmEncryptionCounterparty(request, 'b'.repeat(64))).toBe(request.pubkey)
    expect(getDvmEncryptionCounterparty(result, request.pubkey)).toBe(result.pubkey)
    expect(getDvmEncryptionCounterparty(result, result.pubkey)).toBe(request.pubkey)
  })
})
