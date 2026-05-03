import { useMemo } from 'react'

import { useSourceExposureSummary } from '@/hooks/useSourceExposureSummary'
import { resolveSourceLens } from '@/lib/media/sourceOrientation'
import type { TrendingLinkStat } from '@/lib/explore/trendingLinks'

type OrientationBucket = 'left' | 'center' | 'right'

interface NewsBlindspotPanelProps {
  links: TrendingLinkStat[]
  className?: string
}

function bucketize(orientation: string): OrientationBucket | null {
  if (orientation === 'left' || orientation === 'lean-left') return 'left'
  if (orientation === 'center') return 'center'
  if (orientation === 'right' || orientation === 'lean-right') return 'right'
  return null
}

function pct(value: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((value / total) * 100)
}

export function NewsBlindspotPanel({ links, className = '' }: NewsBlindspotPanelProps) {
  const exposureSummary = useSourceExposureSummary(14)

  const trendMix = useMemo(() => {
    const counts: Record<OrientationBucket, number> = { left: 0, center: 0, right: 0 }
    let total = 0

    for (const link of links) {
      const bucket = bucketize(resolveSourceLens(link.domain).orientation)
      if (!bucket) continue
      const weight = Math.max(1, link.usageCount)
      counts[bucket] += weight
      total += weight
    }

    return { counts, total }
  }, [links])

  const personalMix = useMemo(() => {
    const counts: Record<OrientationBucket, number> = { left: 0, center: 0, right: 0 }
    counts.left = exposureSummary.byOrientation.left + exposureSummary.byOrientation['lean-left']
    counts.center = exposureSummary.byOrientation.center
    counts.right = exposureSummary.byOrientation.right + exposureSummary.byOrientation['lean-right']
    const total = counts.left + counts.center + counts.right
    return { counts, total }
  }, [exposureSummary])

  const dominantTrend =
    trendMix.total > 0
      ? (Object.entries(trendMix.counts).sort((a, b) => b[1] - a[1])[0]?.[0] as OrientationBucket)
      : null
  const weakestTrend =
    trendMix.total > 0
      ? (Object.entries(trendMix.counts).sort((a, b) => a[1] - b[1])[0]?.[0] as OrientationBucket)
      : null

  const hasPotentialBlindspot =
    dominantTrend !== null && weakestTrend !== null &&
    pct(trendMix.counts[dominantTrend], trendMix.total) >= 60 &&
    pct(trendMix.counts[weakestTrend], trendMix.total) <= 10

  if (links.length === 0) return null

  return (
    <div
      className={`
        rounded-ios-xl border border-[rgb(var(--color-fill)/0.10)]
        bg-[rgb(var(--color-bg-secondary))] p-3 ${className}
      `}
    >
      <h3 className="text-[13px] font-semibold text-[rgb(var(--color-label))]">
        Coverage mix
      </h3>
      <p className="mt-1 text-[12px] text-[rgb(var(--color-label-secondary))]">
        Orientation mix is estimated from source-domain lenses and shown for context.
      </p>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[rgb(var(--color-fill)/0.12)]">
        <div className="flex h-full w-full">
          <div
            className="bg-[rgb(var(--color-system-blue)/0.85)]"
            style={{ width: `${pct(trendMix.counts.left, trendMix.total)}%` }}
          />
          <div
            className="bg-[rgb(var(--color-label-tertiary)/0.85)]"
            style={{ width: `${pct(trendMix.counts.center, trendMix.total)}%` }}
          />
          <div
            className="bg-[rgb(var(--color-system-red)/0.85)]"
            style={{ width: `${pct(trendMix.counts.right, trendMix.total)}%` }}
          />
        </div>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-[rgb(var(--color-label-secondary))]">
        <span>Left {pct(trendMix.counts.left, trendMix.total)}%</span>
        <span className="text-center">Center {pct(trendMix.counts.center, trendMix.total)}%</span>
        <span className="text-right">Right {pct(trendMix.counts.right, trendMix.total)}%</span>
      </div>

      {hasPotentialBlindspot && dominantTrend && weakestTrend && (
        <p className="mt-2 text-[12px] text-[rgb(var(--color-label-secondary))]">
          Potential blindspot: this trend set is concentrated on {dominantTrend}-leaning
          sources while {weakestTrend}-leaning sources are underrepresented.
        </p>
      )}

      {personalMix.total > 0 && (
        <p className="mt-2 text-[11px] text-[rgb(var(--color-label-tertiary))]">
          Your recent reading mix (14d): Left {pct(personalMix.counts.left, personalMix.total)}%,
          Center {pct(personalMix.counts.center, personalMix.total)}%,
          Right {pct(personalMix.counts.right, personalMix.total)}%.
        </p>
      )}
    </div>
  )
}
