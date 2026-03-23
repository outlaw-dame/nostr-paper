/**
 * SectionRail
 *
 * Horizontal section picker with:
 * - compact segmented-control styling
 * - animated active indicator
 * - programmatic centering for the active segment
 *
 * Prioritises reliable taps over gesture-heavy switching because the rail
 * lives inside a draggable feed surface on mobile Safari.
 */

import { useRef, useCallback } from 'react'
import { motion } from 'motion/react'
import type { FeedSection } from '@/types'

interface SectionRailProps {
  sections: FeedSection[]
  activeId: string
  onSelect: (id: string) => void
}

export function SectionRail({ sections, activeId, onSelect }: SectionRailProps) {
  const scrollRef   = useRef<HTMLDivElement>(null)

  /** Scroll the active chip into the centre of the rail */
  const scrollActiveIntoView = useCallback((index: number) => {
    const rail = scrollRef.current
    if (!rail) return
    const chip = rail.children[index] as HTMLElement | undefined
    if (!chip) return
    const railRect  = rail.getBoundingClientRect()
    const chipRect  = chip.getBoundingClientRect()
    const target    =
      rail.scrollLeft +
      chipRect.left -
      railRect.left -
      (railRect.width - chipRect.width) / 2
    rail.scrollTo({ left: target, behavior: 'smooth' })
  }, [])

  return (
    <div
      className="px-1 pb-1 pt-1"
      role="tablist"
      aria-label="Feed sections"
    >
      <div className="app-panel-muted rounded-ios-2xl overflow-hidden">
        <div
          ref={scrollRef}
          className="
            flex items-center gap-1 p-1.5
            overflow-x-auto scrollbar-none
            touch-pan-x
          "
          style={{ WebkitOverflowScrolling: 'touch' }}
          onPointerDownCapture={(event) => {
            event.stopPropagation()
          }}
        >
          {sections.map((section, i) => {
            const isActive = section.id === activeId
            return (
              <motion.button
                key={section.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`feed-section-${section.id}`}
                className={`
                  relative flex-shrink-0 flex items-center justify-center
                  px-4 py-2.5 rounded-[14px]
                  text-[14px] font-medium
                  tap-none select-none
                  transition-colors duration-150 whitespace-nowrap
                  ${isActive
                    ? 'text-[rgb(var(--color-label))]'
                    : 'text-[rgb(var(--color-label-secondary))]'
                  }
                `}
                whileTap={{ scale: 0.94 }}
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                onClick={(event) => {
                  event.stopPropagation()
                  onSelect(section.id)
                  scrollActiveIntoView(i)
                }}
              >
                {/* Active background pill — shared layout key animates between tabs */}
                {isActive && (
                  <motion.div
                    layoutId="section-active-pill"
                    className="absolute inset-0 rounded-[14px] bg-[rgb(var(--color-surface-elevated)/0.95)] shadow-[0_8px_20px_rgba(15,20,30,0.08)]"
                    transition={{ type: 'spring', stiffness: 380, damping: 36 }}
                  />
                )}

                <span className="relative z-10 whitespace-nowrap">
                  {section.label}
                </span>
              </motion.button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
