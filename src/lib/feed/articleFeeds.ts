import { describeTagTimeline } from '@/lib/feed/tagTimeline'
import type { SavedTagFeed } from '@/lib/feed/tagFeeds'
import type { FeedSection, NostrFilter } from '@/types'
import { Kind } from '@/types'

type ArticleFeedTone = 'all' | 'following' | 'custom'

export interface ArticleFeedSection extends FeedSection {
  summary: string
  eyebrow: string
  tone: ArticleFeedTone
  banner?: string | undefined
  avatar?: string | undefined
  keywordCount?: number | undefined
  profileCount?: number | undefined
  followingCount?: number | undefined
  tagTimeline?: SavedTagFeed | null
}

const ARTICLE_KINDS = [Kind.LongFormContent]
const DEFAULT_ARTICLE_LIMIT = 20
const EXPANDED_ARTICLE_LIMIT = 80

function uniquePubkeys(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.length > 0)))]
}

function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`
}

function formatTags(tags: string[]): string {
  return tags.map((tag) => `#${tag}`).join(', ')
}

function buildAllFeedsSummary(followingCount: number, customFeedCount: number): string {
  if (followingCount > 0 && customFeedCount > 0) {
    return `Open article stream across your relays, with quick pivots into ${formatCount(customFeedCount, 'custom feed')} and ${formatCount(followingCount, 'followed writer')}.`
  }

  if (followingCount > 0) {
    return `Open article stream across your relays, anchored by ${formatCount(followingCount, 'followed writer')}.`
  }

  if (customFeedCount > 0) {
    return `Open article stream across your relays, with ${formatCount(customFeedCount, 'custom article lane')} ready below.`
  }

  return 'Open article stream across your relays, with room to layer in your own custom feeds.'
}

function buildFollowingSummary(authorCount: number, followingCount: number): string {
  if (followingCount <= 0) {
    return 'Long-form posts from profiles you follow.'
  }

  if (authorCount > followingCount) {
    return `Long-form posts from you and ${formatCount(followingCount, 'followed profile')}.`
  }

  return `Long-form posts from ${formatCount(followingCount, 'followed profile')}.`
}

function buildSavedFeedSummary(feed: SavedTagFeed): string {
  if (feed.description) return feed.description

  const details = describeTagTimeline(feed)
  if (!details) return 'Custom article lane built from your saved keywords and hashtags.'

  if (feed.includeTags.length === 1 && feed.excludeTags.length === 0) {
    return `Articles collected around #${feed.includeTags[0]}, including plain-text and semantic matches.`
  }

  const matcher = feed.mode === 'all' ? 'all of' : 'any of'
  const excludeText = feed.excludeTags.length > 0
    ? ` Excluding ${formatTags(feed.excludeTags)}.`
    : ''
  return `Articles matching ${matcher} ${formatTags(feed.includeTags)}, including plain-text and semantic matches.${excludeText}`.trim()
}

function buildSavedFeedFilter(feed: SavedTagFeed): NostrFilter {
  return {
    kinds: ARTICLE_KINDS,
    '#t': feed.includeTags,
    limit: feed.includeTags.length > 1 || feed.excludeTags.length > 0
      ? EXPANDED_ARTICLE_LIMIT
      : DEFAULT_ARTICLE_LIMIT,
  }
}

export function buildArticleFeedSections(options: {
  currentUserPubkey?: string | null
  followingPubkeys?: string[]
  savedTagFeeds?: SavedTagFeed[]
}): ArticleFeedSection[] {
  const currentUserPubkey = options.currentUserPubkey ?? null
  const followingPubkeys = uniquePubkeys(options.followingPubkeys ?? [])
  const savedTagFeeds = options.savedTagFeeds ?? []
  const authorPubkeys = uniquePubkeys([currentUserPubkey, ...followingPubkeys])

  const sections: ArticleFeedSection[] = [
    {
      id: 'articles:all-feeds',
      label: 'All feeds',
      summary: buildAllFeedsSummary(followingPubkeys.length, savedTagFeeds.length),
      eyebrow: 'Aggregate',
      tone: 'all',
      keywordCount: savedTagFeeds.reduce((count, feed) => count + feed.includeTags.length, 0),
      profileCount: savedTagFeeds.reduce((count, feed) => count + feed.profilePubkeys.length, 0),
      filter: {
        kinds: ARTICLE_KINDS,
        limit: DEFAULT_ARTICLE_LIMIT,
      },
    },
  ]

  if (authorPubkeys.length > 0) {
    sections.push({
      id: 'articles:following',
      label: 'Following',
      summary: buildFollowingSummary(authorPubkeys.length, followingPubkeys.length),
      eyebrow: 'Network',
      tone: 'following',
      followingCount: followingPubkeys.length,
      profileCount: authorPubkeys.length,
      filter: {
        authors: authorPubkeys,
        kinds: ARTICLE_KINDS,
        limit: DEFAULT_ARTICLE_LIMIT,
      },
    })
  }

  for (const feed of savedTagFeeds) {
    sections.push({
      id: `articles:saved:${feed.id}`,
      label: feed.title,
      summary: buildSavedFeedSummary(feed),
      eyebrow: 'Custom',
      tone: 'custom',
      banner: feed.banner || undefined,
      avatar: feed.avatar || undefined,
      keywordCount: feed.includeTags.length,
      profileCount: feed.profilePubkeys.length,
      tagTimeline: feed,
      filter: buildSavedFeedFilter(feed),
    })
  }

  return sections
}
