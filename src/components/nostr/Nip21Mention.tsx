import React from 'react'
import { Link } from 'react-router-dom'
import { useProfile } from '@/hooks/useProfile'
import { getNip21Route, parseNip21Reference, type Nip21Reference } from '@/lib/nostr/nip21'
import { sanitizeText } from '@/lib/security/sanitize'

interface Nip21MentionProps {
  value: string
  interactive?: boolean
  className?: string | undefined
}

function stopPropagation(event: React.MouseEvent<HTMLElement>) {
  event.stopPropagation()
}

function formatBech32Value(value: string, maxChars = 18): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, Math.max(8, maxChars - 1))}…`
}

function getFallbackLabel(reference: Nip21Reference | null, originalValue: string): string {
  if (!reference) return sanitizeText(originalValue.trim() || originalValue)

  switch (reference.decoded.type) {
    case 'npub':
    case 'nprofile':
      return `@${formatBech32Value(reference.value, 14)}`
    case 'note':
    case 'nevent':
    case 'naddr':
      return formatBech32Value(reference.value, 18)
  }
}

function renderChip({
  label,
  title,
  route,
  interactive,
  className = '',
  humanized = false,
}: {
  label: string
  title: string
  route: string | null
  interactive: boolean
  className?: string | undefined
  humanized?: boolean
}) {
  const chipClass = [
    'inline-block rounded-md bg-[rgb(var(--color-fill)/0.12)] px-1.5 py-0.5 align-middle text-[13px] text-[rgb(var(--color-label-secondary))]',
    humanized ? 'font-medium' : 'font-mono',
    interactive && route ? 'transition-colors hover:bg-[rgb(var(--color-fill)/0.2)]' : '',
    className,
  ].filter(Boolean).join(' ')

  if (interactive && route) {
    return (
      <Link to={route} title={title} onClick={stopPropagation} className={chipClass}>
        {label}
      </Link>
    )
  }

  return (
    <span title={title} className={chipClass}>
      {label}
    </span>
  )
}

function ProfileMention({
  pubkey,
  referenceUri,
  fallbackLabel,
  interactive,
  className,
}: {
  pubkey: string
  referenceUri: string
  fallbackLabel: string
  interactive: boolean
  className?: string | undefined
}) {
  const { profile } = useProfile(pubkey, { background: true })
  const displayName = sanitizeText(profile?.display_name?.trim() || profile?.name?.trim() || '')
  const label = displayName
    ? `@${displayName}`
    : fallbackLabel

  return renderChip({
    label,
    title: referenceUri,
    route: getNip21Route(referenceUri),
    interactive,
    className,
    humanized: displayName.length > 0,
  })
}

export function Nip21Mention({
  value,
  interactive = true,
  className,
}: Nip21MentionProps) {
  const reference = React.useMemo(() => parseNip21Reference(value), [value])

  if (reference && (reference.decoded.type === 'npub' || reference.decoded.type === 'nprofile')) {
    const pubkey = reference.decoded.type === 'npub'
      ? reference.decoded.data
      : reference.decoded.data.pubkey

    return (
      <ProfileMention
        pubkey={pubkey}
        referenceUri={reference.uri}
        fallbackLabel={getFallbackLabel(reference, reference.uri)}
        interactive={interactive}
        className={className}
      />
    )
  }

  return renderChip({
    label: getFallbackLabel(reference, value),
    title: reference?.uri ?? value,
    route: getNip21Route(value),
    interactive,
    className,
  })
}
