import type { TagTimelineSpec } from '@/lib/feed/tagTimeline'
import type { FeedSection } from '@/types'

export interface FeedHeaderSectionInput extends FeedSection {
  summary: string
  tagTimeline?: TagTimelineSpec | null
}

export function getFeedHeaderSection(
  activeSection: FeedHeaderSectionInput,
  defaultFeedSection: FeedHeaderSectionInput,
): FeedHeaderSectionInput {
  return activeSection.tagTimeline ? defaultFeedSection : activeSection
}
