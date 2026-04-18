import type { SyndicationEntry, SyndicationFeed } from './types'

/**
 * Describes the primary content type of a syndication feed entry.
 *
 * - `podcast`  — an episode with audio enclosure and/or podcast namespace metadata
 * - `video`    — an item whose primary enclosure is a video file
 * - `audio`    — audio enclosure without full podcast episode metadata
 * - `article`  — a rich text article (has title + substantial body text / HTML)
 * - `image`    — a post whose primary content is image attachments
 * - `post`     — a generic short post / news item (title + optional summary only)
 */
export type SyndicationContentKind =
  | 'podcast'
  | 'video'
  | 'audio'
  | 'article'
  | 'image'
  | 'post'

function hasAttachmentKind(entry: SyndicationEntry, mimePrefix: string): boolean {
  return entry.attachments.some((att) => att.mimeType?.startsWith(mimePrefix) === true)
}

function getAudioAttachment(entry: SyndicationEntry) {
  return entry.attachments.find((att) => att.mimeType?.startsWith('audio/'))
}

function getVideoAttachment(entry: SyndicationEntry) {
  return entry.attachments.find((att) => att.mimeType?.startsWith('video/'))
}

/**
 * Classify a single feed entry into a `SyndicationContentKind`.
 *
 * @param entry  The feed item to classify.
 * @param feed   Optional parent feed used to detect podcast channel context.
 */
export function getSyndicationEntryKind(
  entry: SyndicationEntry,
  feed?: SyndicationFeed | null,
): SyndicationContentKind {
  // Podcast: entry carries podcast-namespace episode metadata, or the parent
  // feed is a podcast channel and the item includes an audio enclosure.
  if (entry.podcast || (feed?.podcast && hasAttachmentKind(entry, 'audio/'))) {
    return 'podcast'
  }

  // Video enclosure
  if (hasAttachmentKind(entry, 'video/')) return 'video'

  // Audio enclosure (no podcast namespace metadata)
  if (hasAttachmentKind(entry, 'audio/')) return 'audio'

  // Article: entry has a title plus a substantial text or HTML body
  const hasSubstantialText =
    (entry.contentHtml?.length ?? 0) > 100 ||
    (entry.contentText?.length ?? 0) > 200
  if (entry.title && hasSubstantialText) return 'article'

  // Image-primary post (image attachments, no audio/video)
  if (hasAttachmentKind(entry, 'image/')) return 'image'

  return 'post'
}

/**
 * Determine the dominant content kind across all items in a feed.
 * Returns `null` when the feed has no items, or when no single non-`post`
 * kind exceeds 50 % of the items (i.e., the feed is too mixed to label).
 */
export function getSyndicationFeedDominantKind(
  feed: SyndicationFeed,
): SyndicationContentKind | null {
  if (feed.items.length === 0) return null

  const counts = new Map<SyndicationContentKind, number>()
  for (const item of feed.items) {
    const kind = getSyndicationEntryKind(item, feed)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }

  // Require at least half of items to match the candidate kind.
  const threshold = feed.items.length * 0.5
  for (const [kind, count] of counts) {
    if (kind !== 'post' && count >= threshold) return kind
  }
  return null
}

/**
 * Human-readable label for a `SyndicationContentKind` suitable for a badge.
 */
export function formatSyndicationContentKind(kind: SyndicationContentKind): string {
  switch (kind) {
    case 'podcast': return 'Podcast'
    case 'video':   return 'Video'
    case 'audio':   return 'Audio'
    case 'article': return 'Blog'
    case 'image':   return 'Images'
    case 'post':    return 'Posts'
  }
}

/**
 * Format a raw duration in seconds to a human-readable string (e.g. `1:23:45`).
 */
export function formatDurationSeconds(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Return the primary audio attachment from an entry, or `null`. */
export { getAudioAttachment, getVideoAttachment }
