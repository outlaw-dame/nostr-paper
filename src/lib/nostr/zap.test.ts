import { describe, expect, it, vi, afterEach } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { Kind, type NostrEvent } from '@/types'
import {
  fetchZapInvoice,
  formatZapAmount,
  parseZapReceipt,
  sumZapMsats,
  validateZapReceipt,
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

describe('validateZapReceipt', () => {
  it('accepts receipts signed by the expected LNURL server pubkey', () => {
    const recipient = 'c'.repeat(64)
    const targetEventId = 'd'.repeat(64)
    const event = signEvent({
      kind: Kind.Zap,
      pubkey: 'a'.repeat(64),
      created_at: 1_700_000_350,
      tags: [
        ['p', recipient],
        ['e', targetEventId],
        ['description', JSON.stringify({ pubkey: 'b'.repeat(64), tags: [['amount', '21000']] })],
      ],
      content: '',
    })

    expect(validateZapReceipt(event, {
      expectedLnurlServerPubkey: event.pubkey,
      expectedRecipientPubkey: recipient,
      expectedTargetEventId: targetEventId,
    })).toMatchObject({
      valid: true,
      reason: null,
    })
  })

  it('rejects receipts signed by an unexpected LNURL server pubkey', () => {
    const event = signEvent({
      kind: Kind.Zap,
      pubkey: 'a'.repeat(64),
      created_at: 1_700_000_360,
      tags: [
        ['p', 'c'.repeat(64)],
        ['description', JSON.stringify({ tags: [['amount', '21000']] })],
      ],
      content: '',
    })

    expect(validateZapReceipt(event, {
      expectedLnurlServerPubkey: 'f'.repeat(64),
    })).toMatchObject({
      valid: false,
      reason: 'Zap receipt was not signed by the expected LNURL server pubkey.',
    })
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

    const nostrParam = parsed.searchParams.get('nostr')
    expect(nostrParam).toBeDefined()

    const zapReq = JSON.parse(nostrParam!) as { kind?: number; tags?: string[][] }
    expect(zapReq.kind).toBe(Kind.ZapRequest)
    expect(zapReq.tags).toContainEqual(['amount', '21000'])
  })

  it('rejects lightning addresses that do not support nostr zaps', async () => {
    const zapRequest = {
      rawEvent: () => ({ kind: Kind.ZapRequest, tags: [] }),
    } as unknown as Parameters<typeof fetchZapInvoice>[1]

    await expect(fetchZapInvoice({ ...payData, allowsNostr: false }, zapRequest, 21_000))
      .rejects.toThrow("doesn't support Nostr zaps")
  })

  it('throws when callback returns a non-ok HTTP status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 502,
    } as Response)

    const zapRequest = {
      rawEvent: () => ({ kind: Kind.ZapRequest, tags: [['amount', '21000']] }),
    } as unknown as Parameters<typeof fetchZapInvoice>[1]

    await expect(fetchZapInvoice(payData, zapRequest, 21_000))
      .rejects.toThrow('LNURL callback returned HTTP 502')
  })

  it('throws LNURL reason when callback reports an explicit error payload', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'ERROR', reason: 'Invoice quota exceeded' }),
    } as Response)

    const zapRequest = {
      rawEvent: () => ({ kind: Kind.ZapRequest, tags: [['amount', '21000']] }),
    } as unknown as Parameters<typeof fetchZapInvoice>[1]

    await expect(fetchZapInvoice(payData, zapRequest, 21_000))
      .rejects.toThrow('Invoice quota exceeded')
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

  it('formats sats with plain, k, and M output without aggressive rounding', () => {
    expect(formatZapAmount(999_000)).toBe('999')
    expect(formatZapAmount(21_000_000)).toBe('21k')
    expect(formatZapAmount(1_500_000)).toBe('1.5k')
    expect(formatZapAmount(999_600_000)).toBe('999.6k')
    expect(formatZapAmount(1_250_000_000)).toBe('1.2M')
  })
})
