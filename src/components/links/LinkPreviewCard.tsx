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
 *   └─────────────────────────────────┘
 *
 * Verification rule (analogous to Mastodon's domain verification):
 *   The nostr:creator attribution is marked verified (✓) when the
 *   nostr:creator:nip05 identifier's domain matches the page domain.
 *   e.g. page is techcrunch.com, nip05 is sara@techcrunch.com → verified.
 */

import React from 'react'
import { useLinkPreview } from '@/hooks/useLinkPreview'
import { NostrCreatorAttribution } from '@/components/links/NostrCreatorAttribution'
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
}

export function LinkPreviewCard({
  url,
  className = '',
  previewData,
  previewLoading,
}: LinkPreviewCardProps) {
  const previewState = useLinkPreview(
    previewData === undefined && previewLoading === undefined ? url : null,
  )
  const data = previewData === undefined ? previewState.data : previewData
  const loading = previewLoading === undefined ? previewState.loading : previewLoading
  const [imageFailed, setImageFailed] = React.useState(false)
  const [faviconFailed, setFaviconFailed] = React.useState(false)

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
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={stopPropagation}
      className={`
        mt-3 block overflow-hidden rounded-ios-xl
        border border-[rgb(var(--color-fill)/0.10)]
        bg-[rgb(var(--color-bg-secondary))]
        transition-opacity active:opacity-70
        ${className}
      `}
    >
      {/* OG Image */}
      {data.image && !imageFailed && (
        <div className="aspect-[1.91/1] w-full overflow-hidden bg-[rgb(var(--color-fill)/0.06)]">
          <img
            src={data.image}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover"
          />
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
      </div>

      {/* Nostr author attribution — shown when nostr:creator is present.
          This is the "More from X" equivalent from the Mastodon fediverse:creator spec. */}
      {data.nostrCreator && (
        <NostrCreatorAttribution
          nostrCreator={data.nostrCreator}
          nostrNip05={data.nostrNip05}
          pageHostname={host}
          showTopBorder
        />
      )}
    </a>
  )
}
