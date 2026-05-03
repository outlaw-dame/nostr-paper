import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

export type MediaRevealReason =
  | 'unfollowed'
  | 'sensitive'
  | 'moderation_pending'
  | 'moderation_blocked'

const MEDIA_REVEAL_COPY: Record<MediaRevealReason, {
  label: string
  title: string
  description: string
}> = {
  unfollowed: {
    label: 'Unfollowed',
    title: "Media from someone you don't follow",
    description: 'Tap to reveal this media.',
  },
  sensitive: {
    label: 'Sensitive',
    title: 'Content warning',
    description: 'Tap to reveal this media.',
  },
  moderation_pending: {
    label: 'Checking',
    title: 'Checking media safety',
    description: 'Media is queued for safety review. Tap to reveal now.',
  },
  moderation_blocked: {
    label: 'Warning',
    title: 'Media warning',
    description: 'Safety models flagged this media. Tap only if you want to view it.',
  },
}

export function getMediaRevealReason(options: {
  blocked?: boolean
  loading?: boolean
  isSensitive?: boolean
  isUnfollowed?: boolean
}): MediaRevealReason | null {
  if (options.blocked) return 'moderation_blocked'
  if (options.isSensitive) return 'sensitive'
  if (options.isUnfollowed) return 'unfollowed'
  if (options.loading) return 'moderation_pending'
  return null
}

interface MediaRevealGateProps {
  children: ReactNode
  reason: MediaRevealReason | null
  className?: string
  style?: CSSProperties
  resetKey: string
  details?: string | null | undefined
}

export function MediaRevealGate({
  children,
  reason,
  className = '',
  style,
  resetKey,
  details,
}: MediaRevealGateProps) {
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    setRevealed(false)
  }, [resetKey, reason])

  if (!reason || revealed) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    )
  }

  const copy = MEDIA_REVEAL_COPY[reason]
  const description = reason === 'sensitive' && details
    ? `Content warning: ${details}`
    : copy.description

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setRevealed(true)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        setRevealed(true)
      }}
      className={`
        relative flex h-full min-h-[9rem] w-full select-none flex-col items-center justify-center
        overflow-hidden bg-[rgb(var(--color-bg-secondary))] px-4 py-6 text-center
        text-[rgb(var(--color-label))] transition-opacity active:opacity-85
        ${className}
      `}
      style={style}
      aria-label={`${copy.title}. Tap to reveal.`}
    >
      <div
        aria-hidden="true"
        className="
          absolute inset-0
          bg-[radial-gradient(circle_at_30%_20%,rgba(var(--color-fill),0.18),transparent_36%),linear-gradient(135deg,rgba(var(--color-fill),0.11),rgba(var(--color-fill),0.04))]
          blur-xl
        "
      />
      <div className="relative flex max-w-[18rem] flex-col items-center gap-2">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        </span>
        <span className="rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/86 backdrop-blur-md">
          {copy.label}
        </span>
        <span className="text-[14px] font-semibold leading-5 text-[rgb(var(--color-label))]">
          {copy.title}
        </span>
        <span className="text-[12px] leading-5 text-[rgb(var(--color-label-secondary))]">
          {description}
        </span>
        <span className="mt-1 rounded-full bg-[rgb(var(--color-fill)/0.12)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label))]">
          Tap to reveal
        </span>
      </div>
    </div>
  )
}
