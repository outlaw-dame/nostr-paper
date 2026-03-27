import { parseRepostEvent } from '@/lib/nostr/repost'
import type { NostrEvent } from '@/types'

export interface RepostCarouselItem {
  targetEventId: string
  targetEvent: NostrEvent
  repostCount: number
  reposterPubkeys: string[]
  lastRepostedAt: number
}

interface CollectRepostCarouselItemsOptions {
  minReposts?: number
  maxItems?: number
}

interface RepostAggregate {
  targetEventId: string
  targetEvent: NostrEvent | null
  reposterPubkeys: Set<string>
  lastRepostedAt: number
}

const DEFAULT_MIN_REPOSTS = 3
const DEFAULT_MAX_ITEMS = 10

export function collectRepostCarouselItems(
  events: NostrEvent[],
  options: CollectRepostCarouselItemsOptions = {},
): RepostCarouselItem[] {
  const minReposts = Math.max(1, Math.floor(options.minReposts ?? DEFAULT_MIN_REPOSTS))
  const maxItems = Math.max(1, Math.floor(options.maxItems ?? DEFAULT_MAX_ITEMS))

  const eventsById = new Map(events.map((event) => [event.id, event]))
  const aggregates = new Map<string, RepostAggregate>()

  for (const event of events) {
    const parsed = parseRepostEvent(event)
    if (!parsed) continue

    const existing = aggregates.get(parsed.targetEventId)

    if (existing) {
      existing.reposterPubkeys.add(parsed.pubkey)
      existing.lastRepostedAt = Math.max(existing.lastRepostedAt, parsed.createdAt)
      if (!existing.targetEvent) {
        existing.targetEvent = parsed.embeddedEvent ?? eventsById.get(parsed.targetEventId) ?? null
      }
      continue
    }

    aggregates.set(parsed.targetEventId, {
      targetEventId: parsed.targetEventId,
      targetEvent: eventsById.get(parsed.targetEventId) ?? parsed.embeddedEvent ?? null,
      reposterPubkeys: new Set([parsed.pubkey]),
      lastRepostedAt: parsed.createdAt,
    })
  }

  return [...aggregates.values()]
    .filter((aggregate) => aggregate.targetEvent !== null)
    .map((aggregate) => ({
      targetEventId: aggregate.targetEventId,
      targetEvent: aggregate.targetEvent!,
      repostCount: aggregate.reposterPubkeys.size,
      reposterPubkeys: [...aggregate.reposterPubkeys],
      lastRepostedAt: aggregate.lastRepostedAt,
    }))
    .filter((item) => item.repostCount >= minReposts)
    .sort((left, right) => (
      right.repostCount - left.repostCount
      || right.lastRepostedAt - left.lastRepostedAt
      || right.targetEvent.created_at - left.targetEvent.created_at
      || left.targetEvent.id.localeCompare(right.targetEvent.id)
    ))
    .slice(0, maxItems)
}
