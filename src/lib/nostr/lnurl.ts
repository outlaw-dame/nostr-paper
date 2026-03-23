/**
 * LNURL utilities for Nostr Zaps (NIP-57)
 *
 * Handles:
 * - Bech32 LNURL decoding (lud06)
 * - Lightning address resolution (lud16: user@domain.com)
 * - LNURL-pay metadata fetching
 */

import { isSafeURL } from '@/lib/security/sanitize'

// ── Bech32 Decoder ───────────────────────────────────────────
// Minimal bech32 decode to convert LNURL strings to plain URLs.
// LNURL uses standard bech32 (not bech32m) with hrp "lnurl".

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

function bech32DecodeBytes(encoded: string): { hrp: string; bytes: Uint8Array } {
  const lower = encoded.toLowerCase()
  const sep = lower.lastIndexOf('1')
  if (sep < 1) throw new Error('Invalid bech32 encoding: missing separator')

  const hrp = lower.slice(0, sep)
  // Strip 6-character checksum from the end
  const dataStr = lower.slice(sep + 1, -6)

  const words5: number[] = []
  for (const ch of dataStr) {
    const idx = BECH32_CHARSET.indexOf(ch)
    if (idx < 0) throw new Error(`Invalid bech32 character: ${ch}`)
    words5.push(idx)
  }

  // Convert 5-bit groups → 8-bit bytes
  const bytes: number[] = []
  let acc = 0
  let bits = 0
  for (const w of words5) {
    acc = (acc << 5) | w
    bits += 5
    while (bits >= 8) {
      bits -= 8
      bytes.push((acc >> bits) & 0xff)
    }
  }

  return { hrp, bytes: new Uint8Array(bytes) }
}

export function decodeLnurl(lnurl: string): string {
  const { hrp, bytes } = bech32DecodeBytes(lnurl.toLowerCase())
  if (hrp !== 'lnurl') throw new Error(`Expected LNURL bech32 prefix, got: ${hrp}`)
  return new TextDecoder().decode(bytes)
}

// ── LNURL-Pay Data ───────────────────────────────────────────

export interface LnurlPayData {
  /** The URL to call to get a lightning invoice */
  callback: string
  /** Minimum sendable amount in millisatoshis */
  minSendable: number
  /** Maximum sendable amount in millisatoshis */
  maxSendable: number
  /** JSON-encoded metadata array for display */
  metadata: string
  /** Whether this endpoint supports Nostr zaps (NIP-57) */
  allowsNostr: boolean
  /** The pubkey of the LNURL server (used to verify zap receipts) */
  nostrPubkey?: string
  /** Maximum length of comment allowed (0 = no comments) */
  commentAllowed?: number
}

export async function fetchLnurlPayData(url: string): Promise<LnurlPayData> {
  if (!isSafeURL(url)) throw new Error('Unsafe LNURL endpoint URL')

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`LNURL endpoint returned HTTP ${res.status}`)

  const data = await res.json() as Record<string, unknown>

  if (data['status'] === 'ERROR') {
    const reason = typeof data['reason'] === 'string' ? data['reason'] : 'LNURL server returned an error'
    throw new Error(reason)
  }

  const tag = typeof data['tag'] === 'string' ? data['tag'] : ''
  if (tag !== 'payRequest') throw new Error(`Expected LNURL payRequest tag, got: ${tag || '(none)'}`)

  const callback = typeof data['callback'] === 'string' ? data['callback'].trim() : ''
  if (!callback || !isSafeURL(callback)) throw new Error('LNURL response missing valid callback URL')

  const minSendable = typeof data['minSendable'] === 'number' ? Math.max(1, data['minSendable']) : 1000
  const maxSendable = typeof data['maxSendable'] === 'number' ? data['maxSendable'] : 10_000_000_000
  const metadata = typeof data['metadata'] === 'string' ? data['metadata'] : '[]'
  const allowsNostr = data['allowsNostr'] === true
  const nostrPubkey = typeof data['nostrPubkey'] === 'string' && data['nostrPubkey'].length === 64
    ? data['nostrPubkey']
    : undefined
  const commentAllowed = typeof data['commentAllowed'] === 'number' && data['commentAllowed'] > 0
    ? data['commentAllowed']
    : undefined

  return {
    callback,
    minSendable,
    maxSendable,
    metadata,
    allowsNostr,
    ...(nostrPubkey ? { nostrPubkey } : {}),
    ...(commentAllowed !== undefined ? { commentAllowed } : {}),
  }
}

/**
 * Resolve LNURL-pay data from either:
 * - lud16: a lightning address (user@domain.com)
 * - lud06: a bech32-encoded LNURL string
 */
export async function resolveLnurlPayData(lud16orLud06: string): Promise<LnurlPayData> {
  const trimmed = lud16orLud06.trim().toLowerCase()
  let url: string

  if (trimmed.includes('@')) {
    // Lightning address format: user@domain.com
    const atIndex = trimmed.indexOf('@')
    const user = trimmed.slice(0, atIndex)
    const domain = trimmed.slice(atIndex + 1)

    if (!user || !domain || !domain.includes('.')) {
      throw new Error('Invalid lightning address format')
    }

    url = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`
  } else if (trimmed.startsWith('lnurl')) {
    // Bech32 LNURL
    url = decodeLnurl(trimmed)
  } else {
    throw new Error('Unrecognized lightning address format (expected user@domain or lnurl1...)')
  }

  return fetchLnurlPayData(url)
}
