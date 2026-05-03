/**
 * LinkTimelinePage
 *
 * Shows all locally-cached posts that reference a specific URL — the Nostr
 * equivalent of Mastodon's GET /api/v1/timelines/link?url= endpoint.
 *
 * Layout:
 *   ┌──────────────────────────────────┐
 *   │  ← Back          Discussing      │
 *   ├──────────────────────────────────┤
 *   │  [Open Graph card for the URL]   │
 *   │  N people discussing             │
 *   ├──────────────────────────────────┤
 *   │  Post 1                          │
 *   │  Post 2                          │
 *   │  ...                             │
 *   │  [Load more]                     │
 *   └──────────────────────────────────┘
 *
 * URL is passed as the `url` query parameter (/link?url=<encoded>).
 * Invalid or missing URLs render a graceful empty state.
 */

import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { LinkPreviewCard } from '@/components/links/LinkPreviewCard'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { NoteContent } from '@/components/cards/NoteContent'
import { useLinkPreview } from '@/hooks/useLinkPreview'
import { useProfile } from '@/hooks/useProfile'
import { useLinkTimeline } from '@/hooks/useLinkTimeline'
import { getImetaHiddenUrls } from '@/lib/nostr/imeta'
import { tApp } from '@/lib/i18n/app'
import type { NostrEvent } from '@/types'

// ── Sub-components ───────────────────────────────────────────

function LinkTimelineEvent({
  event,
  index,
}: {
  event: NostrEvent
  index: number
}) {
  const { profile } = useProfile(event.pubkey, { background: false })
  const hiddenUrls  = getImetaHiddenUrls(event)

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay: Math.min(index * 0.03, 0.3) }}
      className="app-panel rounded-ios-xl p-4 card-elevated"
    >
      <AuthorRow
        pubkey={event.pubkey}
        profile={profile}
        timestamp={event.created_at}
      />
      <div className="mt-2">
        <NoteContent
          content={event.content}
          hiddenUrls={hiddenUrls}
          compact={false}
          interactive={false}
          allowTranslation={false}
        />
      </div>
    </motion.article>
  )
}

// ── Page ─────────────────────────────────────────────────────

export default function LinkTimelinePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const rawUrl = searchParams.get('url') ?? ''

  // Only feed a valid http(s) URL into the hooks; bad input → empty state
  const url = (() => {
    if (!rawUrl) return null
    try {
      const p = new URL(rawUrl)
      return p.protocol === 'https:' || p.protocol === 'http:' ? rawUrl : null
    } catch {
      return null
    }
  })()

  const { data: og, loading: ogLoading } = useLinkPreview(url)
  const { events, loading, loadMore, hasMore } = useLinkTimeline(url)

  return (
    <div className="min-h-screen">

      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 app-panel border-b border-[rgb(var(--color-fill)/0.10)]">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="
            -ml-1 flex h-9 w-9 items-center justify-center rounded-full
            text-[rgb(var(--color-label))] transition-opacity active:opacity-60
          "
          aria-label={tApp('linkTimelineBack')}
        >
          <svg width="10" height="16" viewBox="0 0 10 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 1 2 8l7 7" />
          </svg>
        </button>
        <h1 className="flex-1 text-[17px] font-semibold text-[rgb(var(--color-label))]">
          {tApp('linkTimelineTitle')}
        </h1>
      </div>

      <div className="px-4 pb-safe pb-8 space-y-4 mt-4">

        {/* OG card */}
        {url && (
          <LinkPreviewCard
            url={url}
            previewData={og}
            previewLoading={ogLoading}
          />
        )}

        {/* Discussion count */}
        {!url ? (
          <p className="text-center text-[14px] text-[rgb(var(--color-label-tertiary))] mt-8">
            {tApp('linkTimelineNoPosts')}
          </p>
        ) : (
          <>
            {events.length > 0 && (
              <p className="px-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                {tApp('exploreNewsDiscussing', { count: String(events.length) })}
                {hasMore ? '+' : ''}
              </p>
            )}

            {/* Event list */}
            <div className="space-y-3">
              {events.map((event, i) => (
                <LinkTimelineEvent key={event.id} event={event} index={i} />
              ))}
            </div>

            {/* Loading skeleton */}
            {loading && events.length === 0 && (
              <div className="space-y-3 mt-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-[96px] rounded-ios-xl bg-[rgb(var(--color-fill)/0.08)] animate-pulse" />
                ))}
              </div>
            )}

            {/* Empty state */}
            {!loading && events.length === 0 && (
              <p className="text-center text-[14px] text-[rgb(var(--color-label-tertiary))] mt-8">
                {tApp('linkTimelineNoPosts')}
              </p>
            )}

            {/* Load more */}
            {hasMore && events.length > 0 && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loading}
                  className="
                    px-5 py-2 rounded-full text-[14px] font-medium
                    bg-[rgb(var(--color-accent))] text-white
                    disabled:opacity-50 transition-opacity active:opacity-80
                  "
                >
                  {loading ? tApp('linkTimelineLoading') : tApp('linkTimelineLoadMore')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
