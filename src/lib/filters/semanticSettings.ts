/**
 * Semantic Filter Settings & Preferences
 *
 * User preferences for how semantic filtering behaves globally.
 */

const STORAGE_KEY = 'nostr-paper-semantic-filter-settings'

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

export function getSemanticFilterSettings(): SemanticFilterSettings {
  if (typeof window === 'undefined') return DEFAULT_SEMANTIC_FILTER_SETTINGS
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return DEFAULT_SEMANTIC_FILTER_SETTINGS
    return {
      ...DEFAULT_SEMANTIC_FILTER_SETTINGS,
      ...JSON.parse(stored),
    }
  } catch {
    return DEFAULT_SEMANTIC_FILTER_SETTINGS
  }
}

export function saveSemanticFilterSettings(settings: SemanticFilterSettings): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

export function resetSemanticFilterSettings(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Silently fail if localStorage is unavailable
  }
}
