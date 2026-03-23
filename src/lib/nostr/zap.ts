/**
 * Nostr Zap implementation — NIP-57
 *
 * Kind 9734: Zap Request  — signed by the sender, sent to the LNURL callback
 * Kind 9735: Zap Receipt  — signed by the LNURL server, broadcast to Nostr relays
 *
 * Flow:
 * 1. Resolve recipient's LNURL-pay endpoint (from lud16 or lud06)
 * 2. Verify endpoint supports Nostr zaps (allowsNostr: true)
 * 3. Build + sign a kind-9734 Zap Request event
 * 4. POST to LNURL callback → receive bolt11 invoice
 * 5. User pays invoice via their wallet (lightning: URI or manual copy)
 * 6. LNURL server broadcasts a kind-9735 Zap Receipt to Nostr relays
 */

import { NDKEvent } from '@nostr-dev-kit/ndk'
import { getNDK } from '@/lib/nostr/ndk'
import { fetchLnurlPayData, type LnurlPayData } from '@/lib/nostr/lnurl'
import { isSafeURL, isValidHex32, sanitizeText } from '@/lib/security/sanitize'
import { Kind } from '@/types'
import type { NostrEvent, ParsedZapReceipt } from '@/types'

const MAX_COMMENT_CHARS = 2048
const MAX_RELAYS_IN_TAG = 10

export interface ZapRequestOptions {
  /** Recipient's pubkey */
  recipientPubkey: string
  /** Amount in millisatoshis */
  amountMsats: number
  /** Optional message visible on the zap */
  comment?: string
  /** The specific event being zapped (null for profile zaps) */
  targetEvent?: NostrEvent | null
  /** Relay URLs to include — LNURL server will broadcast the receipt here */
  relays: string[]
  /** The original LNURL string for wallet interop */
  lnurl?: string
}

// ── Zap Request (Kind 9734) ───────────────────────────────────

/**
 * Build and sign a kind-9734 Zap Request event.
 * This event is sent to the LNURL server, not broadcast to Nostr.
 */
export async function buildZapRequest(
  options: ZapRequestOptions,
  signal?: AbortSignal,
): Promise<NDKEvent> {
  const ndk = getNDK()
  if (!ndk.signer) {
    throw new Error('No signer available — install a NIP-07 extension to send zaps.')
  }

  if (!isValidHex32(options.recipientPubkey)) {
    throw new Error('Invalid recipient pubkey.')
  }
  if (!Number.isInteger(options.amountMsats) || options.amountMsats <= 0) {
    throw new Error('Zap amount must be a positive integer (millisats).')
  }

  const comment = options.comment
    ? sanitizeText(options.comment).slice(0, MAX_COMMENT_CHARS).trim()
    : ''

  const event = new NDKEvent(ndk)
  event.kind = Kind.ZapRequest
  event.content = comment

  // Required NIP-57 tags
  const relays = options.relays.slice(0, MAX_RELAYS_IN_TAG).filter(r => r.startsWith('wss://'))
  event.tags = [
    ['relays', ...relays],
    ['amount', String(options.amountMsats)],
    ['p', options.recipientPubkey],
  ]

  // Zapping a specific note
  if (options.targetEvent && isValidHex32(options.targetEvent.id)) {
    event.tags.push(['e', options.targetEvent.id])
  }

  // lnurl tag for wallet interoperability
  if (options.lnurl && isSafeURL(options.lnurl)) {
    event.tags.push(['lnurl', options.lnurl])
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  await event.sign()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  return event
}

// ── Invoice Fetching ─────────────────────────────────────────

/**
 * Call the LNURL callback to get a bolt11 invoice.
 * The zap request is URL-encoded and passed as the `nostr` parameter.
 */
export async function fetchZapInvoice(
  payData: LnurlPayData,
  zapRequest: NDKEvent,
  amountMsats: number,
): Promise<string> {
  if (!payData.allowsNostr) {
    throw new Error("This lightning address doesn't support Nostr zaps.")
  }

  const zapRequestJson = JSON.stringify(zapRequest.rawEvent())

  const callbackUrl = new URL(payData.callback)
  callbackUrl.searchParams.set('amount', String(amountMsats))
  callbackUrl.searchParams.set('nostr', zapRequestJson)

  const res = await fetch(callbackUrl.toString(), {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`LNURL callback returned HTTP ${res.status}`)

  const data = await res.json() as Record<string, unknown>

  if (data['status'] === 'ERROR') {
    const reason = typeof data['reason'] === 'string' ? data['reason'] : 'LNURL callback returned an error'
    throw new Error(reason)
  }

  const pr = typeof data['pr'] === 'string' ? data['pr'].trim() : ''
  if (!pr) throw new Error('LNURL callback did not return a payment request.')

  return pr
}

// ── Zap Receipt Parsing (Kind 9735) ──────────────────────────

/**
 * Parse a kind-9735 Zap Receipt event.
 * The amount is extracted from the embedded kind-9734 Zap Request
 * in the `description` tag (more reliable than bolt11 decoding).
 */
export function parseZapReceipt(event: NostrEvent): ParsedZapReceipt | null {
  if (event.kind !== Kind.Zap) return null

  const recipientPubkey = event.tags.find(t => t[0] === 'p')?.[1] ?? null
  if (!recipientPubkey || !isValidHex32(recipientPubkey)) return null

  const rawEventId = event.tags.find(t => t[0] === 'e')?.[1] ?? null
  const targetEventId = rawEventId && isValidHex32(rawEventId) ? rawEventId : null
  const bolt11 = event.tags.find(t => t[0] === 'bolt11')?.[1] ?? null

  let senderPubkey: string | null = null
  let amountMsats: number | null = null
  let comment: string | null = null

  // Extract sender info and amount from the embedded zap request
  const descriptionJson = event.tags.find(t => t[0] === 'description')?.[1] ?? null
  if (descriptionJson) {
    try {
      const zapReq = JSON.parse(descriptionJson) as Record<string, unknown>
      const reqTags = Array.isArray(zapReq['tags']) ? (zapReq['tags'] as unknown[]) : []

      const senderPub = typeof zapReq['pubkey'] === 'string' ? zapReq['pubkey'] : null
      if (senderPub && isValidHex32(senderPub)) senderPubkey = senderPub

      const amountTag = reqTags.find(
        (t): t is string[] => Array.isArray(t) && t[0] === 'amount',
      )
      if (amountTag?.[1]) {
        const parsed = parseInt(amountTag[1], 10)
        if (!isNaN(parsed) && parsed > 0) amountMsats = parsed
      }

      const rawContent = typeof zapReq['content'] === 'string' ? zapReq['content'].trim() : ''
      if (rawContent) {
        const sanitized = sanitizeText(rawContent).slice(0, MAX_COMMENT_CHARS).trim()
        if (sanitized) comment = sanitized
      }
    } catch {
      // Malformed description tag — degrade gracefully
    }
  }

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    recipientPubkey,
    targetEventId,
    senderPubkey,
    amountMsats,
    comment,
    bolt11,
  }
}

// ── Zap Aggregation ──────────────────────────────────────────

export function sumZapMsats(receipts: ParsedZapReceipt[]): number {
  return receipts.reduce((sum, r) => sum + (r.amountMsats ?? 0), 0)
}

export function formatZapAmount(msats: number): string {
  const sats = Math.floor(msats / 1000)
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(1)}M`
  if (sats >= 1_000) return `${(sats / 1_000).toFixed(0)}k`
  return String(sats)
}

// ── LNURL-pay data (re-export for convenience) ───────────────
export { resolveLnurlPayData, fetchLnurlPayData } from '@/lib/nostr/lnurl'
export type { LnurlPayData } from '@/lib/nostr/lnurl'
