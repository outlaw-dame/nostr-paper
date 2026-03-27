const STORAGE_KEY_PREFIX = 'nostr-paper:moderation:nsfw:v1:'

export const NSFW_TAG_SETTING_UPDATED_EVENT = 'nostr-paper:moderation-nsfw-updated'

function getStorageKey(scopeId?: string | null): string {
  const scope = scopeId && scopeId.trim().length > 0 ? scopeId.trim() : 'anon'
  return `${STORAGE_KEY_PREFIX}${scope}`
}

function emitUpdated(scopeId?: string | null): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(NSFW_TAG_SETTING_UPDATED_EVENT, {
    detail: { scopeId: scopeId ?? 'anon' },
  }))
}

export function getHideNsfwTaggedPostsEnabled(scopeId?: string | null): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(getStorageKey(scopeId))
    if (!raw) return false
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    const enabled = (parsed as { enabled?: unknown }).enabled
    return enabled === true
  } catch {
    return false
  }
}

export function setHideNsfwTaggedPostsEnabled(enabled: boolean, scopeId?: string | null): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(getStorageKey(scopeId), JSON.stringify({ enabled: Boolean(enabled) }))
    emitUpdated(scopeId)
  } catch {
    // Best-effort persistence only.
  }
}
