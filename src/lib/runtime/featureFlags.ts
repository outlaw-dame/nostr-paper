export interface RuntimeFeatureFlags {
  phase1FactCheckContext: boolean
  phase2BlindspotPanel: boolean
  phase3SourceLensBadges: boolean
  phase4MediaDietTracking: boolean
}

const DEFAULT_FLAGS: RuntimeFeatureFlags = {
  phase1FactCheckContext: true,
  phase2BlindspotPanel: true,
  phase3SourceLensBadges: true,
  phase4MediaDietTracking: true,
}

const FEATURE_FLAGS_URL = import.meta.env.VITE_FEATURE_FLAGS_URL ?? '/api/feature-flags'
const REFRESH_TTL_MS = 30_000
const REQUEST_TIMEOUT_MS = 4_000
const MAX_RETRIES = 2

let currentFlags: RuntimeFeatureFlags = { ...DEFAULT_FLAGS }
let lastSyncedAt = 0
let inflight: Promise<RuntimeFeatureFlags> | null = null
const listeners = new Set<(flags: RuntimeFeatureFlags) => void>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function backoffDelay(attempt: number): number {
  const exp = Math.min(2_000, 250 * (2 ** attempt))
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(exp / 3)))
  return Math.min(2_000, exp + jitter)
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)
}

function mergeFlags(partial: Partial<RuntimeFeatureFlags> | null | undefined): RuntimeFeatureFlags {
  return {
    phase1FactCheckContext: partial?.phase1FactCheckContext ?? DEFAULT_FLAGS.phase1FactCheckContext,
    phase2BlindspotPanel: partial?.phase2BlindspotPanel ?? DEFAULT_FLAGS.phase2BlindspotPanel,
    phase3SourceLensBadges: partial?.phase3SourceLensBadges ?? DEFAULT_FLAGS.phase3SourceLensBadges,
    phase4MediaDietTracking: partial?.phase4MediaDietTracking ?? DEFAULT_FLAGS.phase4MediaDietTracking,
  }
}

function emit(flags: RuntimeFeatureFlags): void {
  for (const listener of listeners) listener(flags)
}

function didChange(next: RuntimeFeatureFlags): boolean {
  return (
    currentFlags.phase1FactCheckContext !== next.phase1FactCheckContext ||
    currentFlags.phase2BlindspotPanel !== next.phase2BlindspotPanel ||
    currentFlags.phase3SourceLensBadges !== next.phase3SourceLensBadges ||
    currentFlags.phase4MediaDietTracking !== next.phase4MediaDietTracking
  )
}

async function fetchFlags(attempt = 0): Promise<RuntimeFeatureFlags> {
  try {
    const response = await fetch(FEATURE_FLAGS_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      if (attempt < MAX_RETRIES && isRetryableStatus(response.status)) {
        await sleep(backoffDelay(attempt))
        return fetchFlags(attempt + 1)
      }
      return currentFlags
    }

    const payload = (await response.json().catch(() => ({}))) as {
      flags?: Partial<RuntimeFeatureFlags>
    }

    return mergeFlags(payload.flags)
  } catch (error) {
    if (
      attempt < MAX_RETRIES &&
      (error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError'))
    ) {
      await sleep(backoffDelay(attempt))
      return fetchFlags(attempt + 1)
    }
    return currentFlags
  }
}

export function getRuntimeFeatureFlags(): RuntimeFeatureFlags {
  return currentFlags
}

export function subscribeRuntimeFeatureFlags(
  listener: (flags: RuntimeFeatureFlags) => void,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function refreshRuntimeFeatureFlags(force = false): Promise<RuntimeFeatureFlags> {
  if (!force && Date.now() - lastSyncedAt < REFRESH_TTL_MS) {
    return currentFlags
  }

  if (inflight) return inflight

  inflight = fetchFlags()
    .then((next) => {
      lastSyncedAt = Date.now()
      if (didChange(next)) {
        currentFlags = next
        emit(currentFlags)
      }
      return currentFlags
    })
    .finally(() => {
      inflight = null
    })

  return inflight
}
