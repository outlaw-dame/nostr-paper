import type { SavedTagFeed } from '@/lib/feed/tagFeeds'
import type { TagTimelineSpec } from '@/lib/feed/tagTimeline'
import type { FeedSection } from '@/types'

export interface FeedHeaderSectionInput extends FeedSection {
  summary: string
  tagTimeline?: TagTimelineSpec | null
}

export function isSavedTagFeedTimeline(
  tagTimeline: TagTimelineSpec | null | undefined,
): tagTimeline is SavedTagFeed {
  return Boolean(
    tagTimeline
    && typeof (tagTimeline as SavedTagFeed).id === 'string'
    && typeof (tagTimeline as SavedTagFeed).title === 'string'
    && typeof (tagTimeline as SavedTagFeed).createdAt === 'number'
  )
}

export function getFeedHeaderSection(
  activeSection: FeedHeaderSectionInput,
  defaultFeedSection: FeedHeaderSectionInput,
): FeedHeaderSectionInput {
  if (isSavedTagFeedTimeline(activeSection.tagTimeline)) {
    return activeSection
  }
  return activeSection.tagTimeline ? defaultFeedSection : activeSection
}
