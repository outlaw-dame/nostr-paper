/**
 * SemanticFilterSettings
 *
 * Settings pane for managing semantic keyword filters with:
 *   • Quick preset application
 *   • Filter statistics
 *   • Threshold preferences
 *   • Visual semantic match explanations
 *   • One-click filter management
 */

import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useSemanticFilterSettings } from '@/hooks/useSemanticFilterSettings'
import { useKeywordFilters } from '@/hooks/useKeywordFilters'
import { FilterTipsPanel } from '@/components/filters/FilterTipsPanel'
import { FILTER_PRESETS, getPresetsByCategory } from '@/lib/filters/presets'
import type { CreateFilterInput } from '@/lib/filters/types'

// ── Quick Stats ───────────────────────────────────────────────────────────────

function FilterStatsCard() {
  const {
    totalFilterCount,
    activeFilterCount,
    semanticFilterCount,
    semanticActiveCount,
    filtersLoading,
    isOverMaxFilters,
  } = useSemanticFilterSettings()

  return (
    <div className="rounded-ios-xl bg-[rgb(var(--color-bg-secondary))] border border-[rgb(var(--color-fill)/0.1)] p-4">
      <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))] mb-3">
        Filter Statistics
      </p>

      {filtersLoading ? (
        <p className="text-[14px] text-[rgb(var(--color-label-tertiary))]">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {/* Total Filters */}
          <div className="flex flex-col">
            <p className="text-[13px] text-[rgb(var(--color-label-secondary))]">
              Total Filters
            </p>
            <p className={`text-[24px] font-semibold mt-1 ${isOverMaxFilters ? 'text-[rgb(var(--color-system-red))]' : 'text-[rgb(var(--color-label))]'}`}>
              {totalFilterCount}
            </p>
            {isOverMaxFilters && (
              <p className="text-[11px] text-[rgb(var(--color-system-red))] mt-1">
                Over recommended limit
              </p>
            )}
          </div>

          {/* Active Filters */}
          <div className="flex flex-col">
            <p className="text-[13px] text-[rgb(var(--color-label-secondary))]">
              Active
            </p>
            <p className="text-[24px] font-semibold mt-1 text-[rgb(var(--color-system-green))]">
              {activeFilterCount}
            </p>
            <p className="text-[11px] text-[rgb(var(--color-label-tertiary))] mt-1">
              enabled
            </p>
          </div>

          {/* Semantic Filters */}
          <div className="flex flex-col">
            <p className="text-[13px] text-[rgb(var(--color-label-secondary))]">
              Semantic
            </p>
            <p className="text-[24px] font-semibold mt-1 text-[rgb(var(--color-system-purple))]">
              {semanticFilterCount}
            </p>
            <p className="text-[11px] text-[rgb(var(--color-label-tertiary))] mt-1">
              filters
            </p>
          </div>

          {/* Semantic Active */}
          <div className="flex flex-col">
            <p className="text-[13px] text-[rgb(var(--color-label-secondary))]">
              Active Semantic
            </p>
            <p className="text-[24px] font-semibold mt-1 text-[rgb(var(--color-system-purple))]">
              {semanticActiveCount}
            </p>
            <p className="text-[11px] text-[rgb(var(--color-label-tertiary))] mt-1">
              enabled
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Filter Presets ───────────────────────────────────────────────────────────

interface PresetCardProps {
  preset: typeof FILTER_PRESETS[0]
  isApplying: boolean
  onApply: (preset: typeof FILTER_PRESETS[0]) => Promise<void>
}

function PresetCard({ preset, isApplying, onApply }: PresetCardProps) {
  return (
    <motion.button
      type="button"
      onClick={() => onApply(preset)}
      disabled={isApplying}
      layout
      className="
        text-left rounded-ios-xl bg-[rgb(var(--color-bg-secondary))]
        border border-[rgb(var(--color-fill)/0.1)]
        p-4 transition-all active:opacity-70
        disabled:opacity-50 hover:border-[rgb(var(--color-fill)/0.2)]
      "
    >
      <div className="flex items-start gap-3">
        <span className="text-[28px] flex-shrink-0">{preset.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-[rgb(var(--color-label))]">
            {preset.name}
          </p>
          <p className="text-[12px] text-[rgb(var(--color-label-secondary))] mt-1 leading-snug">
            {preset.description}
          </p>
          <p className="text-[11px] text-[rgb(var(--color-label-tertiary))] mt-2">
            {preset.filters.length} filter{preset.filters.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>
      {isApplying && (
        <span className="text-[12px] text-[rgb(var(--color-label-secondary))] mt-2">
          Applying…
        </span>
      )}
    </motion.button>
  )
}

// ── Threshold Settings ────────────────────────────────────────────────────────

function ThresholdSettings() {
  const { settings, updateSettings } = useSemanticFilterSettings()

  return (
    <div className="rounded-ios-xl bg-[rgb(var(--color-bg-secondary))] border border-[rgb(var(--color-fill)/0.1)] p-4">
      <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))] mb-4">
        Semantic Matching Sensitivity
      </p>

      <div>
        <label className="block mb-3">
          <p className="text-[13px] font-medium text-[rgb(var(--color-label))] mb-2">
            Similarity Threshold: <span className="font-semibold">{settings.threshold.toFixed(2)}</span>
          </p>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={settings.threshold}
            onChange={e => updateSettings({ threshold: parseFloat(e.target.value) })}
            className="w-full h-2 bg-[rgb(var(--color-fill)/0.1)] rounded-full appearance-none cursor-pointer accent-[#007AFF]"
          />
          <div className="flex justify-between text-[11px] text-[rgb(var(--color-label-tertiary))] mt-1">
            <span>Strict (0.1)</span>
            <span>Lenient (1.0)</span>
          </div>
        </label>

        <div className="mt-4 p-3 rounded-lg bg-[rgb(var(--color-bg))] border border-[rgb(var(--color-fill)/0.08)]">
          <p className="text-[12px] leading-relaxed text-[rgb(var(--color-label-secondary))]">
            {settings.threshold < 0.3 ? (
              <>
                <span className="font-medium">Very Strict:</span> Only catches very similar terms. &quot;violence&quot; won&apos;t match &quot;conflict&quot;.
              </>
            ) : settings.threshold < 0.45 ? (
              <>
                <span className="font-medium">Recommended:</span> Catches strong synonyms. &quot;violence&quot; matches &quot;assault&quot;, &quot;brutality&quot;, etc.
              </>
            ) : settings.threshold < 0.7 ? (
              <>
                <span className="font-medium">Moderate:</span> Broader matching. &quot;violence&quot; also matches related concepts like &quot;danger&quot;.
              </>
            ) : (
              <>
                <span className="font-medium">Very Lenient:</span> Catches loosely related terms. May produce false positives.
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Display Preferences ───────────────────────────────────────────────────────

function DisplayPreferences() {
  const { settings, updateSettings } = useSemanticFilterSettings()

  return (
    <div className="rounded-ios-xl bg-[rgb(var(--color-bg-secondary))] border border-[rgb(var(--color-fill)/0.1)] p-4">
      <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))] mb-4">
        Display Preferences
      </p>

      <div className="space-y-3">
        {/* Show semantic explanations */}
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.showSemanticExplanations}
            onChange={e => updateSettings({ showSemanticExplanations: e.target.checked })}
            className="mt-1 w-5 h-5 rounded accent-[#007AFF]"
          />
          <div>
            <p className="text-[14px] font-medium text-[rgb(var(--color-label))]">
              Show Detailed Explanations
            </p>
            <p className="text-[12px] text-[rgb(var(--color-label-tertiary))] mt-0.5">
              When a filter matches, show why (matched field, similarity score)
            </p>
          </div>
        </label>

        {/* Minimal spoiler mode */}
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.minimalSpoilerMode}
            onChange={e => updateSettings({ minimalSpoilerMode: e.target.checked })}
            className="mt-1 w-5 h-5 rounded accent-[#007AFF]"
          />
          <div>
            <p className="text-[14px] font-medium text-[rgb(var(--color-label))]">
              Minimal Spoiler Mode
            </p>
            <p className="text-[12px] text-[rgb(var(--color-label-tertiary))] mt-0.5">
              Hide spoiler details by default, show only filter icon
            </p>
          </div>
        </label>
      </div>
    </div>
  )
}

// ── Quick Add Filter ─────────────────────────────────────────────────────────

function QuickAddFilter() {
  const { add: addFilter } = useKeywordFilters()
  const [expanded, setExpanded] = useState(false)
  const [word, setWord] = useState('')
  const [scope, setScope] = useState<'any' | 'content' | 'author' | 'hashtag'>('any')
  const [action, setAction] = useState<'warn' | 'hide'>('warn')
  const [semantic, setSemantic] = useState(true)
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState('')

  const handleAdd = useCallback(async () => {
    if (!word.trim()) return

    setAdding(true)
    setMessage('')

    try {
      await addFilter({
        term: word.trim().toLowerCase(),
        scope,
        action,
        semantic,
        wholeWord: false,
        enabled: true,
        expiresAt: null,
      })
      setWord('')
      setScope('any')
      setAction('warn')
      setSemantic(true)
      setExpanded(false)
      setMessage('✓ Filter added')
      setTimeout(() => setMessage(''), 2000)
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : 'Failed to add filter'}`)
    } finally {
      setAdding(false)
    }
  }, [word, scope, action, semantic, addFilter])

  return (
    <div className="rounded-ios-xl bg-[rgb(var(--color-bg-secondary))] border border-[rgb(var(--color-fill)/0.1)] p-4">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-left"
      >
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))]">
            ➕ Quick Add Filter
          </p>
          <p className="text-[12px] text-[rgb(var(--color-label-tertiary))] mt-1">
            Add a word or phrase to filter
          </p>
        </div>
        <span className="text-[16px] transition-transform" style={{ transform: expanded ? 'rotate(180deg)' : '' }}>
          ▼
        </span>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-4 pt-4 border-t border-[rgb(var(--color-fill)/0.1)] space-y-3"
          >
            {/* Word/Phrase Input */}
            <div>
              <label className="block text-[12px] font-medium text-[rgb(var(--color-label-secondary))] mb-1">
                Word or Phrase
              </label>
              <input
                type="text"
                value={word}
                onChange={e => setWord(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !adding) void handleAdd()
                }}
                placeholder="e.g., spam, violence, politics"
                disabled={adding}
                autoFocus
                className="w-full px-3 py-2.5 rounded-[10px] bg-[rgb(var(--color-bg))] border border-[rgb(var(--color-fill)/0.1)] text-[14px] text-[rgb(var(--color-label))] placeholder:text-[rgb(var(--color-label-tertiary))] outline-none focus:border-[#007AFF]"
              />
            </div>

            {/* Scope Selector */}
            <div>
              <label className="block text-[12px] font-medium text-[rgb(var(--color-label-secondary))] mb-2">
                Apply to
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['any', 'content', 'author', 'hashtag'] as const).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScope(s)}
                    disabled={adding}
                    className={`py-2 rounded-[8px] text-[12px] font-medium transition-colors ${
                      scope === s
                        ? 'bg-[#007AFF] text-white'
                        : 'bg-[rgb(var(--color-bg))] text-[rgb(var(--color-label))] border border-[rgb(var(--color-fill)/0.1)]'
                    }`}
                  >
                    {s === 'any' ? 'Any' : s === 'content' ? 'Posts' : s === 'author' ? 'Authors' : 'Hashtags'}
                  </button>
                ))}
              </div>
            </div>

            {/* Action Selector */}
            <div>
              <label className="block text-[12px] font-medium text-[rgb(var(--color-label-secondary))] mb-2">
                When matched
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['warn', 'hide'] as const).map(a => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAction(a)}
                    disabled={adding}
                    className={`py-2 rounded-[8px] text-[12px] font-medium transition-colors ${
                      action === a
                        ? 'bg-[#007AFF] text-white'
                        : 'bg-[rgb(var(--color-bg))] text-[rgb(var(--color-label))] border border-[rgb(var(--color-fill)/0.1)]'
                    }`}
                  >
                    {a === 'warn' ? '⚠️ Warn' : '🚫 Hide'}
                  </button>
                ))}
              </div>
            </div>

            {/* Semantic Toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={semantic}
                onChange={e => setSemantic(e.target.checked)}
                disabled={adding}
                className="w-4 h-4 rounded accent-[#007AFF]"
              />
              <div>
                <p className="text-[12px] font-medium text-[rgb(var(--color-label))]">
                  Use Semantic Matching
                </p>
                <p className="text-[11px] text-[rgb(var(--color-label-tertiary))]">
                  Catch similar words like &quot;violence&quot; → &quot;assault&quot;
                </p>
              </div>
            </label>

            {/* Add Button */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleAdd()}
                disabled={adding || !word.trim()}
                className="flex-1 py-2.5 rounded-[10px] bg-[#007AFF] text-white text-[13px] font-medium active:opacity-70 disabled:opacity-40"
              >
                {adding ? 'Adding…' : 'Add Filter'}
              </button>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                disabled={adding}
                className="flex-1 py-2.5 rounded-[10px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg))] text-[rgb(var(--color-label))] text-[13px] font-medium active:opacity-70"
              >
                Cancel
              </button>
            </div>

            {message && (
              <p className={`text-[12px] text-center ${message.startsWith('✓') ? 'text-[rgb(var(--color-system-green))]' : 'text-[rgb(var(--color-system-red))]'}`}>
                {message}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function SemanticFilterSettings() {
  const navigate = useNavigate()
  const { add: addFilter } = useKeywordFilters()
  const [applyingPreset, setApplyingPreset] = useState<string | null>(null)
  const [safetyPresets] = useState(() => getPresetsByCategory('safety'))
  const [contentPresets] = useState(() => getPresetsByCategory('content'))
  const [spamPresets] = useState(() => getPresetsByCategory('spam'))

  const handleApplyPreset = useCallback(async (preset: typeof FILTER_PRESETS[0]) => {
    setApplyingPreset(preset.id)
    try {
      for (const filterData of preset.filters) {
        await addFilter(filterData)
      }
    } catch (err) {
      console.error('Failed to apply preset:', err)
    } finally {
      setApplyingPreset(null)
    }
  }, [addFilter])

  return (
    <div className="space-y-6 px-4 py-6">
      {/* Header */}
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))] mb-1">
          Semantic Filtering
        </p>
        <p className="text-[15px] leading-snug text-[rgb(var(--color-label-secondary))]">
          Use AI to detect similar concepts. &quot;violence&quot; catches &quot;assault&quot;, &quot;brutality&quot;, etc. without manual enumeration.
        </p>
      </div>

      {/* Tips Panel */}
      <FilterTipsPanel />

      {/* Quick Stats */}
      <FilterStatsCard />

      {/* Threshold Settings */}
      <ThresholdSettings />

      {/* Display Preferences */}
      <DisplayPreferences />

      {/* Quick Add Filter */}
      <QuickAddFilter />

      {/* Quick Presets */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))]">
            Quick Presets
          </p>
          <button
            type="button"
            onClick={() => navigate('/settings/moderation/filters')}
            className="text-[12px] font-medium text-[#007AFF] active:opacity-70"
          >
            Manage All →
          </button>
        </div>

        <div className="space-y-4">
          {/* Safety Presets */}
          {safetyPresets.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-tertiary))] mb-2">
                Safety
              </p>
              <div className="grid gap-2">
                {safetyPresets.map(preset => (
                  <PresetCard
                    key={preset.id}
                    preset={preset}
                    isApplying={applyingPreset === preset.id}
                    onApply={handleApplyPreset}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Spam Presets */}
          {spamPresets.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-tertiary))] mb-2">
                Spam
              </p>
              <div className="grid gap-2">
                {spamPresets.map(preset => (
                  <PresetCard
                    key={preset.id}
                    preset={preset}
                    isApplying={applyingPreset === preset.id}
                    onApply={handleApplyPreset}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Content Presets */}
          {contentPresets.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-tertiary))] mb-2">
                Content
              </p>
              <div className="grid gap-2">
                {contentPresets.map(preset => (
                  <PresetCard
                    key={preset.id}
                    preset={preset}
                    isApplying={applyingPreset === preset.id}
                    onApply={handleApplyPreset}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <p className="text-[12px] text-[rgb(var(--color-label-tertiary))] mt-4">
          Presets add filters that you can customize or disable anytime.
        </p>
      </div>
    </div>
  )
}
