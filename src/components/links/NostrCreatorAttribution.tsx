import React from 'react'
import { Link } from 'react-router-dom'
import { decode } from 'nostr-tools/nip19'
import { useProfile } from '@/hooks/useProfile'
import { getNip21Route } from '@/lib/nostr/nip21'

type NostrCreatorAttributionTone = 'default' | 'inverse'

interface NostrCreatorAttributionProps {
  nostrCreator: string
  nostrNip05?: string
  pageHostname?: string | null
  tone?: NostrCreatorAttributionTone
  className?: string
  showTopBorder?: boolean
}

function stopPropagation(event: React.MouseEvent<HTMLElement>) {
  event.stopPropagation()
}

function npubToPubkey(npub: string): string | null {
  try {
    const { type, data } = decode(npub)
    return type === 'npub' ? (data as string) : null
  } catch {
    return null
  }
}

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export function NostrCreatorAttribution({
  nostrCreator,
  nostrNip05,
  pageHostname,
  tone = 'default',
  className,
  showTopBorder = false,
}: NostrCreatorAttributionProps) {
  const pubkey = React.useMemo(() => npubToPubkey(nostrCreator), [nostrCreator])
  const { profile } = useProfile(pubkey)
  const route = getNip21Route(`nostr:${nostrCreator}`)
  const [imageFailed, setImageFailed] = React.useState(false)

  React.useEffect(() => {
    setImageFailed(false)
  }, [profile?.picture])

  const isVerified = Boolean(
    nostrNip05
    && pageHostname
    && nostrNip05.toLowerCase().endsWith(`@${pageHostname.toLowerCase()}`),
  )

  const displayName = profile?.display_name ?? profile?.name
  const identifier = nostrNip05 ?? `${nostrCreator.slice(0, 16)}…`
  const isInverse = tone === 'inverse'
  const accent = isInverse ? 'text-white/90 bg-white/12' : 'text-[#7B5EA7] bg-[#7B5EA7]/10'
  const placeholder = isInverse ? 'bg-white/15' : 'bg-[#7B5EA7]/20'
  const avatarBg = isInverse ? 'bg-white/10' : 'bg-[rgb(var(--color-fill)/0.08)]'
  const border = isInverse ? 'border-white/12' : 'border-[rgb(var(--color-fill)/0.08)]'
  const titleColor = isInverse ? 'text-white' : 'text-[rgb(var(--color-label))]'
  const secondaryColor = isInverse ? 'text-white/68' : 'text-[rgb(var(--color-label-tertiary))]'
  const iconStroke = isInverse ? 'white' : '#7B5EA7'
  const iconFill = isInverse ? 'white' : '#7B5EA7'

  const inner = (
    <div
      className={joinClasses(
        'flex items-center gap-2.5 px-3 py-2.5',
        showTopBorder && `border-t ${border}`,
        className,
      )}
    >
      <div className={joinClasses('h-8 w-8 shrink-0 overflow-hidden rounded-full', avatarBg)}>
        {profile?.picture && !imageFailed ? (
          <img
            src={profile.picture}
            alt=""
            width={32}
            height={32}
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className={joinClasses('flex h-full w-full items-center justify-center', placeholder)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill={iconFill} aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
            </svg>
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={joinClasses('truncate text-[13px] font-semibold leading-tight', titleColor)}>
            {displayName ?? identifier}
          </span>
          {isVerified && (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke={iconStroke}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
              aria-label="Verified — NIP-05 domain matches"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          )}
        </div>
        {displayName && (
          <p className={joinClasses('truncate text-[11px] leading-tight', secondaryColor)}>
            {identifier}
          </p>
        )}
      </div>

      <span className={joinClasses('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', accent)}>
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