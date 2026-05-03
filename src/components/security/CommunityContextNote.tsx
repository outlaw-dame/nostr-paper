import { useEffect, useMemo, useState } from 'react'

import {
  classifyFactCheckRating,
  peekFactCheck,
  searchFactChecks,
  type FactCheckRating,
} from '@/lib/security/factCheck'
import { URL_PATTERN } from '@/lib/text/entities'
import { stripUrlTrailingPunct } from '@/lib/security/sanitize'

/**
 * CommunityContextNote
 *
 * A neutral, reader-facing context panel inspired by X / Twitter
 * "Community Notes," but sourced from Google Fact Check Tools (the
 * IFCN-affiliated fact-checker corpus) rather than crowd contributions.
 *
 * Editorial rules baked in:
 *   - Tone is descriptive, not accusatory ("a fact-checker reviewed
 *     this claim", not "this post is fake").
 *   - Always cite the publisher and link to the original review.
 *   - Show the publisher's *own* textualRating verbatim (no rewording).
 *   - Hide entirely when there are no matching reviews — silence is
 *     preferable to false certainty.
 */
interface CommunityContextNoteProps {
  /** Note content to scan for URLs / claim text. */
  content: string
  /** Maximum number of context entries to render. Defaults to 3. */
  maxEntries?: number
  className?: string
}

const VERDICT_LABEL: Record<'true' | 'false' | 'mixed', string> = {
  true: 'Rated accurate',
  false: 'Rated inaccurate',
  mixed: 'Reviewed',
}

const VERDICT_DOT: Record<'true' | 'false' | 'mixed', string> = {
  true: 'bg-[rgb(var(--color-system-green))]',
  false: 'bg-[rgb(var(--color-system-red))]',
  mixed: 'bg-[rgb(var(--color-system-orange))]',
}

function extractCandidateQueries(content: string): string[] {
  const queries: string[] = []
  const seen = new Set<string>()

  // 1. URLs in the note get a fact-check lookup verbatim — Google Fact
  //    Check supports URL queries and returns reviews tied to that page.
  const urlMatches = content.match(URL_PATTERN) ?? []
  for (const raw of urlMatches) {
    const cleaned = stripUrlTrailingPunct(raw)
    if (cleaned.length === 0) continue
    if (seen.has(cleaned)) continue
    seen.add(cleaned)
    queries.push(cleaned)
    if (queries.length >= 2) break
  }

  // 2. Fall back to the note's leading sentence (max ~140 chars) so
  //    text-only claims still get a chance at a fact-check match.
  if (queries.length === 0) {
    const text = content.replace(/\s+/g, ' ').trim()
    if (text.length >= 20) {
      const firstSentence = text.split(/(?<=[.!?])\s/)[0] ?? text
      const claim = firstSentence.slice(0, 200).trim()
      if (claim.length >= 20) queries.push(claim)
    }
  }

  return queries
}

interface ContextEntry {
  rating: FactCheckRating
  verdict: 'true' | 'false' | 'mixed'
}

function pickEntries(ratingsByQuery: FactCheckRating[][], maxEntries: number): ContextEntry[] {
  const seen = new Set<string>()
  const entries: ContextEntry[] = []

  // Round-robin across queries so a single chatty URL doesn't dominate.
  const maxLength = Math.max(...ratingsByQuery.map((r) => r.length), 0)
  for (let i = 0; i < maxLength && entries.length < maxEntries; i++) {
    for (const ratings of ratingsByQuery) {
      const rating = ratings[i]
      if (!rating) continue
      if (seen.has(rating.reviewUrl)) continue
      seen.add(rating.reviewUrl)
      entries.push({ rating, verdict: classifyFactCheckRating(rating.textualRating) })
      if (entries.length >= maxEntries) break
    }
  }
  return entries
}

export function CommunityContextNote({
  content,
  maxEntries = 3,
  className = '',
}: CommunityContextNoteProps) {
  const queries = useMemo(() => extractCandidateQueries(content), [content])

  const [ratingsByQuery, setRatingsByQuery] = useState<FactCheckRating[][]>(() =>
    queries.map((q) => peekFactCheck(q)?.ratings ?? []),
  )

  useEffect(() => {
    if (queries.length === 0) {
      setRatingsByQuery([])
      return
    }

    let cancelled = false
    void Promise.all(queries.map((q) => searchFactChecks(q))).then((results) => {
      if (cancelled) return
      setRatingsByQuery(results.map((r) => r.ratings))
    })

    return () => {
      cancelled = true
    }
  }, [queries])

  const entries = useMemo(() => pickEntries(ratingsByQuery, maxEntries), [ratingsByQuery, maxEntries])

  if (entries.length === 0) return null

  return (
    <aside
      role="note"
      aria-label="Independent fact-checker context"
      className={`
        rounded-2xl border border-[rgb(var(--color-separator))]
        bg-[rgb(var(--color-bg-secondary))]
        ${className}
      `}
    >
      <header className="flex items-center gap-2 px-4 pt-3 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--color-label-secondary))]">
          Readers may want context
        </span>
      </header>
      <p className="px-4 text-[12px] leading-snug text-[rgb(var(--color-label-tertiary))]">
        Independent fact-checkers indexed by Google have reviewed related
        claims. Ratings are from the publishers themselves, not from this
        platform.
      </p>

      <ul className="mt-2 divide-y divide-[rgb(var(--color-separator))]">
        {entries.map(({ rating, verdict }, index) => {
          const publisher = rating.publisherName ?? rating.publisherSite ?? 'Fact-checker'
          const claim = rating.claim?.trim()
          return (
            <li key={`${rating.reviewUrl}-${index}`} className="px-4 py-3">
              <a
                href={rating.reviewUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                onClick={(event) => event.stopPropagation()}
                className="block focus:outline-none"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${VERDICT_DOT[verdict]}`}
                    aria-hidden="true"
                  />
                  <span className="text-[12px] font-semibold text-[rgb(var(--color-label-secondary))]">
                    {VERDICT_LABEL[verdict]}
                  </span>
                  <span className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
                    · {publisher}
                  </span>
                </div>

                {claim && claim.length > 0 && (
                  <p className="mt-1.5 text-[14px] leading-snug text-[rgb(var(--color-label))] line-clamp-3">
                    “{claim}”
                  </p>
                )}

                <p className="mt-1 text-[13px] leading-snug text-[rgb(var(--color-label-secondary))]">
                  <span className="font-medium">Rating:</span>{' '}
                  <span className="italic">{rating.textualRating}</span>
                </p>

                <p className="mt-1 text-[12px] text-[rgb(var(--color-accent))]">
                  Read the review →
                </p>
              </a>
            </li>
          )
        })}
      </ul>

      <footer className="px-4 pt-1 pb-3">
        <p className="text-[11px] leading-snug text-[rgb(var(--color-label-tertiary))]">
          Source: Google Fact Check Tools. This panel is informational and
          does not reflect a moderation decision.
        </p>
      </footer>
    </aside>
  )
}
