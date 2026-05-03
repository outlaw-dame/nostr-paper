import { useEffect, useState } from 'react'

import {
  classifyFactCheckRating,
  peekFactCheck,
  searchFactChecks,
  type FactCheckRating,
  type FactCheckResult,
} from '@/lib/security/factCheck'

interface FactCheckBadgeProps {
  /** A search query — typically a headline, claim, or page title. */
  query: string | null | undefined
  /** Compact variant fits inline next to a domain label. */
  compact?: boolean
  /** Maximum number of ratings to show. Defaults to 1. */
  maxRatings?: number
  className?: string
}

const VERDICT_STYLES: Record<'true' | 'false' | 'mixed', { label: string; className: string }> = {
  true: {
    label: 'Verified',
    className:
      'bg-[rgb(var(--color-system-green)/0.16)] text-[rgb(var(--color-system-green))]',
  },
  false: {
    label: 'Fact-check: false',
    className:
      'bg-[rgb(var(--color-system-red)/0.16)] text-[rgb(var(--color-system-red))]',
  },
  mixed: {
    label: 'Fact-check',
    className:
      'bg-[rgb(var(--color-system-orange)/0.16)] text-[rgb(var(--color-system-orange))]',
  },
}

function ratingLink(rating: FactCheckRating): string {
  return rating.reviewUrl
}

export function FactCheckBadge({
  query,
  compact = false,
  maxRatings = 1,
  className = '',
}: FactCheckBadgeProps) {
  const [result, setResult] = useState<FactCheckResult | null>(() =>
    query ? peekFactCheck(query) ?? null : null,
  )

  useEffect(() => {
    if (!query) {
      setResult(null)
      return
    }

    const cached = peekFactCheck(query)
    if (cached) {
      setResult(cached)
      return
    }

    let cancelled = false
    void searchFactChecks(query).then((next) => {
      if (!cancelled) setResult(next)
    })
    return () => {
      cancelled = true
    }
  }, [query])

  if (!result || result.ratings.length === 0) return null

  const ratings = result.ratings.slice(0, maxRatings)

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {ratings.map((rating, index) => {
        const verdict = classifyFactCheckRating(rating.textualRating)
        const style = VERDICT_STYLES[verdict]
        const publisher = rating.publisherName ?? rating.publisherSite ?? 'Fact-check'
        return (
          <a
            key={`${rating.reviewUrl}-${index}`}
            href={ratingLink(rating)}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={(event) => event.stopPropagation()}
            className={`
              inline-flex max-w-full items-center gap-2 rounded-full px-2.5 py-1
              text-[11px] font-semibold ${style.className}
            `}
            aria-label={`Fact-check by ${publisher}: ${rating.textualRating}`}
          >
            <span className="uppercase tracking-[0.08em]">{style.label}</span>
            <span className="truncate font-medium opacity-90">
              {rating.textualRating}
            </span>
            {!compact && (
              <span className="truncate text-[10px] font-normal opacity-70">
                {publisher}
              </span>
            )}
          </a>
        )
      })}
    </div>
  )
}
