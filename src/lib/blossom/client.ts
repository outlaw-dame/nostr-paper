/**
 * Blossom HTTP Client
 *
 * Implements BUD-01/02/04/05/06/12 client operations.
 *
 * BUD-01:
 *   GET /<sha256>        — retrieve a blob
 *   HEAD /<sha256>       — check blob existence
 * BUD-02:
 *   PUT /upload          — upload a blob (auth usually required)
 * BUD-04:
 *   PUT /mirror          — mirror a blob from a URL (auth required)
 * BUD-05:
 *   PUT /media           — trusted media processing endpoint
 * BUD-06:
 *   HEAD /upload|/media  — upload requirement preflight
 * BUD-12:
 *   GET /list/<pubkey>   — list blobs for a pubkey
 *   DELETE /<sha256>     — delete a blob (auth required)
 *
 * Native Blossom mutating operations use BUD-11 Authorization headers.
 * NIP-98 remains supported elsewhere for NIP-96 fallback servers.
 */

import { fetchWithRetry } from '@/lib/retry'
import { normalizeNip94FromObject } from '@/lib/nostr/fileMetadata'
import { isSafeURL, isValidHex32 } from '@/lib/security/sanitize'
import type { BlossomBlob } from '@/types'

// ── Error Type ───────────────────────────────────────────────

export class BlossomError extends Error {
  constructor(
    message:         string,
    public readonly httpStatus: number,
    public readonly serverUrl:  string,
  ) {
    super(message)
    this.name = 'BlossomError'
  }
}

// ── Helpers ──────────────────────────────────────────────────

/** Normalize server URL — strips trailing slash */
function base(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeUploadedAt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return undefined
  return value
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function normalizeBlobDescriptor(payload: unknown): BlossomBlob {
  if (!isRecord(payload)) {
    throw new Error('Invalid Blossom blob descriptor')
  }

  const url = typeof payload.url === 'string' && isSafeURL(payload.url)
    ? payload.url
    : null
  const sha256 = typeof payload.sha256 === 'string' && isValidHex32(payload.sha256)
    ? payload.sha256
    : null
  const size = typeof payload.size === 'number' && Number.isSafeInteger(payload.size) && payload.size >= 0
    ? payload.size
    : null
  const type = typeof payload.type === 'string' && payload.type.trim().length > 0
    ? payload.type.trim().toLowerCase()
    : 'application/octet-stream'

  if (!url || !sha256 || size === null) {
    throw new Error('Incomplete Blossom blob descriptor')
  }

  const nip94 = normalizeNip94FromObject(payload.nip94, {
    url,
    mimeType: type,
    fileHash: sha256,
  })
  const uploaded = normalizeUploadedAt(payload.uploaded)
  const ipfsCid = normalizeOptionalString(payload.ipfs ?? payload.cid)
  const ipfsUrl = typeof payload.ipfs_url === 'string' && isSafeURL(payload.ipfs_url)
    ? payload.ipfs_url
    : undefined

  return {
    url,
    sha256,
    size,
    type,
    ...(uploaded !== undefined ? { uploaded } : {}),
    ...(nip94 ? { nip94 } : {}),
    ...(ipfsCid ? { ipfsCid } : {}),
    ...(ipfsUrl ? { ipfsUrl } : {}),
  }
}

/** Parse server error response into a human-readable string */
async function parseError(res: Response): Promise<string> {
  const reason = res.headers.get('X-Reason')
  if (reason?.trim()) return reason.trim()

  const ct = res.headers.get('Content-Type') ?? ''
  if (ct.includes('application/json')) {
    try {
      const json = await res.json() as { message?: string }
      if (json.message) return json.message
    } catch { /* fall through */ }
  }
  const text = await res.text().catch(() => '')
  return text.trim() || res.statusText
}

function extensionForMimeType(mimeType: string | undefined): string {
  const normalized = mimeType?.split(';', 1)[0]?.trim().toLowerCase()
  switch (normalized) {
    case 'image/jpeg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/gif':
      return '.gif'
    case 'image/webp':
      return '.webp'
    case 'image/avif':
      return '.avif'
    case 'video/mp4':
      return '.mp4'
    case 'video/webm':
      return '.webm'
    case 'video/quicktime':
      return '.mov'
    case 'audio/mpeg':
      return '.mp3'
    case 'audio/mp4':
      return '.m4a'
    case 'audio/ogg':
      return '.ogg'
    case 'audio/flac':
      return '.flac'
    case 'audio/wav':
      return '.wav'
    case 'application/pdf':
      return '.pdf'
    default:
      return ''
  }
}

// ── BUD-01/02/05/06: Core Blob Operations ────────────────────

export interface BlossomUploadRequirements {
  sha256: string
  size: number
  type: string
}

export interface BlossomUploadRequirementResult {
  supported: boolean
  ok: boolean
  httpStatus: number
  reason?: string
}

/**
 * Check upload/media requirements before sending a large request body.
 *
 * BUD-06 and BUD-05 HEAD are optional. A 404 or 405 means "no preflight
 * support"; callers can still proceed to PUT.
 */
export async function blossomUploadRequirements(
  serverUrl: string,
  metadata: BlossomUploadRequirements,
  authHeader?: string,
  endpoint: 'upload' | 'media' = 'upload',
): Promise<BlossomUploadRequirementResult> {
  const url = `${base(serverUrl)}/${endpoint}`
  const headers: Record<string, string> = {
    'X-SHA-256': metadata.sha256,
    'X-Content-Type': metadata.type || 'application/octet-stream',
    'X-Content-Length': String(metadata.size),
  }
  if (authHeader) headers.Authorization = authHeader

  const res = await fetch(url, {
    method: 'HEAD',
    headers,
  })

  if (res.status === 404 || res.status === 405) {
    return { supported: false, ok: true, httpStatus: res.status }
  }

  if (!res.ok) {
    const reason = await parseError(res)
    return {
      supported: true,
      ok: false,
      httpStatus: res.status,
      ...(reason ? { reason } : {}),
    }
  }

  return { supported: true, ok: true, httpStatus: res.status }
}

/**
 * Upload a blob to a Blossom server (BUD-02 PUT /upload).
 *
 * Returns the server's blob descriptor on success.
 * Throws BlossomError on HTTP errors.
 */
export async function blossomUpload(
  serverUrl: string,
  file:       File | Blob,
  sha256:     string,
  authHeader: string,
): Promise<BlossomBlob> {
  const url = `${base(serverUrl)}/upload`
  const res = await fetch(url, {
    method:  'PUT',
    headers: {
      'Authorization':  authHeader,
      'Content-Type':   file.type || 'application/octet-stream',
      'X-SHA-256':      sha256,
    },
    body: file,
  })

  if (!res.ok) {
    const msg = await parseError(res)
    throw new BlossomError(
      `Upload to ${serverUrl} failed (${res.status}): ${msg}`,
      res.status,
      serverUrl,
    )
  }

  return normalizeBlobDescriptor(await res.json())
}

/**
 * Send a blob to a trusted Blossom media endpoint (BUD-05 PUT /media).
 *
 * Some servers will optimize or transcode the blob before returning the final
 * descriptor. Servers that simply store the blob unchanged are still normalized
 * through the same descriptor path.
 */
export async function blossomMediaUpload(
  serverUrl: string,
  file: File | Blob,
  sha256: string,
  authHeader: string,
): Promise<BlossomBlob> {
  const url = `${base(serverUrl)}/media`
  const res = await fetch(url, {
    method:  'PUT',
    headers: {
      'Authorization': authHeader,
      'Content-Type':  file.type || 'application/octet-stream',
      'X-SHA-256':     sha256,
    },
    body: file,
  })

  if (!res.ok) {
    const msg = await parseError(res)
    throw new BlossomError(
      `Media upload to ${serverUrl} failed (${res.status}): ${msg}`,
      res.status,
      serverUrl,
    )
  }

  return normalizeBlobDescriptor(await res.json())
}

/**
 * Check whether a blob exists on a server without downloading it (BUD-01 HEAD).
 *
 * Returns true if the blob is present, false if 404.
 * Throws BlossomError on unexpected server errors.
 */
export async function blossomHas(
  serverUrl: string,
  sha256:    string,
): Promise<boolean> {
  const url = `${base(serverUrl)}/${sha256}`
  const res = await fetch(url, { method: 'HEAD' })
  if (res.status === 404) return false
  if (!res.ok) {
    throw new BlossomError(
      `HEAD ${serverUrl}/${sha256} failed (${res.status})`,
      res.status,
      serverUrl,
    )
  }
  return true
}

/**
 * Return the canonical direct URL for a blob on a given server (BUD-01 GET).
 * Does not perform a network request — use blossomHas() to verify existence.
 */
export function blossomBlobUrl(serverUrl: string, sha256: string, mimeType?: string): string {
  return `${base(serverUrl)}/${sha256}${extensionForMimeType(mimeType)}`
}

/**
 * Delete a blob from a server (BUD-12 DELETE).
 *
 * 404 is treated as success (already gone).
 * Throws BlossomError on other HTTP errors.
 */
export async function blossomDelete(
  serverUrl:  string,
  sha256:     string,
  authHeader: string,
): Promise<void> {
  const url = `${base(serverUrl)}/${sha256}`
  const res = await fetch(url, {
    method:  'DELETE',
    headers: { 'Authorization': authHeader },
  })
  if (!res.ok && res.status !== 404) {
    const msg = await parseError(res)
    throw new BlossomError(
      `Delete from ${serverUrl} failed (${res.status}): ${msg}`,
      res.status,
      serverUrl,
    )
  }
}

// ── BUD-12: Blob List ────────────────────────────────────────

export interface BlossomListOptions {
  cursor?: string
  limit?: number
  since?: number
  until?: number
  authHeader?: string
}

/**
 * List all blobs uploaded by a pubkey on a given server (BUD-12).
 *
 * Returns an array of blob descriptors sorted by upload time (newest first).
 * Retries once on transient 5xx errors.
 */
export async function blossomList(
  serverUrl: string,
  pubkey:    string,
  opts?:     BlossomListOptions,
): Promise<BlossomBlob[]> {
  const url = new URL(`${base(serverUrl)}/list/${pubkey}`)
  if (opts?.cursor !== undefined) url.searchParams.set('cursor', opts.cursor)
  if (opts?.limit !== undefined) url.searchParams.set('limit', String(opts.limit))
  if (opts?.since !== undefined) url.searchParams.set('since', String(opts.since))
  if (opts?.until !== undefined) url.searchParams.set('until', String(opts.until))

  const init: RequestInit = opts?.authHeader
    ? { headers: { Authorization: opts.authHeader } }
    : {}
  const res = await fetchWithRetry(url.toString(), init, { maxAttempts: 2, baseDelayMs: 500 })
  if (!res.ok) {
    const msg = await parseError(res)
    throw new BlossomError(
      `List blobs from ${serverUrl} failed (${res.status}): ${msg}`,
      res.status,
      serverUrl,
    )
  }

  const payload = await res.json()
  if (!Array.isArray(payload)) {
    throw new BlossomError(
      `List blobs from ${serverUrl} returned an invalid payload`,
      res.status,
      serverUrl,
    )
  }

  return payload.map(normalizeBlobDescriptor)
}

// ── BUD-04: Mirroring ────────────────────────────────────────

/**
 * Ask a Blossom server to mirror a blob from a source URL (BUD-04).
 *
 * The server fetches the blob itself and returns a descriptor.
 * Useful for replicating blobs across servers without re-uploading locally.
 */
export async function blossomMirror(
  serverUrl:  string,
  sourceUrl:  string,
  authHeader: string,
): Promise<BlossomBlob> {
  const url = `${base(serverUrl)}/mirror`
  const res = await fetch(url, {
    method:  'PUT',
    headers: {
      'Authorization': authHeader,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ url: sourceUrl }),
  })

  if (!res.ok) {
    const msg = await parseError(res)
    throw new BlossomError(
      `Mirror to ${serverUrl} from ${sourceUrl} failed (${res.status}): ${msg}`,
      res.status,
      serverUrl,
    )
  }

  return normalizeBlobDescriptor(await res.json())
}

// ── Server Health Check ──────────────────────────────────────

/**
 * Probe a Blossom server for basic BUD-01 compliance.
 *
 * Sends a HEAD to /upload — conformant servers return 401 (auth required)
 * or 405 (method not allowed), not 404 or connection refused.
 *
 * Returns true if the server appears to be a Blossom server.
 */
export async function blossomProbe(serverUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${base(serverUrl)}/upload`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(8_000),
    })
    // 400/401/411/413 can all be normal BUD-06 policy responses when probing
    // without metadata. 404 means the root /upload endpoint is not present.
    return res.status !== 404 && res.status < 500
  } catch {
    return false
  }
}
