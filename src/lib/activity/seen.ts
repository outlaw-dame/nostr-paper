const STORAGE_KEY_PREFIX = 'nostr-paper:activity-seen:v1:'

export const ACTIVITY_SEEN_UPDATED_EVENT = 'nostr-paper:activity-seen-updated'

export function getActivitySeenStorageKey(scopeId?: string | null): string {
  const scope = scopeId && scopeId.trim().length > 0 ? scopeId.trim() : 'anon'
  return `${STORAGE_KEY_PREFIX}${scope}`
}

function emitUpdated(scopeId?: string | null): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(ACTIVITY_SEEN_UPDATED_EVENT, {
    detail: { scopeId: scopeId ?? 'anon' },
  }))
}

export function getActivitySeenAt(scopeId?: string | null): number {
  if (typeof window === 'undefined') return 0

  try {
    const raw = window.localStorage.getItem(getActivitySeenStorageKey(scopeId))
    if (!raw) return 0
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 0
    const seenAt = (parsed as { seenAt?: unknown }).seenAt
    if (typeof seenAt !== 'number' || !Number.isFinite(seenAt)) return 0
    return Math.max(0, Math.floor(seenAt))
  } catch {
    return 0
  }
}

export function setActivitySeenAt(seenAt: number, scopeId?: string | null): number {
  if (typeof window === 'undefined') return 0

  const normalized = Math.max(0, Math.floor(seenAt))

  try {
    window.localStorage.setItem(getActivitySeenStorageKey(scopeId), JSON.stringify({ seenAt: normalized }))
    emitUpdated(scopeId)
  } catch {
    // Best-effort persistence only.
  }

  return normalized
}

export function markActivitySeenNow(scopeId?: string | null): number {
  return setActivitySeenAt(Math.floor(Date.now() / 1000), scopeId)
}
