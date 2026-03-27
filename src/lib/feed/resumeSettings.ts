const STORAGE_KEY_PREFIX = 'nostr-paper:feed-resume:v1:'

export const FEED_RESUME_UPDATED_EVENT = 'nostr-paper:feed-resume-updated'

function getStorageKey(scopeId?: string | null): string {
  const scope = scopeId && scopeId.trim().length > 0 ? scopeId.trim() : 'anon'
  return `${STORAGE_KEY_PREFIX}${scope}`
}

function emitUpdated(scopeId?: string | null): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(FEED_RESUME_UPDATED_EVENT, {
    detail: { scopeId: scopeId ?? 'anon' },
  }))
}

export function getFeedResumeEnabled(scopeId?: string | null): boolean {
  if (typeof window === 'undefined') return true
  try {
    const raw = window.localStorage.getItem(getStorageKey(scopeId))
    if (!raw) return true
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return true
    const enabled = (parsed as { enabled?: unknown }).enabled
    return enabled === false ? false : true
  } catch {
    return true
  }
}

export function setFeedResumeEnabled(enabled: boolean, scopeId?: string | null): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(getStorageKey(scopeId), JSON.stringify({ enabled: Boolean(enabled) }))
    emitUpdated(scopeId)
  } catch {
    // Best-effort only.
  }
}
