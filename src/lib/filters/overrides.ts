const STORAGE_KEY_PREFIX = 'nostr-paper-filter-overrides-v2:'
const LEGACY_STORAGE_KEY = 'nostr-paper-filter-overrides-v1'
const MAX_OVERRIDES = 500

function getStorageKey(scopeId?: string | null): string {
  const scope = scopeId && scopeId.trim().length > 0 ? scopeId.trim() : 'anon'
  return `${STORAGE_KEY_PREFIX}${scope}`
}

function sanitizeOverrideEntries(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry): entry is string => typeof entry === 'string' && /^[a-f0-9]{64}$/i.test(entry),
  )
}

function migrateLegacyOverrides(scopeId?: string | null): Set<string> {
  if (typeof window === 'undefined') return new Set<string>()

  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return new Set<string>()
    const parsed = JSON.parse(raw) as unknown
    const sanitized = sanitizeOverrideEntries(parsed)
    const migrated = new Set(sanitized)
    window.localStorage.setItem(getStorageKey(scopeId), JSON.stringify([...migrated]))
    window.localStorage.removeItem(LEGACY_STORAGE_KEY)
    return migrated
  } catch {
    return new Set<string>()
  }
}

function readOverrides(scopeId?: string | null): Set<string> {
  if (typeof window === 'undefined') return new Set<string>()

  try {
    const raw = window.localStorage.getItem(getStorageKey(scopeId))
    if (!raw) {
      return migrateLegacyOverrides(scopeId)
    }
    const parsed = JSON.parse(raw) as unknown
    return new Set(sanitizeOverrideEntries(parsed))
  } catch {
    return new Set<string>()
  }
}

function writeOverrides(values: Set<string>, scopeId?: string | null): void {
  if (typeof window === 'undefined') return

  try {
    const entries = Array.from(values)
    const trimmed = entries.length > MAX_OVERRIDES
      ? entries.slice(entries.length - MAX_OVERRIDES)
      : entries
    window.localStorage.setItem(getStorageKey(scopeId), JSON.stringify(trimmed))
  } catch {
    // Best-effort persistence; ignore storage failures.
  }
}

export function hasFilterOverride(eventId: string, scopeId?: string | null): boolean {
  if (!eventId) return false
  return readOverrides(scopeId).has(eventId)
}

export function setFilterOverride(eventId: string, scopeId?: string | null): void {
  if (!eventId) return
  const overrides = readOverrides(scopeId)
  overrides.add(eventId)
  writeOverrides(overrides, scopeId)
}

export function clearFilterOverride(eventId: string, scopeId?: string | null): void {
  if (!eventId) return
  const overrides = readOverrides(scopeId)
  if (!overrides.delete(eventId)) return
  writeOverrides(overrides, scopeId)
}
