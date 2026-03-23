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
import { Link } from 'react-router-dom'
import { decode } from 'nostr-tools/nip19'
import { useLinkPreview } from '@/hooks/useLinkPreview'
import { useProfile } from '@/hooks/useProfile'
import { getNip21Route } from '@/lib/nostr/nip21'
import type { OGData } from '@/lib/og/types'

// ── Helpers ──────────────────────────────────────────────────

function stopPropagation(e: React.MouseEvent) {
  e.stopPropagation()
}

function npubToPubkey(npub: string): string | null {
  try {
    const { type, data } = decode(npub)
    return type === 'npub' ? (data as string) : null
  } catch {
    return null
  }
}

function hostname(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, '') }
  catch { return null }
}

// ── Nostr Author Row ─────────────────────────────────────────

interface NostrAuthorRowProps {
  nostrCreator: string
  nostrNip05:   string | undefined
  pageHostname: string | null
}

function NostrAuthorRow({ nostrCreator, nostrNip05, pageHostname }: NostrAuthorRowProps) {
  const pubkey  = React.useMemo(() => npubToPubkey(nostrCreator), [nostrCreator])
  const { profile } = useProfile(pubkey)
  const route   = getNip21Route(`nostr:${nostrCreator}`)
  const [imageFailed, setImageFailed] = React.useState(false)

  React.useEffect(() => {
    setImageFailed(false)
  }, [profile?.picture])

  // Verified when the NIP-05 identifier's domain matches the page's domain —
  // the Nostr equivalent of Mastodon requiring the creator to add the domain.
  const isVerified = Boolean(
    nostrNip05 &&
    pageHostname &&
    nostrNip05.toLowerCase().endsWith(`@${pageHostname.toLowerCase()}`)
  )

  const displayName = profile?.display_name ?? profile?.name
  const identifier  = nostrNip05 ?? (nostrCreator.slice(0, 16) + '…')

  const inner = (
    <div className="
      flex items-center gap-2.5
      px-3 py-2.5
      border-t border-[rgb(var(--color-fill)/0.08)]
    ">
      {/* Avatar */}
      <div className="w-8 h-8 shrink-0 rounded-full overflow-hidden bg-[rgb(var(--color-fill)/0.08)]">
        {profile?.picture && !imageFailed ? (
          <img
            src={profile.picture}
            alt=""
            width={32}
            height={32}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          /* Placeholder — purple Nostr dot */
          <div className="w-full h-full flex items-center justify-center bg-[#7B5EA7]/20">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#7B5EA7" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
            </svg>
          </div>
        )}
      </div>

      {/* Name + identifier */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="
            text-[13px] font-semibold leading-tight
            text-[rgb(var(--color-label))]
            truncate
          ">
            {displayName ?? identifier}
          </span>
          {isVerified && (
            <svg
              width="13" height="13" viewBox="0 0 24 24"
              fill="none" stroke="#7B5EA7" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round"
              className="shrink-0"
              aria-label="Verified — NIP-05 domain matches"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          )}
        </div>
        {displayName && (
          <p className="text-[11px] text-[rgb(var(--color-label-tertiary))] truncate leading-tight">
            {identifier}
          </p>
        )}
      </div>

      {/* "On Nostr" label */}
      <span className="
        shrink-0 text-[11px] font-medium
        text-[#7B5EA7]
        bg-[#7B5EA7]/10
        px-2 py-0.5 rounded-full
      ">
        on Nostr
      </span>
    </div>
  )

  if (route) {
    return (
      <Link to={route} onClick={stopPropagation}>
        {inner}
      </Link>
    )
  }
  return inner
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
        <NostrAuthorRow
          nostrCreator={data.nostrCreator}
          nostrNip05={data.nostrNip05}
          pageHostname={host}
        />
      )}
    </a>
  )
}
