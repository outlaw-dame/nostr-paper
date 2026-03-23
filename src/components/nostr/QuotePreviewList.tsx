import { useAddressableEvent } from '@/hooks/useAddressableEvent'
import { useEvent } from '@/hooks/useEvent'
import { EventPreviewCard } from '@/components/nostr/EventPreviewCard'
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
}

function QuoteReferenceCard({
  reference,
  compact,
  linked,
}: {
  reference: ReturnType<typeof parseQuoteTags>[number]
  compact: boolean
  linked: boolean
}) {
  const address = reference.address ? parseAddressCoordinate(reference.address) : null
  const eventState = useEvent(reference.eventId)
  const addressState = useAddressableEvent({
    pubkey: address?.pubkey,
    kind: address?.kind,
    identifier: address?.identifier,
  })

  const targetEvent = eventState.event ?? addressState.event
  const loading = eventState.loading || addressState.loading

  if (targetEvent) {
    return <EventPreviewCard event={targetEvent} compact={compact} linked={linked} />
  }

  return (
    <div className="rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3">
      <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
        {loading ? 'Loading quoted event…' : 'Quoted event unavailable.'}
      </p>
    </div>
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
}: QuotePreviewListProps) {
  const quoted = parseQuoteTags(event)
  const references = getReferencedEvents(event).slice(0, Math.max(1, maxItems))
  if (references.length === 0) return null

  return (
    <div className={`space-y-3 ${className}`}>
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
        {quoted.length > 0 ? 'Quoted' : 'References'}
      </p>
      {references.map((reference) => (
        <QuoteReferenceCard
          key={reference.key}
          reference={reference}
          compact={compact}
          linked={linked}
        />
      ))}
    </div>
  )
}
