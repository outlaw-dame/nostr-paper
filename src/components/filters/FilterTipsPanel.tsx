/**
 * Filter Tips Panel
 *
 * Educational component showing tips and examples for semantic filtering.
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { FILTER_TIPS, SEMANTIC_EXAMPLES } from '@/lib/filters/tips'

interface FilterTipsPanelProps {
  dismissible?: boolean
  className?: string
}

export function FilterTipsPanel({ dismissible = true, className = '' }: FilterTipsPanelProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <AnimatePresence>
      {!collapsed && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className={`rounded-ios-xl bg-[rgb(var(--color-bg-secondary))] border border-[rgb(var(--color-system-blue)/0.2)] p-4 ${className}`}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-system-blue))] mb-2">
                💡 Pro Tips
              </p>
              <p className="text-[13px] leading-relaxed text-[rgb(var(--color-label-secondary))]">
                Semantic matching uses AI to catch similar concepts without manual enumeration.
              </p>
            </div>
            {dismissible && (
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="shrink-0 text-[16px] active:opacity-70"
                aria-label="Dismiss tips"
              >
                ✕
              </button>
            )}
          </div>

          {/* Tips List */}
          <div className="mt-3 space-y-2">
            {FILTER_TIPS.slice(0, 3).map((tip, idx) => (
              <div key={idx} className="flex items-start gap-2.5 text-[12px]">
                <span className="shrink-0 text-[14px]">{tip.icon}</span>
                <div>
                  <p className="font-medium text-[rgb(var(--color-label))]">
                    {tip.title}
                  </p>
                  <p className="text-[rgb(var(--color-label-tertiary))] mt-0.5">
                    {tip.description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Examples */}
          <div className="mt-4 pt-3 border-t border-[rgb(var(--color-fill)/0.1)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))] mb-2">
              Semantic Matching Examples
            </p>
            {SEMANTIC_EXAMPLES.slice(0, 2).map((example, idx) => (
              <div key={idx} className="text-[12px] mb-2.5 last:mb-0">
                <p className="font-medium text-[rgb(var(--color-label))]">
                  Add &ldquo;{example.keyword}&rdquo;
                </p>
                <p className="text-[rgb(var(--color-label-tertiary))] mt-0.5">
                  Also catches: {example.semanticMatches.slice(0, 3).join(', ')}…
                </p>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function FilterTipsExpandable() {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left text-[13px] font-medium text-[#007AFF] active:opacity-70"
      >
        {expanded ? '▼ Hide' : '▶ Show'} all tips & examples
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-3 text-[12px]"
          >
            {/* All Tips */}
            <div className="rounded-ios-lg bg-[rgb(var(--color-bg))] p-3 border border-[rgb(var(--color-fill)/0.08)]">
              <p className="font-semibold text-[rgb(var(--color-label))] mb-2">Tips</p>
              <div className="space-y-1.5">
                {FILTER_TIPS.map((tip, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <span className="shrink-0">{tip.icon}</span>
                    <div>
                      <p className="font-medium text-[rgb(var(--color-label))]">
                        {tip.title}
                      </p>
                      <p className="text-[rgb(var(--color-label-tertiary))]">
                        {tip.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* All Examples */}
            <div className="rounded-ios-lg bg-[rgb(var(--color-bg))] p-3 border border-[rgb(var(--color-fill)/0.08)]">
              <p className="font-semibold text-[rgb(var(--color-label))] mb-2">Examples</p>
              <div className="space-y-2">
                {SEMANTIC_EXAMPLES.map((example, idx) => (
                  <div key={idx}>
                    <p className="font-medium text-[rgb(var(--color-label))]">
                      &ldquo;{example.keyword}&rdquo;
                    </p>
                    <p className="text-[rgb(var(--color-label-tertiary))] mt-0.5">
                      {example.description}
                    </p>
                    <p className="text-[rgb(var(--color-label-quaternary))] mt-1 text-[11px]">
                      Also catches: {example.semanticMatches.join(', ')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
