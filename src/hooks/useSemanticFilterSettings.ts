/**
 * useSemanticFilterSettings
 *
 * React hook for managing semantic filter preferences and statistics.
 */

import { useCallback, useEffect, useState } from 'react'
import { useApp } from '@/contexts/app-context'
import {
  getSemanticFilterSettings,
  saveSemanticFilterSettings,
  resetSemanticFilterSettings,
  SEMANTIC_FILTER_SETTINGS_UPDATED_EVENT,
  DEFAULT_SEMANTIC_FILTER_SETTINGS,
  type SemanticFilterSettings,
} from '@/lib/filters/semanticSettings'
import { useKeywordFilters } from '@/hooks/useKeywordFilters'

export function useSemanticFilterSettings() {
  const { currentUser } = useApp()
  const scopeId = currentUser?.pubkey ?? 'anon'
  const [settings, setSettings] = useState<SemanticFilterSettings>(DEFAULT_SEMANTIC_FILTER_SETTINGS)
  const { filters, loading: filtersLoading } = useKeywordFilters()

  // Load settings for the active user scope.
  useEffect(() => {
    setSettings(getSemanticFilterSettings(scopeId))

    const onSemanticSettingsUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ scopeId?: string }>
      if (customEvent.detail?.scopeId !== scopeId) return
      setSettings(getSemanticFilterSettings(scopeId))
    }

    const onStorage = (event: StorageEvent) => {
      if (!event.key) return
      if (!event.key.endsWith(`:${scopeId}`)) return
      setSettings(getSemanticFilterSettings(scopeId))
    }

    window.addEventListener(SEMANTIC_FILTER_SETTINGS_UPDATED_EVENT, onSemanticSettingsUpdated as EventListener)
    window.addEventListener('storage', onStorage)

    return () => {
      window.removeEventListener(SEMANTIC_FILTER_SETTINGS_UPDATED_EVENT, onSemanticSettingsUpdated as EventListener)
      window.removeEventListener('storage', onStorage)
    }
  }, [scopeId])

  const updateSettings = useCallback((updates: Partial<SemanticFilterSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...updates }
      saveSemanticFilterSettings(next, scopeId)
      return next
    })
  }, [scopeId])

  const reset = useCallback(() => {
    setSettings(DEFAULT_SEMANTIC_FILTER_SETTINGS)
    resetSemanticFilterSettings(scopeId)
  }, [scopeId])

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
