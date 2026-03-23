import { EventPreviewCard } from '@/components/nostr/EventPreviewCard'
import { useAddressableEvent } from '@/hooks/useAddressableEvent'
import { useEvent } from '@/hooks/useEvent'
import { parseAddressCoordinate } from '@/lib/nostr/addressable'
import { parseRepostEvent } from '@/lib/nostr/repost'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

interface RepostBodyProps {
  event: NostrEvent
  className?: string
  compact?: boolean
  linked?: boolean
}

export function RepostBody({
  event,
  className = '',
  compact = false,
  linked = true,
}: RepostBodyProps) {
  const repost = parseRepostEvent(event)
  const targetAddress = repost?.targetAddress ? parseAddressCoordinate(repost.targetAddress) : null
  const fallbackTargetId = repost?.embeddedEvent ? null : repost?.targetEventId
  const { event: fetchedTarget, loading: eventLoading } = useEvent(fallbackTargetId)
  const { event: addressTarget, loading: addressLoading } = useAddressableEvent({
    pubkey: targetAddress?.pubkey,
    kind: targetAddress?.kind,
    identifier: targetAddress?.identifier,
  })
  const targetEvent = repost?.embeddedEvent ?? addressTarget ?? fetchedTarget
  const loading = eventLoading || addressLoading

  if (!repost) return null

  const label = repost.repostKind === Kind.GenericRepost ? 'Reposted Event' : 'Reposted Note'

  return (
    <div className={`space-y-3 ${className}`}>
      <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
        {label}
      </p>

      {targetEvent ? (
        <EventPreviewCard event={targetEvent} compact={compact} linked={linked} />
      ) : (
        <div className="rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3">
          <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
            {loading ? 'Loading repost target…' : 'Repost target unavailable.'}
          </p>
        </div>
      )}
    </div>
  )
}
