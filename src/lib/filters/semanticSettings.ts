/**
 * Semantic Filter Settings & Preferences
 *
 * User preferences for how semantic filtering behaves globally.
 */

const STORAGE_KEY_PREFIX = 'nostr-paper-semantic-filter-settings:v2:'
const LEGACY_STORAGE_KEY = 'nostr-paper-semantic-filter-settings'

export const SEMANTIC_FILTER_SETTINGS_UPDATED_EVENT = 'nostr-paper:semantic-filter-settings-updated'

export interface SemanticFilterSettings {
  /** Cosine similarity threshold for semantic matches (0.0-1.0) */
  threshold: number
  /** Whether to show detailed semantic match explanations */
  showSemanticExplanations: boolean
  /** Whether to automatically apply suggested filters */
  autoApplySuggestions: boolean
  /** Maximum number of active filters before warning the user */
  maxActiveFilters: number
  /** Hide spoiler details by default (vs showing context) */
  minimalSpoilerMode: boolean
}

export const DEFAULT_SEMANTIC_FILTER_SETTINGS: SemanticFilterSettings = {
  threshold: 0.42,
  showSemanticExplanations: true,
  autoApplySuggestions: false,
  maxActiveFilters: 50,
  minimalSpoilerMode: false,
}

function getStorageKey(scopeId?: string | null): string {
  const scope = scopeId && scopeId.trim().length > 0 ? scopeId.trim() : 'anon'
  return `${STORAGE_KEY_PREFIX}${scope}`
}

function clampThreshold(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_SEMANTIC_FILTER_SETTINGS.threshold
  return Math.min(1, Math.max(0.1, parsed))
}

function clampMaxActiveFilters(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_SEMANTIC_FILTER_SETTINGS.maxActiveFilters
  return Math.min(500, Math.max(1, Math.floor(parsed)))
}

function sanitizeSettings(raw: unknown): SemanticFilterSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_SEMANTIC_FILTER_SETTINGS
  }

  const candidate = raw as Partial<SemanticFilterSettings>
  return {
    threshold: clampThreshold(candidate.threshold),
    showSemanticExplanations: Boolean(candidate.showSemanticExplanations),
    autoApplySuggestions: Boolean(candidate.autoApplySuggestions),
    maxActiveFilters: clampMaxActiveFilters(candidate.maxActiveFilters),
    minimalSpoilerMode: Boolean(candidate.minimalSpoilerMode),
  }
}

function emitSettingsUpdated(scopeId?: string | null): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(SEMANTIC_FILTER_SETTINGS_UPDATED_EVENT, {
    detail: { scopeId: scopeId ?? 'anon' },
  }))
}

function migrateLegacySettings(scopeId?: string | null): SemanticFilterSettings | null {
  if (typeof window === 'undefined') return null

  try {
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!legacyRaw) return null

    const parsed = JSON.parse(legacyRaw) as unknown
    const sanitized = sanitizeSettings(parsed)
    localStorage.setItem(getStorageKey(scopeId), JSON.stringify(sanitized))
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    return sanitized
  } catch {
    return null
  }
}

export function getSemanticFilterSettings(scopeId?: string | null): SemanticFilterSettings {
  if (typeof window === 'undefined') return DEFAULT_SEMANTIC_FILTER_SETTINGS

  try {
    const storageKey = getStorageKey(scopeId)
    const stored = localStorage.getItem(storageKey)
    if (!stored) {
      const migrated = migrateLegacySettings(scopeId)
      return migrated ?? DEFAULT_SEMANTIC_FILTER_SETTINGS
    }
    const parsed = JSON.parse(stored) as unknown
    return sanitizeSettings(parsed)
  } catch {
    return DEFAULT_SEMANTIC_FILTER_SETTINGS
  }
}

export function saveSemanticFilterSettings(settings: SemanticFilterSettings, scopeId?: string | null): void {
  if (typeof window === 'undefined') return
  try {
    const sanitized = sanitizeSettings(settings)
    localStorage.setItem(getStorageKey(scopeId), JSON.stringify(sanitized))
    emitSettingsUpdated(scopeId)
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

export function resetSemanticFilterSettings(scopeId?: string | null): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(getStorageKey(scopeId))
    emitSettingsUpdated(scopeId)
  } catch {
    // Silently fail if localStorage is unavailable
  }
}
