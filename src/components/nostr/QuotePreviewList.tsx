import { useAddressableEvent } from '@/hooks/useAddressableEvent'
import { useEvent } from '@/hooks/useEvent'
import { useEventModeration } from '@/hooks/useModeration'
import { EventPreviewCard } from '@/components/nostr/EventPreviewCard'
import { tApp } from '@/lib/i18n/app'
import { parseAddressCoordinate } from '@/lib/nostr/addressable'
import { decodeAddressReference, decodeEventReference } from '@/lib/nostr/nip21'
import { parseQuoteTags } from '@/lib/nostr/repost'
import { extractNostrURIs } from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'

interface QuotePreviewListProps {
  event: NostrEvent
  className?: string
  compact?: boolean
  linked?: boolean
  maxItems?: number
  showHeader?: boolean
  translationSyncGroup?: string
}

function QuoteReferenceCard({
  reference,
  compact,
  linked,
  translationSyncGroup,
}: {
  reference: ReturnType<typeof parseQuoteTags>[number]
  compact: boolean
  linked: boolean
  translationSyncGroup?: string
}) {
  const address = reference.address ? parseAddressCoordinate(reference.address) : null
  const eventState = useEvent(reference.eventId)
  const addressState = useAddressableEvent({
    pubkey: address?.pubkey,
    kind: address?.kind,
    identifier: address?.identifier,
  })

  const targetEvent = eventState.event ?? addressState.event
  const {
    blocked,
    loading: moderationLoading,
    decision,
  } = useEventModeration(targetEvent)
  const loading = eventState.loading || addressState.loading
  const blockedByTagr = blocked && (decision?.reason?.startsWith('tagr:') ?? false)

  if (targetEvent && blockedByTagr) {
    return (
      <div className="rounded-[18px] border border-[rgb(var(--color-system-red)/0.22)] bg-[rgb(var(--color-system-red)/0.06)] p-3">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-system-red))]">
          {tApp('quoteContentHiddenTitle')}
        </p>
        <p className="mt-1 text-[14px] text-[rgb(var(--color-label-secondary))]">
          {tApp('quoteBlockedByTagr')}
        </p>
      </div>
    )
  }

  if (targetEvent && !moderationLoading && blocked) {
    return (
      <div className="rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3">
        <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
          {tApp('quoteEventUnavailable')}
        </p>
      </div>
    )
  }

  if (targetEvent) {
    return (
      <EventPreviewCard
        event={targetEvent}
        compact={compact}
        linked={linked}
        allowTranslation
        {...(translationSyncGroup !== undefined ? { translationSyncGroup } : {})}
      />
    )
  }

  return (
    loading || moderationLoading
      ? <div className="h-[72px] animate-pulse rounded-[18px] bg-[rgb(var(--color-fill)/0.07)]" />
      : null
  )
}

function getReferencedEvents(event: NostrEvent): ReturnType<typeof parseQuoteTags> {
  const references = parseQuoteTags(event)
  const seen = new Set(references.map((reference) => reference.key))

  for (const uri of extractNostrURIs(event.content)) {
    const eventReference = decodeEventReference(uri)
    if (eventReference) {
      const key = `event:${eventReference.eventId}`
      if (!seen.has(key)) {
        seen.add(key)
        references.push({
          key,
          eventId: eventReference.eventId,
          ...(eventReference.relays[0] ? { relayHint: eventReference.relays[0] } : {}),
          ...(eventReference.author ? { authorPubkey: eventReference.author } : {}),
        })
      }
      continue
    }

    const addressReference = decodeAddressReference(uri)
    if (!addressReference) continue
    const coordinate = `${addressReference.kind}:${addressReference.pubkey}:${addressReference.identifier}`
    const key = `address:${coordinate}`
    if (seen.has(key)) continue
    seen.add(key)
    references.push({
      key,
      address: coordinate,
      ...(addressReference.relays[0] ? { relayHint: addressReference.relays[0] } : {}),
      authorPubkey: addressReference.pubkey,
    })
  }

  return references
}

export function QuotePreviewList({
  event,
  className = '',
  compact = false,
  linked = true,
  maxItems = 2,
  showHeader = true,
  translationSyncGroup,
}: QuotePreviewListProps) {
  const quoted = parseQuoteTags(event)
  const references = getReferencedEvents(event).slice(0, Math.max(1, maxItems))
  if (references.length === 0) return null

  return (
    <div className={`space-y-3 ${className}`}>
      {showHeader && (
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
          {quoted.length > 0 ? tApp('quoteHeaderQuoted') : tApp('quoteHeaderReferences')}
        </p>
      )}
      {references.map((reference) => (
        <QuoteReferenceCard
          key={reference.key}
          reference={reference}
          compact={compact}
          linked={linked}
          {...(translationSyncGroup !== undefined ? { translationSyncGroup } : {})}
        />
      ))}
    </div>
  )
}
