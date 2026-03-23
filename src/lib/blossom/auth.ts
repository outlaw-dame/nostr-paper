/**
 * Blossom — NIP-98 HTTP Auth
 *
 * Creates and signs kind-27235 Nostr events for authenticating
 * HTTP requests to Blossom servers (BUD-01).
 *
 * Spec: https://github.com/nostr-protocol/nips/blob/master/98.md
 *
 * The signed event is base64-encoded and sent as:
 *   Authorization: Nostr <base64(JSON.stringify(signedEvent))>
 *
 * Each auth token is URL + method specific and expires after ~60 seconds,
 * so a new one must be created per request.
 *
 * Private keys NEVER enter this module — signing is delegated to NDK's
 * signer (NIP-07 browser extension or NIP-46 remote signer).
 */

import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent } from '@nostr-dev-kit/ndk'

export interface NIP98AuthOptions {
  /** Full URL of the request (including path, no trailing slash needed) */
  url:     string
  /** HTTP method being authorized */
  method:  'GET' | 'PUT' | 'DELETE' | 'HEAD' | 'POST'
  /**
   * SHA-256 hex hash of the request body.
   * Required for PUT/POST (upload) requests.
   */
  payload?: string
}

/**
 * Create a NIP-98 Authorization header value for a Blossom HTTP request.
 *
 * @throws if no signer is configured on NDK
 * @throws if signing is rejected by the user
 */
export async function createNIP98Auth(
  ndk: NDK,
  options: NIP98AuthOptions,
): Promise<string> {
  if (!ndk.signer) {
    throw new Error(
      'No signing key available. Install a NIP-07 browser extension (nos2x, Alby, etc.).'
    )
  }

  const event = new NDKEvent(ndk)
  event.kind       = 27235
  event.content    = ''
  event.created_at = Math.floor(Date.now() / 1000)
  event.tags = [
    ['u',      options.url],
    ['method', options.method],
  ]

  // Payload hash is required for uploads so servers can verify data integrity
  if (options.payload !== undefined) {
    event.tags.push(['payload', options.payload])
  }

  await event.sign()

  // Encode the full signed event as base64 for the Authorization header
  // content is always '' so btoa is safe (no non-ASCII chars)
  const encoded = btoa(JSON.stringify(event.rawEvent()))
  return `Nostr ${encoded}`
}

/**
 * Validate that a NIP-98 auth token is still fresh (within tolerance).
 * Blossom servers typically enforce a 60-second window.
 */
export function isNIP98AuthFresh(
  authHeader: string,
  toleranceSeconds = 55,
): boolean {
  try {
    const token = authHeader.replace(/^Nostr\s+/i, '')
    const event = JSON.parse(atob(token)) as { created_at?: number }
    const age   = Math.floor(Date.now() / 1000) - (event.created_at ?? 0)
    return age <= toleranceSeconds
  } catch {
    return false
  }
}
