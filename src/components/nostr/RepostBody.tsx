import { EventPreviewCard } from '@/components/nostr/EventPreviewCard'
import { useAddressableEvent } from '@/hooks/useAddressableEvent'
import { useEvent } from '@/hooks/useEvent'
import { parseAddressCoordinate } from '@/lib/nostr/addressable'
import { parseRepostEvent } from '@/lib/nostr/repost'
import type { NostrEvent } from '@/types'

interface RepostBodyProps {
  event: NostrEvent
  className?: string
  compact?: boolean
  linked?: boolean
}

function RepostIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 1l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 23l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  )
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

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center gap-1.5">
        <RepostIcon />
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
          Repost
        </p>
      </div>

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
