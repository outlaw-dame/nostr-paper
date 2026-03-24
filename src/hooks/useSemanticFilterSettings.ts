/**
 * useSemanticFilterSettings
 *
 * React hook for managing semantic filter preferences and statistics.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  getSemanticFilterSettings,
  saveSemanticFilterSettings,
  resetSemanticFilterSettings,
  DEFAULT_SEMANTIC_FILTER_SETTINGS,
  type SemanticFilterSettings,
} from '@/lib/filters/semanticSettings'
import { useKeywordFilters } from '@/hooks/useKeywordFilters'

export function useSemanticFilterSettings() {
  const [settings, setSettings] = useState<SemanticFilterSettings>(DEFAULT_SEMANTIC_FILTER_SETTINGS)
  const { filters, loading: filtersLoading } = useKeywordFilters()

  // Load settings on mount
  useEffect(() => {
    setSettings(getSemanticFilterSettings())
  }, [])

  const updateSettings = useCallback((updates: Partial<SemanticFilterSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...updates }
      saveSemanticFilterSettings(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    setSettings(DEFAULT_SEMANTIC_FILTER_SETTINGS)
    resetSemanticFilterSettings()
  }, [])

  // Statistics
  const semanticFilterCount = filters.filter(f => f.semantic).length
  const totalFilterCount = filters.length
  const activeFilterCount = filters.filter(f => f.enabled).length
  const semanticActiveCount = filters.filter(f => f.semantic && f.enabled).length

  return {
    settings,
    updateSettings,
    reset,
    // Statistics
    semanticFilterCount,
    totalFilterCount,
    activeFilterCount,
    semanticActiveCount,
    filtersLoading,
    // Computed
    isOverMaxFilters: totalFilterCount > settings.maxActiveFilters,
    semanticEnabledCount: filters.filter(f => f.semantic && f.enabled).length,
  }
}
