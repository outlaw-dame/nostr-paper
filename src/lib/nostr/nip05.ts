import {
  getNip05VerificationCandidate,
  getProfile,
  listNip05VerificationCandidates,
  updateNip05Verification,
} from '@/lib/db/nostr'
import { getNDK } from '@/lib/nostr/ndk'
import { fetchWithRetry, withRetry } from '@/lib/retry'
import {
  isValidHex32,
  isValidRelayURL,
  normalizeNip05Identifier,
} from '@/lib/security/sanitize'
import type { NostrEvent, Profile } from '@/types'
import { Kind } from '@/types'

const NIP05_TIMEOUT_MS = 8_000
const NIP05_MAX_RESPONSE_CHARS = 256_000
const NIP05_SUCCESS_TTL_SECONDS = 12 * 60 * 60
const NIP05_RETRY_TTL_SECONDS = 60 * 60
const NIP05_SWEEP_LIMIT = 8
const NIP05_MAX_RELAY_HINTS = 12
const DEV_NIP05_PROXY_PATH = '/__dev/nip05'
const NIP05_LOOKUP_MAX_ATTEMPTS = import.meta.env.DEV ? 1 : 2

const inflightVerifications = new Map<string, Promise<Nip05VerificationStatus>>()

export interface ParsedNip05Identifier {
  identifier: string
  localPart: string
  domain: string
}

export interface ResolvedNip05Identifier {
  identifier: string
  pubkey: string
  relays: string[]
}

export type Nip05VerificationStatus =
  | 'verified'
  | 'invalid'
  | 'unavailable'
  | 'skipped'

type Nip05LookupOutcome =
  | { status: 'resolved'; record: ResolvedNip05Identifier }
  | { status: 'invalid'; reason: string }
  | { status: 'unavailable'; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createTimedAbortSignal(
  signal?: AbortSignal,
  timeoutMs = NIP05_TIMEOUT_MS,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()

  signal?.addEventListener('abort', onAbort, { once: true })

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function shouldVerifyProfile(lastCheckedAt: number | null, verified: boolean, now = nowSeconds()): boolean {
  if (lastCheckedAt === null) return true

  const ttl = verified ? NIP05_SUCCESS_TTL_SECONDS : NIP05_RETRY_TTL_SECONDS
  return now - lastCheckedAt >= ttl
}

function parseRelayHints(value: unknown, pubkey: string): string[] {
  if (!isRecord(value)) return []

  const relays = value[pubkey]
  if (!Array.isArray(relays)) return []

  return relays
    .filter((relay): relay is string => typeof relay === 'string' && isValidRelayURL(relay))
    .slice(0, NIP05_MAX_RELAY_HINTS)
}

export function parseNip05Identifier(identifier: string): ParsedNip05Identifier | null {
  const normalized = normalizeNip05Identifier(identifier)
  if (!normalized) return null

  const [localPart, domain] = normalized.split('@')
  if (!localPart || !domain) return null

  return {
    identifier: normalized,
    localPart,
    domain,
  }
}

export function formatNip05Identifier(identifier: string): string {
  const parsed = parseNip05Identifier(identifier)
  if (!parsed) return identifier.trim()
  return parsed.localPart === '_' ? parsed.domain : parsed.identifier
}

function buildLookupRequestUrl(parsed: ParsedNip05Identifier): URL {
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const url = new URL(DEV_NIP05_PROXY_PATH, window.location.origin)
    url.searchParams.set('domain', parsed.domain)
    url.searchParams.set('name', parsed.localPart)
    return url
  }

  const url = new URL(`https://${parsed.domain}/.well-known/nostr.json`)
  url.searchParams.set('name', parsed.localPart)
  return url
}

async function lookupNip05Identifier(
  parsed: ParsedNip05Identifier,
  signal?: AbortSignal,
): Promise<Nip05LookupOutcome> {
  const timed = createTimedAbortSignal(signal)

  try {
    const requestUrl = buildLookupRequestUrl(parsed)
    const isCrossOrigin = typeof window !== 'undefined' && requestUrl.origin !== window.location.origin
    const response = await fetchWithRetry(
      requestUrl,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        cache: 'no-store',
        credentials: 'omit',
        ...(isCrossOrigin ? { mode: 'cors' as const } : {}),
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: timed.signal,
      },
      {
        maxAttempts: NIP05_LOOKUP_MAX_ATTEMPTS,
        baseDelayMs: 750,
        maxDelayMs: 2_500,
        signal: timed.signal,
      },
    )

    if (response.status === 404) {
      return { status: 'invalid', reason: 'NIP-05 name not found' }
    }

    if (!response.ok) {
      return {
        status: 'unavailable',
        reason: `NIP-05 endpoint returned HTTP ${response.status}`,
      }
    }

    const bodyText = await response.text()
    if (bodyText.length > NIP05_MAX_RESPONSE_CHARS) {
      return { status: 'invalid', reason: 'NIP-05 response too large' }
    }

    let body: unknown
    try {
      body = JSON.parse(bodyText)
    } catch {
      return { status: 'invalid', reason: 'Invalid NIP-05 JSON response' }
    }

    if (!isRecord(body) || !isRecord(body.names)) {
      return { status: 'invalid', reason: 'Invalid NIP-05 names payload' }
    }

    const pubkeyValue = body.names[parsed.localPart]
    if (typeof pubkeyValue !== 'string' || !isValidHex32(pubkeyValue)) {
      return { status: 'invalid', reason: 'NIP-05 name missing or malformed' }
    }

    return {
      status: 'resolved',
      record: {
        identifier: parsed.identifier,
        pubkey: pubkeyValue,
        relays: parseRelayHints(body.relays, pubkeyValue),
      },
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      if (signal?.aborted) throw error
      return { status: 'unavailable', reason: 'NIP-05 lookup timed out' }
    }

    return {
      status: 'unavailable',
      reason: error instanceof Error ? error.message : 'NIP-05 lookup failed',
    }
  } finally {
    timed.cleanup()
  }
}

export async function resolveNip05Identifier(
  identifier: string,
  signal?: AbortSignal,
): Promise<ResolvedNip05Identifier | null> {
  const parsed = parseNip05Identifier(identifier)
  if (!parsed) return null

  const lookup = await lookupNip05Identifier(parsed, signal)
  return lookup.status === 'resolved' ? lookup.record : null
}

export async function resolveNip05Profile(
  identifier: string,
  signal?: AbortSignal,
): Promise<Profile | null> {
  const parsedIdentifier = parseNip05Identifier(identifier)
  if (!parsedIdentifier) return null

  const resolved = await resolveNip05Identifier(identifier, signal)
  if (!resolved) return null

  const cached = await getProfile(resolved.pubkey)
  if (cached) return cached

  let ndk
  try {
    ndk = getNDK()
  } catch {
    return null
  }

  await withRetry(
    async () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

      const events = await ndk.fetchEvents({
        authors: [resolved.pubkey],
        kinds: [Kind.Metadata],
        limit: 1,
      })

      const metadataEvent = [...events][0]
      if (!metadataEvent || signal?.aborted) return
    },
    {
      maxAttempts: 2,
      baseDelayMs: 1_000,
      ...(signal ? { signal } : {}),
    },
  )

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const fresh = await getProfile(resolved.pubkey)
  if (!fresh) return null
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const freshIdentifier = fresh.nip05 ? parseNip05Identifier(fresh.nip05)?.identifier : null
  if (fresh.nip05 && freshIdentifier === parsedIdentifier.identifier) {
    const checkedAt = nowSeconds()
    await updateNip05Verification(resolved.pubkey, fresh.nip05, {
      checkedAt,
      normalizedNip05: parsedIdentifier.identifier,
      verified: true,
      verifiedAt: checkedAt,
      domain: parsedIdentifier.domain,
    })
    return getProfile(resolved.pubkey)
  }

  return fresh
}

export async function verifyProfileNip05(
  pubkey: string,
  signal?: AbortSignal,
): Promise<Nip05VerificationStatus> {
  if (!isValidHex32(pubkey)) return 'skipped'

  const existing = inflightVerifications.get(pubkey)
  if (existing) return existing

  const verificationPromise = (async () => {
    const candidate = await getNip05VerificationCandidate(pubkey)
    if (!candidate?.nip05) return 'skipped'

    const checkedAt = nowSeconds()
    if (!shouldVerifyProfile(candidate.lastCheckedAt, candidate.verified, checkedAt)) {
      return 'skipped'
    }

    const parsed = parseNip05Identifier(candidate.nip05)
    if (!parsed) {
      await updateNip05Verification(pubkey, candidate.nip05, {
        checkedAt,
        verified: false,
      })
      return 'invalid'
    }

    const lookup = await lookupNip05Identifier(parsed, signal)

    if (lookup.status === 'resolved') {
      const verified = lookup.record.pubkey === pubkey
      await updateNip05Verification(pubkey, candidate.nip05, {
        checkedAt,
        normalizedNip05: lookup.record.identifier,
        verified,
        verifiedAt: verified ? checkedAt : null,
        domain: verified ? parsed.domain : null,
      })
      return verified ? 'verified' : 'invalid'
    }

    if (lookup.status === 'invalid') {
      await updateNip05Verification(pubkey, candidate.nip05, {
        checkedAt,
        normalizedNip05: parsed.identifier,
        verified: false,
      })
      return 'invalid'
    }

    await updateNip05Verification(pubkey, candidate.nip05, {
      checkedAt,
      normalizedNip05: parsed.identifier,
      verified: null,
    })
    return 'unavailable'
  })()

  inflightVerifications.set(pubkey, verificationPromise)

  try {
    return await verificationPromise
  } finally {
    inflightVerifications.delete(pubkey)
  }
}

export async function refreshNip05Verifications(signal?: AbortSignal): Promise<number> {
  const candidates = await listNip05VerificationCandidates(NIP05_SWEEP_LIMIT)
  let attempted = 0

  for (const candidate of candidates) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const status = await verifyProfileNip05(candidate.pubkey, signal)
    if (status !== 'skipped') attempted++
  }

  return attempted
}
