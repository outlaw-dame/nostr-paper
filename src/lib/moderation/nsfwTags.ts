import { extractEventHashtags } from '@/lib/feed/tagTimeline'
import type { NostrEvent } from '@/types'

// All values must be lowercase — extractEventHashtags normalises t-tags to lowercase.
// 'nsfw' is the canonical NIP tag; the rest are common variants used across clients.
const NSFW_HASHTAGS = new Set([
  'nsfw',
  'adult',
  'explicit',
  'porn',
  'pornography',
  'hentai',
  'lewd',
  'nude',
  'nudity',
  'naked',
  'erotica',
  'mature',
  'onlyfans',
  'boobs',
  'xxx',
  'sex',
  'sexy',
  'topless',
  'fetish',
  'kink',
])

export function hasNsfwHashtag(event: NostrEvent): boolean {
  return extractEventHashtags(event).some((tag) => NSFW_HASHTAGS.has(tag))
}

export function filterNsfwTaggedEvents(events: NostrEvent[], hideNsfwTaggedPosts: boolean): NostrEvent[] {
  if (!hideNsfwTaggedPosts) return events
  return events.filter((event) => !hasNsfwHashtag(event))
}
