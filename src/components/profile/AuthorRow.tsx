/**
 * AuthorRow
 *
 * Displays author avatar, name, and relative timestamp.
 * Light prop for use on dark/media backgrounds.
 * Large prop for expanded note view.
 */

import { useEffect, useMemo, useState } from 'react'
import { useUserStatus } from '@/hooks/useUserStatus'
import { getUserStatusLabel } from '@/lib/nostr/status'
import { TwemojiText } from '@/components/ui/TwemojiText'
import { formatNip05Identifier } from '@/lib/nostr/nip05'
import { sanitizeName } from '@/lib/security/sanitize'
import type { Profile } from '@/types'

const failedImageUrls = new Map<string, number>()
const FAILED_IMAGE_RETRY_MS = 60_000

function hasRecentImageFailure(url: string | null | undefined): boolean {
  if (!url) return false
  const failedAt = failedImageUrls.get(url)
  if (!failedAt) return false
  if (Date.now() - failedAt <= FAILED_IMAGE_RETRY_MS) return true
  failedImageUrls.delete(url)
  return false
}

interface AuthorRowProps {
  pubkey:     string
  profile:    Profile | null
  timestamp?: number
  light?:     boolean  // White text, for dark backgrounds
  large?:     boolean  // Expanded view sizing
  onAvatarClick?: () => void
}

export function AuthorRow({
  pubkey,
  profile,
  timestamp,
  light = false,
  large = false,
  onAvatarClick,
}: AuthorRowProps) {
  const { status } = useUserStatus(pubkey, { background: false })
  const displayName = useMemo(() => {
    if (profile?.display_name) return sanitizeName(profile.display_name)
    if (profile?.name)         return sanitizeName(profile.name)
    return `${pubkey.slice(0, 8)}…`
  }, [profile, pubkey])
  const musicStatusLabel = useMemo(() => {
    if (!status || status.identifier !== 'music') return null
    return getUserStatusLabel(status)
  }, [status])

  const relativeTime = useMemo(() => {
    if (!timestamp) return ''
    return formatRelativeTime(timestamp)
  }, [timestamp])

  const labelColor = light
    ? 'text-white'
    : 'text-[rgb(var(--color-label))]'

  const secondaryColor = light
    ? 'text-white/60'
    : 'text-[rgb(var(--color-label-secondary))]'

  return (
    <div className="flex items-center gap-3">
      {/* Avatar */}
      <Avatar
        src={profile?.picture ?? null}
        name={displayName}
        pubkey={pubkey}
        size={large ? 44 : 36}
        {...(onAvatarClick ? { onClick: onAvatarClick } : {})}
      />

      {/* Name + timestamp */}
      <div className="flex-1 min-w-0">
        <p className={`
          font-semibold truncate leading-tight
          ${large ? 'text-[17px]' : 'text-[15px]'}
          ${labelColor}
        `}>
          <TwemojiText text={displayName} />
        </p>

        {large && profile?.nip05 && profile.nip05Verified && (
          <p className={`text-[12px] leading-tight mt-0.5 ${secondaryColor}`}>
            {formatNip05Identifier(profile.nip05)}
          </p>
        )}

        {musicStatusLabel && (
          <p className={`text-[12px] leading-tight mt-0.5 ${secondaryColor}`}>
            <TwemojiText text={`♪ ${musicStatusLabel}`} />
          </p>
        )}

        {relativeTime && (
          <p className={`
            text-[13px] leading-tight mt-0.5
            ${secondaryColor}
          `}>
            {relativeTime}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Avatar ───────────────────────────────────────────────────

interface AvatarProps {
  src?:    string | null
  name:    string
  pubkey:  string
  size:    number
  onClick?: () => void
}

function Avatar({ src, name, pubkey, size, onClick }: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(() => hasRecentImageFailure(src))
  const initial  = (name[0] ?? '?').toUpperCase()
  const bgColor  = pubkeyToColor(pubkey)

  useEffect(() => {
    setImgFailed(hasRecentImageFailure(src))
  }, [src])

  const showImage = src && !imgFailed
  const interactive = Boolean(showImage && onClick)
  const commonClassName = [
    'rounded-full overflow-hidden flex-shrink-0 border border-[rgb(var(--color-divider)/0.08)]',
    interactive ? 'cursor-zoom-in transition-transform active:scale-[0.98]' : '',
  ].join(' ').trim()
  const commonStyle = { width: size, height: size, backgroundColor: bgColor }
  const avatarLabel = interactive ? `Open ${name}'s avatar` : `${name}'s avatar`

  const content = showImage ? (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      // These avatars are not read back from canvas, so forcing CORS only
      // breaks otherwise valid third-party image loads.
      referrerPolicy="no-referrer"
      className="w-full h-full object-cover"
      onError={() => {
        if (src) failedImageUrls.set(src, Date.now())
        setImgFailed(true)
      }}
    />
  ) : (
    <span className="
      w-full h-full flex items-center justify-center
      text-white font-semibold
      text-[13px]
    ">
      {initial}
    </span>
  )

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={commonClassName}
        style={commonStyle}
        aria-label={avatarLabel}
      >
        {content}
      </button>
    )
  }

  return (
    <div
      className={commonClassName}
      style={commonStyle}
      role="img"
      aria-label={avatarLabel}
    >
      {content}
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────

/** Deterministic color from pubkey */
function pubkeyToColor(pubkey: string): string {
  const h = parseInt(pubkey.slice(0, 6), 16) % 360
  const s = 50 + (parseInt(pubkey.slice(6, 8), 16) % 30)
  return `hsl(${h}, ${s}%, 38%)`
}

/** Human-readable relative time */
function formatRelativeTime(timestamp: number): string {
  const now   = Math.floor(Date.now() / 1000)
  const delta = now - timestamp

  if (delta < 0)        return 'just now'
  if (delta < 60)       return `${delta}s`
  if (delta < 3_600)    return `${Math.floor(delta / 60)}m`
  if (delta < 86_400)   return `${Math.floor(delta / 3_600)}h`
  if (delta < 604_800)  return `${Math.floor(delta / 86_400)}d`

  const date = new Date(timestamp * 1000)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
