/**
 * LinkPreviewCard
 *
 * Open Graph link preview with Nostr author attribution.
 *
 * Layout mirrors the Mastodon fediverse:creator pattern — the Nostr author
 * identity is a prominent separate row at the bottom of the card, not a
 * tiny chip buried in the footer.
 *
 *   ┌─────────────────────────────────┐
 *   │  [OG Image — 1.91:1]            │
 *   ├─────────────────────────────────┤
 *   │  Article Title                  │
 *   │  By Sara Perez                  │  ← OG/JSON-LD author name
 *   │  techcrunch.com                 │  ← domain
 *   ├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤  (only when nostr:creator present)
 *   │  [avatar] Display Name      ✓  │  ← Nostr profile, ✓ = NIP-05 domain match
 *   │           user@domain.com       │
 *   ├─────────────────────────────────┤  (only when onDiscussionsPress provided + count > 0)
 *   │  3 discussing               ›  │
 *   └─────────────────────────────────┘
 *
 * Verification rule (analogous to Mastodon's domain verification):
 *   The nostr:creator attribution is marked verified (✓) when the
 *   nostr:creator:nip05 identifier's domain matches the page domain.
 *   e.g. page is techcrunch.com, nip05 is sara@techcrunch.com → verified.
 *
 * Discussion row:
 *   Appears only when the caller passes onDiscussionsPress AND the local
 *   link_mentions table has at least one indexed post for this URL.
 *   The outer wrapper is a <div> (not <a>) so that the sibling <button>
 *   is valid HTML — nesting interactive elements is forbidden.
 */

import React, { useMemo, useCallback } from 'react'
import { useLinkPreview } from '@/hooks/useLinkPreview'
import { useLinkDiscussionCount } from '@/hooks/useLinkDiscussionCount'
import { useMediaModerationDocument } from '@/hooks/useMediaModeration'
import { buildMediaModerationDocument } from '@/lib/moderation/mediaContent'
import { NostrCreatorAttribution } from '@/components/links/NostrCreatorAttribution'
import { MediaRevealGate, getMediaRevealReason } from '@/components/media/MediaRevealGate'
import { FactCheckBadge } from '@/components/security/FactCheckBadge'
import { tApp } from '@/lib/i18n/app'
import type { OGData } from '@/lib/og/types'

// ── Helpers ──────────────────────────────────────────────────

function stopPropagation(e: React.MouseEvent) {
  e.stopPropagation()
}

function hostname(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, '') }
  catch { return null }
}

// ── Main Card ─────────────────────────────────────────────────

interface LinkPreviewCardProps {
  url:        string
  className?: string
  previewData?: OGData | null | undefined
  previewLoading?: boolean | undefined
  /** When provided, a discussion count row is shown and clicking navigates to the link timeline. */
  onDiscussionsPress?: ((url: string) => void) | undefined
}

export function LinkPreviewCard({
  url,
  className = '',
  previewData,
  previewLoading,
  onDiscussionsPress,
}: LinkPreviewCardProps) {
  const previewState = useLinkPreview(
    previewData === undefined && previewLoading === undefined ? url : null,
  )
  const data = previewData === undefined ? previewState.data : previewData
  const loading = previewLoading === undefined ? previewState.loading : previewLoading
  const [imageFailed, setImageFailed] = React.useState(false)
  const [faviconFailed, setFaviconFailed] = React.useState(false)

  // Only query discussion count when a handler is wired up — skip the DB
  // round-trip in ComposeSheet (authoring) and LinkTimelinePage (circular).
  const { count } = useLinkDiscussionCount(url, { enabled: Boolean(onDiscussionsPress) })

  // Moderate the OG image before rendering — fail closed so explicit images
  // from shared links never flash through unreviewed.
  const ogImageModerationDoc = useMemo(
    () => data?.image
      ? buildMediaModerationDocument({ id: `og:${data.image}`, kind: 'image', url: data.image, updatedAt: 0 })
      : null,
    [data?.image],
  )
  const { blocked: ogImageBlocked, loading: ogImageModerationLoading } = useMediaModerationDocument(ogImageModerationDoc)
  const ogImageRevealReason = getMediaRevealReason({
    blocked: ogImageModerationDoc !== null && ogImageBlocked,
    loading: ogImageModerationDoc !== null && ogImageModerationLoading,
  })

  const handleDiscussionsClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onDiscussionsPress?.(url)
  }, [onDiscussionsPress, url])

  const showDiscussions = Boolean(onDiscussionsPress) && count.postCount > 0

  // Skeleton while fetching
  if (loading) {
    return (
      <div className={`
        mt-3 overflow-hidden rounded-ios-xl
        border border-[rgb(var(--color-fill)/0.10)]
        ${className}
      `}>
        <div className="skeleton h-40 w-full" />
        <div className="space-y-2 px-3 py-2.5">
          <div className="skeleton h-3.5 w-3/4 rounded" />
          <div className="skeleton h-3 w-1/3 rounded" />
          <div className="skeleton h-3 w-1/4 rounded" />
        </div>
      </div>
    )
  }

  if (!data) return null

  const host = hostname(data.url)

  return (
    // Outer <div> is required so the discussion <button> is a sibling of
    // the link <a> — nesting interactive elements is invalid HTML.
    <div className={`
      mt-3 overflow-hidden rounded-ios-xl
      border border-[rgb(var(--color-fill)/0.10)]
      bg-[rgb(var(--color-bg-secondary))]
      ${className}
    `}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        onClick={stopPropagation}
        className="block transition-opacity active:opacity-70"
      >
        {/* OG Image — warning-gated while moderation is pending or flagged. */}
        {data.image && !imageFailed && (
          <div className="aspect-[1.91/1] w-full overflow-hidden bg-[rgb(var(--color-fill)/0.06)]">
            <MediaRevealGate
              reason={ogImageRevealReason}
              resetKey={`${data.image}:${ogImageRevealReason ?? 'none'}`}
              className="h-full w-full"
            >
              <img
                src={data.image}
                alt=""
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setImageFailed(true)}
                className="h-full w-full object-cover"
              />
            </MediaRevealGate>
          </div>
        )}

        {/* Title + author + domain */}
        <div className="px-3 py-2.5 space-y-0.5">
          {data.title && (
            <p className="
              text-[15px] font-semibold leading-snug
              text-[rgb(var(--color-label))]
              line-clamp-2
            ">
              {data.title}
            </p>
          )}

          {data.author && (
            <p className="text-[13px] text-[rgb(var(--color-label-secondary))] leading-snug">
              By {data.author}
            </p>
          )}

          {/* Domain row */}
          {host && (
            <div className="flex items-center gap-1.5 pt-0.5">
              {data.favicon && !faviconFailed && (
                <img
                  src={data.favicon}
                  alt=""
                  width={13}
                  height={13}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={() => setFaviconFailed(true)}
                  className="rounded-sm shrink-0 opacity-60"
                />
              )}
              <span className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
                {host}
              </span>
            </div>
          )}

          {/* Google Fact Check Tools rating, if any */}
          {data.title && (
            <div className="pt-1">
              <FactCheckBadge query={data.title} compact />
            </div>
          )}
        </div>

        {/* Nostr author attribution — shown when nostr:creator is present.
            This is the "More from X" equivalent from the Mastodon fediverse:creator spec. */}
        {data.nostrCreator && (
          <NostrCreatorAttribution
            nostrCreator={data.nostrCreator}
            {...(data.nostrNip05 !== undefined ? { nostrNip05: data.nostrNip05 } : {})}
            pageHostname={host}
            showTopBorder
          />
        )}
      </a>

      {/* Discussion count row — only shown when caller provides handler + we have local posts */}
      {showDiscussions && (
        <button
          type="button"
          onClick={handleDiscussionsClick}
          className="
            flex w-full items-center justify-between px-3 py-2
            border-t border-[rgb(var(--color-fill)/0.08)]
            text-left transition-opacity active:opacity-70
          "
        >
          <span className="text-[12px] text-[rgb(var(--color-label-secondary))]">
            {tApp('exploreNewsDiscussing', { count: String(count.postCount) })}
          </span>
          <svg
            width="6" height="10" viewBox="0 0 6 10"
            fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            className="text-[rgb(var(--color-label-tertiary))] shrink-0"
            aria-hidden
          >
            <path d="M1 1l4 4-4 4" />
          </svg>
        </button>
      )}
    </div>
  )
}
