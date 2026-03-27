import { parseRepostEvent } from '@/lib/nostr/repost'
import type { NostrEvent } from '@/types'

export interface BoostCarouselItem {
  targetEventId: string
  targetEvent: NostrEvent
  repostCount: number
  reposterPubkeys: string[]
  lastBoostedAt: number
}

interface CollectBoostCarouselItemsOptions {
  minBoosts?: number
  maxItems?: number
}

interface BoostAggregate {
  targetEventId: string
  targetEvent: NostrEvent | null
  reposterPubkeys: Set<string>
  lastBoostedAt: number
}

const DEFAULT_MIN_BOOSTS = 3
const DEFAULT_MAX_ITEMS = 10

export function collectBoostCarouselItems(
  events: NostrEvent[],
  options: CollectBoostCarouselItemsOptions = {},
): BoostCarouselItem[] {
  const minBoosts = Math.max(1, Math.floor(options.minBoosts ?? DEFAULT_MIN_BOOSTS))
  const maxItems = Math.max(1, Math.floor(options.maxItems ?? DEFAULT_MAX_ITEMS))

  const eventsById = new Map(events.map((event) => [event.id, event]))
  const aggregates = new Map<string, BoostAggregate>()

  for (const event of events) {
    const parsed = parseRepostEvent(event)
    if (!parsed) continue

    const existing = aggregates.get(parsed.targetEventId)

    if (existing) {
      existing.reposterPubkeys.add(parsed.pubkey)
      existing.lastBoostedAt = Math.max(existing.lastBoostedAt, parsed.createdAt)
      if (!existing.targetEvent) {
        existing.targetEvent = parsed.embeddedEvent ?? eventsById.get(parsed.targetEventId) ?? null
      }
      continue
    }

    aggregates.set(parsed.targetEventId, {
      targetEventId: parsed.targetEventId,
      targetEvent: eventsById.get(parsed.targetEventId) ?? parsed.embeddedEvent ?? null,
      reposterPubkeys: new Set([parsed.pubkey]),
      lastBoostedAt: parsed.createdAt,
    })
  }

  return [...aggregates.values()]
    .filter((aggregate) => aggregate.targetEvent !== null)
    .map((aggregate) => ({
      targetEventId: aggregate.targetEventId,
      targetEvent: aggregate.targetEvent!,
      repostCount: aggregate.reposterPubkeys.size,
      reposterPubkeys: [...aggregate.reposterPubkeys],
      lastBoostedAt: aggregate.lastBoostedAt,
    }))
    .filter((item) => item.repostCount >= minBoosts)
    .sort((left, right) => (
      right.repostCount - left.repostCount
      || right.lastBoostedAt - left.lastBoostedAt
      || right.targetEvent.created_at - left.targetEvent.created_at
      || left.targetEvent.id.localeCompare(right.targetEvent.id)
    ))
    .slice(0, maxItems)
}
