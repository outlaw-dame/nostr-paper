import { normalizeNip94Tags } from '@/lib/nostr/fileMetadata'
import { fetchWithRetry } from '@/lib/retry'
import { isSafeURL, isValidHex32 } from '@/lib/security/sanitize'
import type { BlossomBlob, Nip94Tags } from '@/types'

interface Nip96WellKnown {
  api_url: string
  download_url?: string
  delegated_to_url?: string
}

interface Nip96UploadResponse {
  status?: string
  message?: string
  processing_url?: string
  nip94_event?: {
    tags?: unknown
    content?: string
    created_at?: number
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

function isHttpsSafeUrl(url: string): boolean {
  if (!isSafeURL(url)) return false
  try {
    return new URL(url.trim()).protocol === 'https:'
  } catch {
    return false
  }
}

function parseNip94Tags(rawTags: unknown): Record<string, string[]> {
  const tags: Record<string, string[]> = {}
  if (!Array.isArray(rawTags)) return tags

  for (const rawTag of rawTags) {
    if (!Array.isArray(rawTag) || rawTag.length < 2) continue
    const key = typeof rawTag[0] === 'string' ? rawTag[0] : null
    const value = typeof rawTag[1] === 'string' ? rawTag[1] : null
    if (!key || !value) continue
    if (!tags[key]) tags[key] = []
    tags[key].push(value)
  }

  return tags
}

function firstTag(tags: Record<string, string[]>, key: string): string | undefined {
  return tags[key]?.[0]
}

export interface Nip96ServerDescriptor {
  serverUrl: string
  apiUrl: string
  downloadUrl?: string
  delegatedToUrl?: string
}

export async function discoverNip96Server(
  serverUrl: string,
  maxRedirects = 3,
): Promise<Nip96ServerDescriptor | null> {
  const normalizedStart = normalizeBaseUrl(serverUrl.trim())
  if (!isHttpsSafeUrl(normalizedStart)) return null

  let current = normalizedStart
  let delegatedToUrl: string | undefined
  const visited = new Set<string>()

  for (let attempt = 0; attempt <= maxRedirects; attempt++) {
    if (visited.has(current)) return null
    visited.add(current)

    const res = await fetchWithRetry(
      `${current}/.well-known/nostr/nip96.json`,
      {
        method: 'GET',
        signal: AbortSignal.timeout(8_000),
      },
      {
        maxAttempts: 2,
        baseDelayMs: 400,
        maxDelayMs: 2_000,
      },
    ).catch(() => null)

    if (!res?.ok) return null

    const payload = asRecord(await res.json().catch(() => null))
    if (!payload) return null

    const descriptor = payload as unknown as Nip96WellKnown
    const delegated = typeof descriptor.delegated_to_url === 'string'
      ? descriptor.delegated_to_url.trim()
      : ''

    if (delegated.length > 0) {
      if (!isHttpsSafeUrl(delegated)) return null
      current = normalizeBaseUrl(delegated)
      delegatedToUrl = current
      continue
    }

    const apiUrl = typeof descriptor.api_url === 'string' ? descriptor.api_url.trim() : ''
    if (!isHttpsSafeUrl(apiUrl)) return null

    const downloadUrl = typeof descriptor.download_url === 'string' && isHttpsSafeUrl(descriptor.download_url)
      ? descriptor.download_url.trim()
      : undefined

    return {
      serverUrl: current,
      apiUrl,
      ...(downloadUrl ? { downloadUrl } : {}),
      ...(delegatedToUrl ? { delegatedToUrl } : {}),
    }
  }

  return null
}

function toNip94FromUploadResponse(
  response: Nip96UploadResponse,
  fallback: { fileHash: string; mimeType: string; size: number },
): Nip94Tags | null {
  const event = asRecord(response.nip94_event)
  if (!event) return null

  const tags = parseNip94Tags(event.tags)
  const url = firstTag(tags, 'url')
  const originalHash = firstTag(tags, 'ox')
  const transformedHash = firstTag(tags, 'x')
  const mimeType = firstTag(tags, 'm') ?? fallback.mimeType

  if (!url || !isSafeURL(url)) return null
  if (!originalHash || !isValidHex32(originalHash)) return null

  const canonicalHash = transformedHash && isValidHex32(transformedHash)
    ? transformedHash
    : originalHash

  const sizeRaw = firstTag(tags, 'size')
  const size = sizeRaw && /^\d+$/.test(sizeRaw) ? Number(sizeRaw) : fallback.size

  return normalizeNip94Tags({
    url,
    mimeType,
    fileHash: canonicalHash,
    originalHash,
    size,
    ...(firstTag(tags, 'dim') ? { dim: firstTag(tags, 'dim') } : {}),
    ...(firstTag(tags, 'magnet') ? { magnet: firstTag(tags, 'magnet') } : {}),
    ...(firstTag(tags, 'i') ? { torrentInfoHash: firstTag(tags, 'i') } : {}),
    ...(firstTag(tags, 'blurhash') ? { blurhash: firstTag(tags, 'blurhash') } : {}),
    ...(firstTag(tags, 'thumb') ? { thumb: firstTag(tags, 'thumb') } : {}),
    ...(firstTag(tags, 'image') ? { image: firstTag(tags, 'image') } : {}),
    ...(firstTag(tags, 'summary') ? { summary: firstTag(tags, 'summary') } : {}),
    ...(firstTag(tags, 'alt') ? { alt: firstTag(tags, 'alt') } : {}),
    ...(tags.fallback ? { fallbacks: tags.fallback } : {}),
    service: 'nip96',
  })
}

export async function nip96Upload(
  descriptor: Nip96ServerDescriptor,
  file: File,
  authHeader: string,
  fileHash: string,
  options?: {
    caption?: string
    alt?: string
    noTransform?: boolean
    expiration?: number
  },
): Promise<BlossomBlob> {
  if (!isHttpsSafeUrl(descriptor.apiUrl)) {
    throw new Error('NIP-96 upload endpoint must be HTTPS.')
  }

  const form = new FormData()
  form.append('file', file)
  form.append('size', String(file.size))
  form.append('content_type', file.type || 'application/octet-stream')
  if (options?.caption) form.append('caption', options.caption)
  if (options?.alt) form.append('alt', options.alt)
  if (options?.noTransform) form.append('no_transform', 'true')
  if (options?.expiration !== undefined) form.append('expiration', String(options.expiration))

  const res = await fetchWithRetry(
    descriptor.apiUrl,
    {
      method: 'POST',
      headers: {
        Authorization: authHeader,
      },
      body: form,
    },
    {
      maxAttempts: 2,
      baseDelayMs: 500,
      maxDelayMs: 3_000,
    },
  )

  if (!res.ok) {
    const message = await res.text().catch(() => '')
    throw new Error(`NIP-96 upload failed (${res.status})${message ? `: ${message}` : ''}`)
  }

  const payload = (await res.json().catch(() => ({}))) as Nip96UploadResponse
  const metadata = toNip94FromUploadResponse(payload, {
    fileHash,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
  })

  if (!metadata) {
    throw new Error('NIP-96 upload succeeded but response lacked a valid nip94_event.')
  }

  // NIP-96 identifies files by original hash (ox), not transformed hash (x).
  const canonicalSha = metadata.originalHash ?? metadata.fileHash

  return {
    url: metadata.url,
    sha256: canonicalSha,
    size: metadata.size ?? file.size,
    type: metadata.mimeType,
    nip94: metadata,
  }
}
