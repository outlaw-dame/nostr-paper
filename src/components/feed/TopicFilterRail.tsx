/**
 * TopicFilterRail
 *
 * A horizontally scrollable chip row that exposes incremental cluster topics
 * as one-tap feed filters. Appears only when at least two distinct topic
 * clusters have formed; hides itself while clustering is still in progress.
 *
 * Design intent:
 * - Lighter weight than SectionRail — no underline indicator, smaller text.
 * - "All" chip always leads to clear the filter.
 * - Active chip gets accent fill; inactive chips get a subtle border.
 */

import { useRef, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { TopicCluster } from '@/hooks/useTopicClusters'

interface TopicFilterRailProps {
  topics: TopicCluster[]
  activeTopicId: string | null
  onSelect: (id: string | null) => void
  clustering: boolean
}

function topicLabel(topic: TopicCluster): string {
  if (topic.keywords.length === 0) {
    return `Topic ${topic.id.slice(0, 4)}`
  }
  // Title-case the first two keywords, join with " · "
  return topic.keywords
    .slice(0, 2)
    .map(k => k.charAt(0).toUpperCase() + k.slice(1))
    .join(' · ')
}

export function TopicFilterRail({
  topics,
  activeTopicId,
  onSelect,
  clustering,
}: TopicFilterRailProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const scrollChipIntoView = useCallback((index: number) => {
    const rail = scrollRef.current
    if (!rail) return
    // +1 because chip index 0 is the "All" chip
    const chip = rail.children[index + 1] as HTMLElement | undefined
    if (!chip) return
    const railRect = rail.getBoundingClientRect()
    const chipRect = chip.getBoundingClientRect()
    const target =
      rail.scrollLeft +
      chipRect.left -
      railRect.left -
      (railRect.width - chipRect.width) / 2
    rail.scrollTo({ left: target, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (activeTopicId === null) return
    const index = topics.findIndex(t => t.id === activeTopicId)
    if (index !== -1) scrollChipIntoView(index)
  }, [activeTopicId, topics, scrollChipIntoView])

  // Don't render if there's nothing useful to show.
  if (!clustering && topics.length < 1) return null

  return (
    <AnimatePresence initial={false}>
      {(topics.length >= 1 || clustering) && (
        <motion.div
          key="topic-rail"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="overflow-hidden border-b border-[rgb(var(--color-fill)/0.08)]"
        >
          <div
            ref={scrollRef}
            className="flex items-center gap-2 overflow-x-auto px-4 py-2.5 scrollbar-none touch-pan-x"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {/* "All" chip */}
            <button
              type="button"
              onClick={() => onSelect(null)}
              className={`
                flex-shrink-0 rounded-full px-3 py-1 text-[12px] font-medium tracking-[-0.01em]
                transition-colors duration-150 select-none
                ${activeTopicId === null
                  ? 'bg-[rgb(var(--color-label))] text-[rgb(var(--color-bg))]'
                  : 'border border-[rgb(var(--color-fill)/0.18)] text-[rgb(var(--color-label-secondary))] active:bg-[rgb(var(--color-fill)/0.08)]'
                }
              `}
            >
              All
            </button>

            {/* Topic chips */}
            {topics.map((topic, i) => {
              const isActive = topic.id === activeTopicId
              return (
                <button
                  key={topic.id}
                  type="button"
                  onClick={() => {
                    onSelect(topic.id)
                    scrollChipIntoView(i)
                  }}
                  className={`
                    flex-shrink-0 rounded-full px-3 py-1 text-[12px] font-medium tracking-[-0.01em]
                    transition-colors duration-150 select-none whitespace-nowrap
                    ${isActive
                      ? 'bg-[rgb(var(--color-label))] text-[rgb(var(--color-bg))]'
                      : 'border border-[rgb(var(--color-fill)/0.18)] text-[rgb(var(--color-label-secondary))] active:bg-[rgb(var(--color-fill)/0.08)]'
                    }
                  `}
                >
                  {topicLabel(topic)}
                  <span className={`
                    ml-1.5 text-[10px] font-normal tabular-nums
                    ${isActive ? 'opacity-70' : 'opacity-50'}
                  `}>
                    {topic.count}
                  </span>
                </button>
              )
            })}

            {/* Pulsing skeleton while clustering */}
            {clustering && topics.length === 0 && (
              <>
                {[64, 80, 56].map((w) => (
                  <div
                    key={w}
                    className="h-7 flex-shrink-0 animate-pulse rounded-full bg-[rgb(var(--color-fill)/0.1)]"
                    style={{ width: w }}
                  />
                ))}
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
