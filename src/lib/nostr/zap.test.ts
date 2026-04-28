import { describe, expect, it, vi, afterEach } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { Kind, type NostrEvent } from '@/types'
import {
  fetchZapInvoice,
  formatZapAmount,
  parseZapReceipt,
  sumZapMsats,
  type LnurlPayData,
} from './zap'

function signEvent(event: Omit<NostrEvent, 'id' | 'sig'>): NostrEvent {
  const secretKey = generateSecretKey()
  return finalizeEvent(event, secretKey) as NostrEvent
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseZapReceipt', () => {
  it('extracts sender, amount, and comment from description tag payload', () => {
    const sender = 'b'.repeat(64)
    const recipient = 'c'.repeat(64)
    const targetEventId = 'd'.repeat(64)
    const event = signEvent({
      kind: Kind.Zap,
      pubkey: 'a'.repeat(64),
      created_at: 1_700_000_100,
      tags: [
        ['p', recipient],
        ['e', targetEventId],
        ['bolt11', 'lnbc10n1...'],
        ['description', JSON.stringify({
          pubkey: sender,
          content: '  Great post!  ',
          tags: [['amount', '21000']],
        })],
      ],
      content: '',
    })

    const parsed = parseZapReceipt(event)

    expect(parsed).toMatchObject({
      recipientPubkey: recipient,
      targetEventId,
      senderPubkey: sender,
      amountMsats: 21000,
      comment: 'Great post!',
      bolt11: 'lnbc10n1...',
    })
  })

  it('returns null when recipient pubkey tag is missing or invalid', () => {
    const event = signEvent({
      kind: Kind.Zap,
      pubkey: 'a'.repeat(64),
      created_at: 1_700_000_200,
      tags: [['p', 'not-a-pubkey']],
      content: '',
    })

    expect(parseZapReceipt(event)).toBeNull()
  })

  it('degrades gracefully when description payload is malformed JSON', () => {
    const recipient = 'c'.repeat(64)
    const event = signEvent({
      kind: Kind.Zap,
      pubkey: 'a'.repeat(64),
      created_at: 1_700_000_300,
      tags: [
        ['p', recipient],
        ['description', '{bad-json'],
      ],
      content: '',
    })

    const parsed = parseZapReceipt(event)
    expect(parsed).not.toBeNull()
    expect(parsed?.recipientPubkey).toBe(recipient)
    expect(parsed?.senderPubkey).toBeNull()
    expect(parsed?.amountMsats).toBeNull()
    expect(parsed?.comment).toBeNull()
  })
})

describe('fetchZapInvoice', () => {
  const payData: LnurlPayData = {
    callback: 'https://wallet.example.com/lnurl/callback',
    minSendable: 1000,
    maxSendable: 10_000_000,
    metadata: '[]',
    allowsNostr: true,
  }

  it('calls callback with amount and encoded zap request and returns invoice string', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ pr: 'lnbc1invoice...' }),
    } as Response)

    const zapRequest = {
      rawEvent: () => ({ kind: Kind.ZapRequest, tags: [['amount', '21000']] }),
    } as unknown as Parameters<typeof fetchZapInvoice>[1]

    const invoice = await fetchZapInvoice(payData, zapRequest, 21_000)

    expect(invoice).toBe('lnbc1invoice...')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const calledUrl = String(fetchSpy.mock.calls[0]?.[0])
    const parsed = new URL(calledUrl)
    expect(parsed.origin + parsed.pathname).toBe('https://wallet.example.com/lnurl/callback')
    expect(parsed.searchParams.get('amount')).toBe('21000')
    expect(parsed.searchParams.get('nostr')).toContain('"kind":9734')
  })

  it('rejects lightning addresses that do not support nostr zaps', async () => {
    const zapRequest = {
      rawEvent: () => ({ kind: Kind.ZapRequest, tags: [] }),
    } as unknown as Parameters<typeof fetchZapInvoice>[1]

    await expect(fetchZapInvoice({ ...payData, allowsNostr: false }, zapRequest, 21_000))
      .rejects.toThrow("doesn't support Nostr zaps")
  })
})

describe('zap amount helpers', () => {
  it('sums millisats across parsed receipts', () => {
    expect(sumZapMsats([
      {
        id: 'a'.repeat(64),
        pubkey: 'b'.repeat(64),
        createdAt: 1,
        recipientPubkey: 'c'.repeat(64),
        targetEventId: null,
        senderPubkey: null,
        amountMsats: 1000,
        comment: null,
        bolt11: null,
      },
      {
        id: 'd'.repeat(64),
        pubkey: 'e'.repeat(64),
        createdAt: 2,
        recipientPubkey: 'c'.repeat(64),
        targetEventId: null,
        senderPubkey: null,
        amountMsats: 2500,
        comment: null,
        bolt11: null,
      },
    ])).toBe(3500)
  })

  it('formats sats with plain, k, and M output', () => {
    expect(formatZapAmount(999_000)).toBe('999')
    expect(formatZapAmount(21_000_000)).toBe('21k')
    expect(formatZapAmount(1_250_000_000)).toBe('1.3M')
  })
})