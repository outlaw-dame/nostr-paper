/**
 * Filter Status Widget
 *
 * Quick status indicator and management widget for filter state.
 * Can be used in various places to show filtering activity.
 */

import { motion } from 'motion/react'
import { useSemanticFilterSettings } from '@/hooks/useSemanticFilterSettings'

interface FilterStatusWidgetProps {
  compact?: boolean
  showLink?: boolean
}

export function FilterStatusWidget({ compact = false, showLink = false }: FilterStatusWidgetProps) {
  const {
    totalFilterCount,
    activeFilterCount,
    semanticFilterCount,
    semanticActiveCount,
    filtersLoading,
    isOverMaxFilters,
  } = useSemanticFilterSettings()

  if (filtersLoading) {
    return (
      <div className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
        Loading filters…
      </div>
    )
  }

  if (compact) {
    return (
      <div className="flex items-center gap-3 text-[12px]">
        <span className="text-[rgb(var(--color-label-secondary))]">
          {activeFilterCount}/{totalFilterCount} active
        </span>
        {semanticActiveCount > 0 && (
          <span className="flex items-center gap-1 text-[rgb(var(--color-system-purple))]">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[rgb(var(--color-system-purple))]" />
            {semanticActiveCount} semantic
          </span>
        )}
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="rounded-ios-xl bg-[rgb(var(--color-bg-secondary))] border border-[rgb(var(--color-fill)/0.1)] p-3"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] font-semibold text-[rgb(var(--color-label))]">
            {activeFilterCount} active filter{activeFilterCount !== 1 ? 's' : ''}
          </p>
          {isOverMaxFilters && (
            <p className="text-[11px] text-[rgb(var(--color-system-red))] mt-1">
              Over recommended limit
            </p>
          )}
          {semanticActiveCount > 0 && (
            <p className="text-[11px] text-[rgb(var(--color-system-purple))] mt-1">
              {semanticActiveCount} using semantic matching
            </p>
          )}
        </div>

        {totalFilterCount === 0 && (
          <span className="text-[24px]">🎯</span>
        )}
        {semanticActiveCount > 0 && (
          <span className="text-[24px]">🧠</span>
        )}
        {activeFilterCount > 0 && semanticActiveCount === 0 && (
          <span className="text-[24px]">🔕</span>
        )}
      </div>
    </motion.div>
  )
}
