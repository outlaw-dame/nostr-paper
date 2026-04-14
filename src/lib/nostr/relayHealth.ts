import type { RelayInfo } from '@/types'

export type RelayHealthTier = 'good' | 'caution' | 'restricted' | 'unknown'

export interface RelayHealthSnapshot {
  tier: RelayHealthTier
  label: string
  details: string
}

export interface RelayHealthResult {
  snapshot: RelayHealthSnapshot
  checkedAt: number
}

const HEALTH_TTL_MS = 15 * 60 * 1000
const FETCH_TIMEOUT_MS = 3_500

const cache = new Map<string, { at: number; snapshot: RelayHealthSnapshot }>()

function toHttpRelayInfoUrl(relayUrl: string): string | null {
  try {
    const parsed = new URL(relayUrl)
    if (parsed.protocol === 'wss:') parsed.protocol = 'https:'
    else if (parsed.protocol === 'ws:') parsed.protocol = 'http:'
    else return null
    return parsed.toString()
  } catch {
    return null
  }
}

function withTimeoutSignal(signal?: AbortSignal): AbortSignal {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  if (signal) {
    if (signal.aborted) controller.abort()
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  controller.signal.addEventListener('abort', () => {
    globalThis.clearTimeout(timeout)
  }, { once: true })

  return controller.signal
}

async function fetchRelayInfo(relayUrl: string, signal?: AbortSignal): Promise<RelayInfo | null> {
  const infoUrl = toHttpRelayInfoUrl(relayUrl)
  if (!infoUrl) return null

  try {
    const response = await fetch(infoUrl, {
      headers: {
        Accept: 'application/nostr+json',
      },
      signal: withTimeoutSignal(signal),
    })

    if (!response.ok) return null
    const data = await response.json()
    return typeof data === 'object' && data !== null ? data as RelayInfo : null
  } catch {
    return null
  }
}

export function scoreRelayInfo(info: RelayInfo | null): RelayHealthSnapshot {
  if (!info) {
    return {
      tier: 'unknown',
      label: 'Health unknown',
      details: 'No NIP-11 document available.',
    }
  }

  const limitation = info.limitation
  if (limitation?.payment_required || limitation?.auth_required || limitation?.restricted_writes) {
    return {
      tier: 'restricted',
      label: 'Restricted',
      details: 'Relay requires auth/payment or has restricted writes.',
    }
  }

  const supportsCoreNips = info.supported_nips?.includes(1) && info.supported_nips?.includes(11)
  if (!supportsCoreNips) {
    return {
      tier: 'caution',
      label: 'Limited',
      details: 'Relay does not advertise core NIP support in NIP-11.',
    }
  }

  if (typeof limitation?.max_limit === 'number' && limitation.max_limit < 500) {
    return {
      tier: 'caution',
      label: 'Low limits',
      details: 'Relay max_limit is low and may clamp large requests.',
    }
  }

  return {
    tier: 'good',
    label: 'Healthy',
    details: 'NIP-11 metadata indicates open writes and core capability support.',
  }
}

export async function getRelayHealthSnapshot(
  relayUrl: string,
  options: {
    signal?: AbortSignal
    forceRefresh?: boolean
  } = {},
): Promise<RelayHealthResult> {
  const existing = cache.get(relayUrl)
  if (!options.forceRefresh && existing && Date.now() - existing.at < HEALTH_TTL_MS) {
    return {
      snapshot: existing.snapshot,
      checkedAt: existing.at,
    }
  }

  const info = await fetchRelayInfo(relayUrl, options.signal)
  const snapshot = scoreRelayInfo(info)
  const checkedAt = Date.now()
  cache.set(relayUrl, { at: checkedAt, snapshot })
  return {
    snapshot,
    checkedAt,
  }
}
