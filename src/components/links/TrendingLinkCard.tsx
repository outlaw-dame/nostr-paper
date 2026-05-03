/**
 * TrendingLinkCard
 *
 * Compact list-item for trending links in the Explore "News" section.
 *
 *   ┌─────────────────────────────────────────┐
 *   │  [thumb 56×56]  Article title here      │
 *   │                 domain.com              │
 *   │                 12 discussing           │
 *   └─────────────────────────────────────────┘
 *
 * OG image thumbnails degrade to a neutral icon while moderation is pending
 * or flagged, so the list never jumps around or flashes unchecked media.
 */

import React, { useMemo } from 'react'
import { useLinkPreview } from '@/hooks/useLinkPreview'
import { useMediaModerationDocument } from '@/hooks/useMediaModeration'
import { useRuntimeFeatureFlags } from '@/hooks/useRuntimeFeatureFlags'
import { buildMediaModerationDocument } from '@/lib/moderation/mediaContent'
import { recordSourceExposure } from '@/lib/media/sourceExposure'
import { SourceLensBadge } from '@/components/links/SourceLensBadge'
import { tApp } from '@/lib/i18n/app'
import type { TrendingLinkStat } from '@/lib/explore/trendingLinks'

interface TrendingLinkCardProps {
  stat:    TrendingLinkStat
  onClick: (url: string) => void
}

export function TrendingLinkCard({ stat, onClick }: TrendingLinkCardProps) {
  const flags = useRuntimeFeatureFlags()
  const { data: og, loading: ogLoading } = useLinkPreview(stat.url)
  const [thumbFailed, setThumbFailed] = React.useState(false)

  const thumbModerationDoc = useMemo(
    () => og?.image
      ? buildMediaModerationDocument({ id: `og:${og.image}`, kind: 'image', url: og.image, updatedAt: 0 })
      : null,
    [og?.image],
  )
  const { blocked: thumbBlocked, loading: thumbModerationLoading } = useMediaModerationDocument(thumbModerationDoc)

  const showThumb =
    Boolean(og?.image) &&
    !thumbFailed &&
    !thumbBlocked &&
    !thumbModerationLoading

  // Skeleton while OG data is in-flight
  if (ogLoading) {
    return (
      <div className="flex items-center gap-3 px-1 py-2">
        <div className="skeleton h-14 w-14 shrink-0 rounded-[10px]" />
        <div className="flex-1 space-y-1.5">
          <div className="skeleton h-3.5 w-3/4 rounded" />
          <div className="skeleton h-3   w-1/3 rounded" />
          <div className="skeleton h-3   w-1/4 rounded" />
        </div>
      </div>
    )
  }

  const title  = og?.title ?? stat.domain
  const domain = stat.domain

  const handlePress = () => {
    if (flags.phase4MediaDietTracking) {
      recordSourceExposure(stat.domain || stat.url, 'trending-link')
    }
    onClick(stat.url)
  }

  return (
    <button
      type="button"
      onClick={handlePress}
      className="
        flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5
        app-panel-muted border border-[rgb(var(--color-fill)/0.10)]
        text-left transition-all active:scale-[0.98] active:opacity-75
      "
    >
      {/* Thumbnail */}
      {showThumb && (
        <img
          src={og!.image}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setThumbFailed(true)}
          className="h-14 w-14 shrink-0 rounded-[10px] object-cover bg-[rgb(var(--color-fill)/0.08)]"
        />
      )}
      {!showThumb && (
        <div
          aria-hidden
          className="
            h-14 w-14 shrink-0 rounded-[10px]
            bg-[rgb(var(--color-fill)/0.10)]
            flex items-center justify-center
          "
        >
          <svg
            width="22" height="22" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.5"
            className="text-[rgb(var(--color-label-tertiary))]"
            aria-hidden
          >
            <path
              strokeLinecap="round" strokeLinejoin="round"
              d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
            />
          </svg>
        </div>
      )}

      {/* Text */}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="line-clamp-2 text-[14px] font-medium leading-snug text-[rgb(var(--color-label))]">
          {title}
        </p>
        <p className="truncate text-[12px] text-[rgb(var(--color-label-tertiary))]">
          {domain}
        </p>
        <p className="text-[11px] text-[rgb(var(--color-label-tertiary))]">
          {tApp('exploreNewsDiscussing', { count: String(stat.uniqueAuthorCount) })}
        </p>
        {flags.phase3SourceLensBadges && (
          <div className="pt-0.5">
            <SourceLensBadge domainOrUrl={domain} compact />
          </div>
        )}
      </div>

      {/* Chevron */}
      <svg
        width="7" height="12" viewBox="0 0 7 12" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className="shrink-0 text-[rgb(var(--color-label-tertiary))] opacity-60"
        aria-hidden
      >
        <path d="M1 1l5 5-5 5" />
      </svg>
    </button>
  )
}
