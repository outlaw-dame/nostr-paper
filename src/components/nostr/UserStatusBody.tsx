import { Link } from 'react-router-dom'
import { EventPreviewCard } from '@/components/nostr/EventPreviewCard'
import { TwemojiText } from '@/components/ui/TwemojiText'
import { useAddressableEvent } from '@/hooks/useAddressableEvent'
import { useEvent } from '@/hooks/useEvent'
import {
  getUserStatusExternalHref,
  getUserStatusLabel,
  getUserStatusRoute,
  parseUserStatusEvent,
} from '@/lib/nostr/status'
import { parseAddressCoordinate } from '@/lib/nostr/addressable'
import type { NostrEvent } from '@/types'

interface UserStatusBodyProps {
  event: NostrEvent
  className?: string
  compact?: boolean
  linkedPreview?: boolean
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

export function UserStatusBody({
  event,
  className = '',
  compact = false,
  linkedPreview = true,
}: UserStatusBodyProps) {
  const status = parseUserStatusEvent(event)
  const targetAddress = status?.targetAddress ? parseAddressCoordinate(status.targetAddress) : null
  const { event: targetEvent, loading: targetLoading } = useEvent(status?.targetEventId)
  const { event: addressEvent, loading: addressLoading } = useAddressableEvent({
    pubkey: targetAddress?.pubkey,
    kind: targetAddress?.kind,
    identifier: targetAddress?.identifier,
  })

  if (!status) return null

  const route = getUserStatusRoute(status)
  const externalHref = getUserStatusExternalHref(status)
  const previewEvent = addressEvent ?? targetEvent
  const loading = targetLoading || addressLoading
  const label = status.identifier === 'music' ? 'Listening Now' : 'User Status'

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
        <span>{label}</span>
        {status.isExpired && <span>Expired</span>}
        {status.expiresAt !== undefined && (
          <span>Ends {new Date(status.expiresAt * 1000).toLocaleString()}</span>
        )}
      </div>

      <p className={compact ? 'text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]' : 'text-[16px] leading-7 text-[rgb(var(--color-label))]'}>
        <TwemojiText text={getUserStatusLabel(status)} />
      </p>

      {!status.isCleared && route && (
        <Link
          to={route}
          className="inline-flex items-center gap-2 rounded-full bg-[rgb(var(--color-fill)/0.09)] px-3 py-1.5 text-[13px] font-medium text-[rgb(var(--color-label))]"
        >
          Open linked Nostr item
        </Link>
      )}

      {!status.isCleared && externalHref && (
        <a
          href={externalHref}
          {...(isHttpUrl(externalHref) ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : { rel: 'nofollow' })}
          className="inline-flex items-center gap-2 rounded-full bg-[rgb(var(--color-fill)/0.09)] px-3 py-1.5 text-[13px] font-medium text-[rgb(var(--color-label))]"
        >
          Open track
        </a>
      )}

      {previewEvent ? (
        <EventPreviewCard event={previewEvent} compact linked={linkedPreview} />
      ) : (status.targetEventId || status.targetAddress) ? (
        <div className="rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3">
          <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
            {loading ? 'Loading linked Nostr item…' : 'Linked Nostr item unavailable.'}
          </p>
        </div>
      ) : null}
    </div>
  )
}
