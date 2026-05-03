/**
 * Blossom / Nostr HTTP authorization helpers.
 *
 * Native Blossom servers use BUD-11 kind-24242 authorization tokens.
 * The legacy NIP-98 kind-27235 path is kept for NIP-96 fallback servers.
 *
 * Private keys NEVER enter this module; signing is delegated to NDK's signer
 * (NIP-07 browser extension, NIP-46 remote signer, or another app signer).
 */

import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent } from '@nostr-dev-kit/ndk'

const HEX_32_PATTERN = /^[0-9a-f]{64}$/

export type BlossomAuthVerb = 'get' | 'upload' | 'list' | 'delete' | 'media'

export interface BlossomAuthOptions {
  /** BUD-11 action matching the target endpoint. */
  verb: BlossomAuthVerb
  /** Blossom server URL. Encoded as a lowercase domain-only `server` tag. */
  serverUrl?: string
  /** Optional blob hash scope. Required by upload/delete/media endpoints. */
  sha256?: string | string[]
  /** Token lifetime. Blossom clients commonly use a short five-minute window. */
  expiresInSeconds?: number
  /** Human-readable explanation shown by signers. */
  content?: string
}

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

function encodeBase64Url(value: string): string {
  return btoa(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function normalizeBlossomHash(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!HEX_32_PATTERN.test(normalized)) {
    throw new Error('Blossom authorization hash must be a 32-byte lowercase hex string.')
  }
  return normalized
}

function blossomServerDomain(serverUrl: string): string {
  const parsed = new URL(serverUrl)
  return parsed.hostname.toLowerCase()
}

function defaultBlossomAuthContent(verb: BlossomAuthVerb): string {
  switch (verb) {
    case 'get':
      return 'Get Blossom blob'
    case 'upload':
      return 'Upload Blossom blob'
    case 'list':
      return 'List Blossom blobs'
    case 'delete':
      return 'Delete Blossom blob'
    case 'media':
      return 'Process Blossom media'
  }
}

/**
 * Create a BUD-11 Authorization header for native Blossom endpoints.
 *
 * The resulting header is:
 *   Authorization: Nostr <base64url(JSON.stringify(kind24242Event))>
 */
export async function createBlossomAuth(
  ndk: NDK,
  options: BlossomAuthOptions,
): Promise<string> {
  if (!ndk.signer) {
    throw new Error(
      'No signing key available. Install a NIP-07 browser extension (nos2x, Alby, etc.).'
    )
  }

  const now = Math.floor(Date.now() / 1000)
  const expiresInSeconds = options.expiresInSeconds ?? 5 * 60
  const hashes = Array.isArray(options.sha256)
    ? options.sha256
    : (options.sha256 ? [options.sha256] : [])

  const tags: string[][] = [
    ['t', options.verb],
    ['expiration', String(now + expiresInSeconds)],
  ]

  if (options.serverUrl) {
    tags.push(['server', blossomServerDomain(options.serverUrl)])
  }

  for (const hash of hashes) {
    tags.push(['x', normalizeBlossomHash(hash)])
  }

  const event = new NDKEvent(ndk)
  event.kind = 24242
  event.content = options.content ?? defaultBlossomAuthContent(options.verb)
  event.created_at = now
  event.tags = tags

  await event.sign()

  return `Nostr ${encodeBase64Url(JSON.stringify(event.rawEvent()))}`
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
