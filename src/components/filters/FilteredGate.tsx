/**
 * FilteredGate
 *
 * Wraps any content node with keyword-filter awareness:
 *
 *   action === null  → renders children unchanged
 *   action === 'hide' → renders nothing (event is removed from the feed)
 *   action === 'warn' → renders a collapsed pill with the matched filter
 *                        term and a "Show anyway" expand toggle
 *
 * The warn state is modelled after Mastodon's Content Warning UX but is
 * more informative: it names the specific filter term that triggered,
 * whether it was a semantic or text match, and which field was matched.
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type { FilterCheckResult } from '@/lib/filters/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fieldLabel(field: FilterCheckResult['matches'][number]['field']): string {
  switch (field) {
    case 'content':    return 'in content'
    case 'title':      return 'in title'
    case 'summary':    return 'in summary'
    case 'subject':    return 'in subject'
    case 'alt':        return 'in description'
    case 'pollOption': return 'in poll'
    case 'hashtag':    return 'hashtag'
    case 'authorName': return 'author name'
    case 'authorBio':  return 'author bio'
    case 'authorNip05':return 'author id'
  }
}

// ── FilteredGate component ────────────────────────────────────────────────────

interface FilteredGateProps {
  result:    FilterCheckResult
  children:  React.ReactNode
  /** Extra class applied to the warn pill wrapper. */
  className?: string
}

export function FilteredGate({ result, children, className = '' }: FilteredGateProps) {
  const [expanded, setExpanded] = useState(false)

  // Pass-through — no filter matched
  if (!result.action) return <>{children}</>

  // Hard hide — remove from DOM completely
  if (result.action === 'hide') return null

  // Warn — show a pill; tap to reveal
  const primaryMatch = result.matches[0]
  const isSemantic   = result.matches.some(m => m.semantic)
  const termLabel    = primaryMatch?.term ?? 'keyword'
  const where        = primaryMatch ? fieldLabel(primaryMatch.field) : ''
  const extraCount   = result.matches.length - 1

  return (
    <div className={className}>
      {/* Warning pill — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(prev => !prev)}
        className="
          w-full flex items-center gap-2.5
          bg-[rgb(var(--color-bg-secondary))]
          border border-[rgb(var(--color-system-yellow)/0.30)]
          rounded-ios-xl px-4 py-3
          text-left
          transition-colors duration-100
          active:opacity-70
        "
        aria-expanded={expanded}
      >
        {/* Icon */}
        <span
          className="shrink-0 text-[18px]"
          aria-hidden="true"
        >
          🔕
        </span>

        {/* Label */}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-[rgb(var(--color-label))] leading-tight truncate">
            Filtered
            {' '}
            <span className="font-normal text-[rgb(var(--color-label-secondary))]">
              — &ldquo;{termLabel}&rdquo;
            </span>
            {where && (
              <span className="font-normal text-[rgb(var(--color-label-tertiary))]">
                {' '}{where}
              </span>
            )}
          </p>

          {(isSemantic || extraCount > 0) && (
            <p className="text-[11px] text-[rgb(var(--color-label-tertiary))] leading-tight mt-0.5">
              {isSemantic && (
                <span className="inline-flex items-center gap-0.5">
                  <span
                    className="
                      inline-block w-1.5 h-1.5 rounded-full
                      bg-[rgb(var(--color-system-purple))]
                    "
                    aria-hidden="true"
                  />
                  semantic match
                </span>
              )}
              {isSemantic && extraCount > 0 && '  ·  '}
              {extraCount > 0 && `+${extraCount} more rule${extraCount > 1 ? 's' : ''}`}
            </p>
          )}
        </div>

        {/* Chevron */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className={`
            shrink-0
            text-[rgb(var(--color-label-tertiary))]
            transition-transform duration-200
            ${expanded ? 'rotate-180' : ''}
          `}
          aria-hidden="true"
        >
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Revealed content */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0,  scale: 1    }}
            exit={{    opacity: 0, y: -4, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          >
            {/* Subtle "shown despite filter" border */}
            <div className="
              mt-1 rounded-ios-xl overflow-hidden
              ring-1 ring-[rgb(var(--color-system-yellow)/0.20)]
            ">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
