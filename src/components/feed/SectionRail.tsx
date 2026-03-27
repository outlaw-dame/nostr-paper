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

import { useEffect, useRef, useCallback } from 'react'
import { motion } from 'motion/react'
import type { FeedSection } from '@/types'

interface SectionRailProps {
  sections: FeedSection[]
  activeId: string
  onSelect: (id: string) => void
}

export function SectionRail({ sections, activeId, onSelect }: SectionRailProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  /** Scroll the active chip into the centre of the rail */
  const scrollActiveIntoView = useCallback((index: number, behavior: ScrollBehavior = 'smooth') => {
    const rail = scrollRef.current
    if (!rail) return
    const chip = rail.children[index] as HTMLElement | undefined
    if (!chip) return
    const railRect = rail.getBoundingClientRect()
    const chipRect = chip.getBoundingClientRect()
    const target =
      rail.scrollLeft +
      chipRect.left -
      railRect.left -
      (railRect.width - chipRect.width) / 2
    rail.scrollTo({ left: target, behavior })
  }, [])

  useEffect(() => {
    const activeIndex = sections.findIndex((section) => section.id === activeId)
    if (activeIndex === -1) return

    const frame = requestAnimationFrame(() => {
      scrollActiveIntoView(activeIndex, 'auto')
    })

    return () => cancelAnimationFrame(frame)
  }, [activeId, scrollActiveIntoView, sections])

  return (
    <div
      className="border-b border-[rgb(var(--color-fill)/0.12)]"
      role="tablist"
      aria-label="Feed sections"
    >
      <div
        ref={scrollRef}
        className="
          flex items-center gap-5 overflow-x-auto px-1
          scrollbar-none touch-pan-x
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
                relative flex-shrink-0 max-w-[8.75rem] pb-3 pt-2
                text-[15px] font-medium tracking-[-0.01em]
                tap-none select-none transition-colors duration-150
                ${isActive
                  ? 'text-[rgb(var(--color-label))]'
                  : 'text-[rgb(var(--color-label-secondary))]'
                }
              `}
              whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              onClick={(event) => {
                event.stopPropagation()
                onSelect(section.id)
                scrollActiveIntoView(i)
              }}
            >
              <span className="block max-w-[8.75rem] truncate whitespace-nowrap">
                {section.label}
              </span>

              {isActive && (
                <motion.div
                  layoutId="section-active-underline"
                  className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-[rgb(var(--color-label))]"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
