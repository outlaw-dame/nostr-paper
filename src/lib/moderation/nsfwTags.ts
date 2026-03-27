import { extractEventHashtags } from '@/lib/feed/tagTimeline'
import type { NostrEvent } from '@/types'

const NSFW_HASHTAGS = new Set(['nsfw'])

export function hasNsfwHashtag(event: NostrEvent): boolean {
  return extractEventHashtags(event).some((tag) => NSFW_HASHTAGS.has(tag))
}

export function filterNsfwTaggedEvents(events: NostrEvent[], hideNsfwTaggedPosts: boolean): NostrEvent[] {
  if (!hideNsfwTaggedPosts) return events
  return events.filter((event) => !hasNsfwHashtag(event))
}
