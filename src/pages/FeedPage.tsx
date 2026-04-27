/**
 * FeedPage
 *
 * Editorial feed layout:
 * - Unified scroll surface with clear hierarchy
 * - Large-title header, search entry, and explicit compose action
 * - Section rail for primary content modes
 * - Hero story followed by secondary cards
 *
 * All data is sourced from SQLite via useNostrFeed (local-first).
 */

import { useState, useCallback, useMemo, useEffect, useRef, memo, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { motion, useMotionValue, useTransform, AnimatePresence } from 'motion/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useApp } from '@/contexts/app-context'
import { useNostrFeed } from '@/hooks/useNostrFeed'
import { HeroCard } from '@/components/cards/HeroCard'
import { NostrCreatorAttribution } from '@/components/links/NostrCreatorAttribution'
import { RepostCarousel } from '@/components/feed/RepostCarousel'
import { StoryRail } from '@/components/feed/StoryRail'
import { SectionRail } from '@/components/feed/SectionRail'
import { TopicFilterRail } from '@/components/feed/TopicFilterRail'
import { FeedSkeleton } from '@/components/feed/FeedSkeleton'
import { NoteContent } from '@/components/cards/NoteContent'
import { SensitiveImage } from '@/components/media/SensitiveImage'
import { NoteMediaAttachments } from '@/components/nostr/NoteMediaAttachments'
import { PollPreview } from '@/components/nostr/PollPreview'
import { QuotePreviewList } from '@/components/nostr/QuotePreviewList'
import { RepostBody } from '@/components/nostr/RepostBody'
import { ThreadIndexBadge } from '@/components/nostr/ThreadIndexBadge'
import { EventMetricsRow } from '@/components/nostr/EventMetricsRow'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { TwemojiText } from '@/components/ui/TwemojiText'
import { TranslateTextPanel } from '@/components/translation/TranslateTextPanel'
import { FilteredGate } from '@/components/filters/FilteredGate'
import { useFollowStatus } from '@/hooks/useFollowStatus'
import { useProfile } from '@/hooks/useProfile'
import { useModerationDocuments } from '@/hooks/useModeration'
import { useMuteList } from '@/hooks/useMuteList'
import { useStoryCardPreview } from '@/hooks/useStoryCardPreview'
import { useTagTimelineSemanticFeed } from '@/hooks/useTagTimelineSemanticFeed'
import { useArticleFeedSections } from '@/hooks/useArticleFeedSections'
import { useHideNsfwTaggedPosts } from '@/hooks/useHideNsfwTaggedPosts'
import { useSavedTagFeeds } from '@/hooks/useSavedTagFeeds'
import { useActivityUnread } from '@/hooks/useActivityUnread'
import { useSelfThreadIndex } from '@/hooks/useSelfThreadIndex'
import { useVisibilityOnce } from '@/hooks/useVisibilityOnce'
import { useEventFilterCheck, useSemanticFiltering, mergeResults } from '@/hooks/useKeywordFilters'
import { useTopicClusters } from '@/hooks/useTopicClusters'
import { recordMediaUrlFailure, recordMediaUrlSuccess, shouldAttemptMediaUrl } from '@/lib/media/failureBackoff'
import { useMediaModerationDocument } from '@/hooks/useMediaModeration'
import { buildMediaModerationDocument } from '@/lib/moderation/mediaContent'
import { buildComposeSearch } from '@/lib/compose'
import { type ArticleFeedSection } from '@/lib/feed/articleFeeds'
import { collectRepostCarouselItems } from '@/lib/feed/reposts'
import { getFeedHeaderSection, isSavedTagFeedTimeline } from '@/lib/feed/headerSection'
import { buildFeedRailSections } from '@/lib/feed/railSections'
import { type SavedTagFeed } from '@/lib/feed/tagFeeds'
import {
  buildTagTimelineHref,
  describeTagTimeline,
  extractEventHashtags,
  getTagTimelineKey,
  matchesTagTimeline,
  parseTagTimeline,
  type TagTimelineSpec,
} from '@/lib/feed/tagTimeline'
import { FEED_RESUME_UPDATED_EVENT, getFeedResumeEnabled } from '@/lib/feed/resumeSettings'
import { getFeedInlineMediaAutoplayEnabled, getRepostCarouselVisible, ZEN_SETTINGS_UPDATED_EVENT } from '@/lib/ui/zenSettings'
import { filterNsfwTaggedEvents } from '@/lib/moderation/nsfwTags'
import { buildEventModerationDocument } from '@/lib/moderation/content'
import { parseRepostEvent } from '@/lib/nostr/repost'
import { warmSelfThreadIndexCache } from '@/lib/nostr/threadIndex'
import { parseCommentEvent } from '@/lib/nostr/thread'
import { getPeerTubeEmbedUrl, getVimeoVideoId, getYouTubeVideoId } from '@/lib/nostr/imeta'
import { tApp } from '@/lib/i18n/app'
import type { ParsedVideoEvent } from '@/lib/nostr/video'
import type { FilterCheckResult } from '@/lib/filters/types'
import type { FeedSection, NostrEvent, Profile } from '@/types'
import { Kind } from '@/types'

// ── Default sections ─────────────────────────────────────────
// Declared outside the component so filter objects have stable references
// and do not trigger useEffect re-runs on every render.

type FeedRailSection = FeedSection & {
  href?: string
  summary: string
  tagTimeline?: TagTimelineSpec | null
}

const EMPTY_FILTER_RESULT: FilterCheckResult = {
  action: null,
  matches: [],
}

const TAG_FEED_KINDS = [
  Kind.ShortNote,
  Kind.Thread,
  Kind.Poll,
  Kind.LongFormContent,
  Kind.Video,
  Kind.ShortVideo,
  Kind.AddressableVideo,
  Kind.AddressableShortVideo,
]

const DEFAULT_SECTIONS: FeedRailSection[] = [
  {
    id:     'feed',
    label:  'Feed',
    summary: 'Latest across your network.',
    filter: {
      kinds: [
        Kind.ShortNote,
        Kind.Thread,
        Kind.Repost,
        Kind.GenericRepost,
        Kind.Poll,
        Kind.Video,
        Kind.ShortVideo,
        Kind.AddressableVideo,
        Kind.AddressableShortVideo,
      ],
      limit: 50,
    },
  },
  {
    id:     'notes',
    label:  'Notes',
    summary: 'Fast conversation and short-form posts.',
    filter: { kinds: [Kind.ShortNote, Kind.Thread, Kind.Repost, Kind.GenericRepost, Kind.Poll], limit: 30 },
  },
  {
    id:     'articles',
    label:  'Articles',
    summary: 'Longer reading and analysis.',
    filter: { kinds: [Kind.LongFormContent], limit: 20 },
  },
  {
    id:     'videos',
    label:  'Videos',
    summary: 'Clips, explainers, and moving images.',
    filter: {
      kinds: [
        Kind.Video,
        Kind.ShortVideo,
        Kind.AddressableVideo,
        Kind.AddressableShortVideo,
      ],
      limit: 24,
    },
  },
  {
    id:     'highlights',
    label:  'Highlights',
    summary: 'Passages your network found worth preserving.',
    filter: {
      kinds: [Kind.Highlight],
      limit: 30,
    },
  },
  {
    id:     'bitcoin',
    label:  'Bitcoin',
    summary: 'Bitcoin discussion and market signal.',
    filter: {
      kinds: [
        Kind.ShortNote,
        Kind.Thread,
        Kind.Poll,
        Kind.Video,
        Kind.ShortVideo,
        Kind.AddressableVideo,
        Kind.AddressableShortVideo,
      ],
      '#t': ['bitcoin'],
      limit: 30,
    },
  },
  {
    id:     'nostr',
    label:  'Nostr',
    summary: 'Builders, releases, and protocol chatter.',
    filter: {
      kinds: [
        Kind.ShortNote,
        Kind.Thread,
        Kind.Poll,
        Kind.Video,
        Kind.ShortVideo,
        Kind.AddressableVideo,
        Kind.AddressableShortVideo,
      ],
      '#t': ['nostr'],
      limit: 30,
    },
  },
  {
    id:     'reads',
    label:  'Reads',
    summary: 'Long-form articles from your network.',
    filter: {
      kinds: [Kind.LongFormContent],
      limit: 24,
    },
  },
  {
    id:     'curations',
    label:  'Curations',
    summary: 'Handpicked reading lists and topic sets.',
    filter: {
      kinds: [Kind.ArticleCurationSet, Kind.VideoCurationSet, Kind.BookmarkSet],
      limit: 24,
    },
  },
]

// Safe: DEFAULT_SECTIONS is a non-empty module-level constant
const DEFAULT_FIRST_SECTION = DEFAULT_SECTIONS[0] as FeedRailSection

const TAG_FEEDS_SECTION: FeedRailSection = {
  id: 'tag-feeds:manage',
  label: 'Tags',
  summary: 'Create and manage saved tag feeds.',
  href: '/settings/tag-feeds',
  filter: DEFAULT_FIRST_SECTION.filter,
}

const COMPOSE_TRIGGER_OFFSET = 85  // px downward pull to open compose sheet
const FEED_VIEW_STATE_KEY = 'nostr-paper:feed:view-state:v1'
const FEED_STATE_TTL_MS = 1000 * 60 * 60 * 24 * 7
const MIN_PRIMARY_FEED_ITEMS = 6

interface FeedViewSnapshot {
  anchorEventId: string | null
  anchorOffset: number
  scrollTop: number
  savedAt: number
}

type FeedViewStateMap = Record<string, FeedViewSnapshot>

function readFeedViewStateMap(): FeedViewStateMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(FEED_VIEW_STATE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as FeedViewStateMap
  } catch {
    return {}
  }
}

function writeFeedViewStateMap(next: FeedViewStateMap): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(FEED_VIEW_STATE_KEY, JSON.stringify(next))
  } catch {
    // Silently fail if localStorage is unavailable.
  }
}

function getFeedViewSnapshot(scopeKey: string): FeedViewSnapshot | null {
  const stateMap = readFeedViewStateMap()
  const snapshot = stateMap[scopeKey]
  if (!snapshot) return null
  if (Date.now() - snapshot.savedAt > FEED_STATE_TTL_MS) {
    delete stateMap[scopeKey]
    writeFeedViewStateMap(stateMap)
    return null
  }
  return snapshot
}

function saveFeedViewSnapshot(scopeKey: string, snapshot: FeedViewSnapshot): void {
  const stateMap = readFeedViewStateMap()
  stateMap[scopeKey] = snapshot

  // Keep only the most recent 32 scopes so local state does not grow unbounded.
  const entries = Object.entries(stateMap)
  if (entries.length > 32) {
    entries
      .sort((a, b) => b[1].savedAt - a[1].savedAt)
      .slice(32)
      .forEach(([key]) => {
        delete stateMap[key]
      })
  }

  writeFeedViewStateMap(stateMap)
}

function clearFeedViewSnapshot(scopeKey: string): void {
  const stateMap = readFeedViewStateMap()
  if (!stateMap[scopeKey]) return
  delete stateMap[scopeKey]
  writeFeedViewStateMap(stateMap)
}

function getVisibleAnchor(container: HTMLElement): { id: string; offset: number } | null {
  const containerRect = container.getBoundingClientRect()
  const candidates = container.querySelectorAll<HTMLElement>('[data-feed-event-id]')

  for (const element of candidates) {
    const rect = element.getBoundingClientRect()
    if (rect.bottom > containerRect.top + 8 && rect.top < containerRect.bottom - 8) {
      const id = element.dataset.feedEventId
      if (id) {
        return {
          id,
          offset: rect.top - containerRect.top,
        }
      }
    }
  }

  return null
}

function buildSavedTagFeedSection(feed: SavedTagFeed): FeedRailSection {
  const details = describeTagTimeline(feed)

  return {
    id: `tag-feed:${feed.id}`,
    label: feed.title,
    summary: feed.description || details?.summary || 'Posts, articles, and videos collected from this tag feed.',
    href: buildTagTimelineHref(feed),
    tagTimeline: feed,
    filter: {
      kinds: TAG_FEED_KINDS,
      '#t': feed.includeTags,
      limit: feed.includeTags.length > 1 || feed.excludeTags.length > 0 ? 80 : 50,
    },
  }
}

function buildEphemeralTagFeedSection(spec: TagTimelineSpec): FeedRailSection {
  const details = describeTagTimeline(spec)

  return {
    id: `tag-route:${getTagTimelineKey(spec)}`,
    label: details?.title ?? `#${spec.includeTags[0] ?? 'tag'}`,
    summary: details?.summary ?? 'Posts, articles, and videos collected from this tag feed.',
    href: buildTagTimelineHref(spec),
    tagTimeline: spec,
    filter: {
      kinds: TAG_FEED_KINDS,
      '#t': spec.includeTags,
      limit: spec.includeTags.length > 1 || spec.excludeTags.length > 0 ? 80 : 50,
    },
  }
}

function FeedHeaderImage({
  src,
  alt = '',
  className,
  fallback = null,
}: {
  src: string | null
  alt?: string
  className: string
  fallback?: ReactNode
}) {
  const [failed, setFailed] = useState(() => !src || !shouldAttemptMediaUrl(src))

  useEffect(() => {
    setFailed(!src || !shouldAttemptMediaUrl(src))
  }, [src])

  if (!src || failed) return <>{fallback}</>

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={className}
      onLoad={() => recordMediaUrlSuccess(src)}
      onError={() => {
        recordMediaUrlFailure(src)
        setFailed(true)
      }}
    />
  )
}

function ArticleFeedShowcase({
  feed,
  totalFeedCount,
  customFeedCount,
  followingCount,
  loading,
  onManage,
}: {
  feed: ArticleFeedSection
  totalFeedCount: number
  customFeedCount: number
  followingCount: number
  loading: boolean
  onManage: () => void
}) {
  const toneBackground = {
    all: 'bg-[radial-gradient(circle_at_top_left,_rgba(var(--color-accent),0.24),_transparent_52%),linear-gradient(135deg,rgba(var(--color-fill),0.14),rgba(var(--color-fill),0.04))]',
    following: 'bg-[radial-gradient(circle_at_top_left,_rgba(80,180,255,0.22),_transparent_54%),linear-gradient(135deg,rgba(var(--color-fill),0.14),rgba(var(--color-fill),0.05))]',
    custom: 'bg-[radial-gradient(circle_at_top_left,_rgba(var(--color-accent),0.18),_transparent_48%),linear-gradient(135deg,rgba(var(--color-fill),0.16),rgba(var(--color-fill),0.06))]',
  } as const

  const chips: string[] = []

  if (feed.tone === 'all') {
    chips.push(`${totalFeedCount} lanes`)
    if (customFeedCount > 0) chips.push(`${customFeedCount} custom`)
    if (followingCount > 0) chips.push(`${followingCount} following`)
  }

  if (feed.tone === 'following') {
    if (followingCount > 0) chips.push(`${followingCount} followed`)
    if ((feed.profileCount ?? 0) > followingCount) chips.push('Includes you')
  }

  if (feed.tone === 'custom') {
    if ((feed.keywordCount ?? 0) > 0) {
      chips.push(`${feed.keywordCount} ${(feed.keywordCount ?? 0) === 1 ? 'keyword' : 'keywords'}`)
    }
    if ((feed.profileCount ?? 0) > 0) {
      chips.push(`${feed.profileCount} ${(feed.profileCount ?? 0) === 1 ? 'profile' : 'profiles'}`)
    }
    if (feed.tagTimeline && feed.tagTimeline.includeTags.length > 1) {
      chips.push(feed.tagTimeline.mode === 'all' ? 'All keywords' : 'Any keyword')
    }
  }

  if (loading) {
    chips.push('Refreshing')
  }

  const defaultAvatar = (
    <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(145deg,rgba(var(--color-accent),0.16),rgba(var(--color-fill),0.12))] text-[rgb(var(--color-label))]">
      {feed.tone === 'following' ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ) : feed.tone === 'all' ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      ) : (
        <span className="text-[22px] font-semibold">
          {(feed.label.trim().replace(/^#/, '')[0] ?? 'A').toUpperCase()}
        </span>
      )}
    </div>
  )

  return (
    <div className="overflow-hidden rounded-[30px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={feed.id}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ type: 'spring', stiffness: 260, damping: 28 }}
          className="relative overflow-hidden px-4 py-4"
        >
          <div className={`absolute inset-0 ${toneBackground[feed.tone]}`}>
            {feed.banner && (
              <>
                <FeedHeaderImage
                  src={feed.banner}
                  alt=""
                  className="h-full w-full object-cover opacity-35"
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.04),rgba(0,0,0,0.2))]" />
              </>
            )}
          </div>

          <div className="relative flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--color-label-secondary))]">
                {feed.eyebrow}
              </p>

              <div className="mt-3 flex items-start gap-3">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full ring-1 ring-[rgb(var(--color-fill)/0.12)]">
                  <FeedHeaderImage
                    src={feed.avatar ?? null}
                    alt={`${feed.label} avatar`}
                    className="h-full w-full object-cover"
                    fallback={defaultAvatar}
                  />
                </div>

                <div className="min-w-0">
                  <h2 className="text-[26px] font-semibold leading-[1.04] tracking-[-0.04em] text-[rgb(var(--color-label))]">
                    <TwemojiText text={feed.label} />
                  </h2>
                  <p className="mt-2 max-w-[34rem] text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                    {feed.summary}
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onManage}
              onPointerDownCapture={(event) => {
                event.stopPropagation()
              }}
              className="shrink-0 rounded-full border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg)/0.72)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label))] transition-opacity active:opacity-75"
            >
              {customFeedCount > 0 ? 'Manage feeds' : 'Create feed'}
            </button>
          </div>

          {chips.length > 0 && (
            <div className="relative mt-4 flex flex-wrap gap-2">
              {chips.map((chip) => (
                <span
                  key={`${feed.id}:${chip}`}
                  className="rounded-full bg-[rgb(var(--color-bg)/0.68)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label-secondary))] ring-1 ring-[rgb(var(--color-fill)/0.08)]"
                >
                  {chip}
                </span>
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

export default function FeedPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser } = useApp()
  const tagFeedScopeId = useMemo(
    () => currentUser?.pubkey ?? 'anon',
    [currentUser?.pubkey],
  )
  const { tag: routeTag } = useParams<{ tag?: string }>()
  const routeTagTimeline = useMemo(
    () => parseTagTimeline(routeTag, location.search),
    [location.search, routeTag],
  )
  const savedTagFeeds = useSavedTagFeeds(tagFeedScopeId)
  const savedTagSections = useMemo(
    () => savedTagFeeds.map((feed) => buildSavedTagFeedSection(feed)),
    [savedTagFeeds],
  )
  const matchedSavedTagSection = useMemo(() => {
    if (!routeTagTimeline) return null
    const routeKey = getTagTimelineKey(routeTagTimeline)
    return savedTagSections.find((section) => (
      section.tagTimeline && getTagTimelineKey(section.tagTimeline) === routeKey
    )) ?? null
  }, [routeTagTimeline, savedTagSections])
  const routeSection = useMemo<FeedRailSection | null>(() => {
    if (!routeTagTimeline) return null
    if (matchedSavedTagSection) return matchedSavedTagSection
    return buildEphemeralTagFeedSection(routeTagTimeline)
  }, [matchedSavedTagSection, routeTagTimeline])
  const railSections = useMemo(() => {
    return buildFeedRailSections({
      defaultSections: DEFAULT_SECTIONS,
      savedTagSections,
      routeSection,
      emptyTagSection: TAG_FEEDS_SECTION,
    })
  }, [routeSection, savedTagSections])
  const [activeSectionId, setActiveSectionId] = useState(DEFAULT_FIRST_SECTION.id)
  const [activeArticleFeedId, setActiveArticleFeedId] = useState('articles:all-feeds')
  const [repostCarouselVisible, setRepostCarouselVisible] = useState(true)
  const [feedInlineAutoplayEnabled, setFeedInlineAutoplayEnabled] = useState(true)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const restoreCompletedRef = useRef(false)
  const rafSaveRef = useRef<number | null>(null)
  const [resumeFeedPosition, setResumeFeedPosition] = useState(true)

  const { profile: currentUserProfile } = useProfile(currentUser?.pubkey)
  const { isMuted, mutedWords, mutedHashtags, loading: muteListLoading } = useMuteList()
  const hideNsfwTaggedPosts = useHideNsfwTaggedPosts()
  const { unreadCount: activityUnreadCount, hasUnread: hasUnreadActivity } = useActivityUnread({ enabled: Boolean(currentUser) })
  const activityUnreadBadgeText = activityUnreadCount > 99 ? '99+' : String(activityUnreadCount)
  const activeSection = useMemo<FeedRailSection>(() => (
    routeSection
      ?? railSections.find((section) => section.id === activeSectionId)
      ?? DEFAULT_FIRST_SECTION
  ), [activeSectionId, railSections, routeSection])
  const {
    sections: articleFeedSections,
    followingCount: articleFeedFollowingCount,
    loading: articleFeedSectionsLoading,
  } = useArticleFeedSections(currentUser?.pubkey ?? null, savedTagFeeds)
  const activeArticleFeed = useMemo<ArticleFeedSection | null>(() => {
    if (activeSection.id !== 'articles') return null
    return articleFeedSections.find((section) => section.id === activeArticleFeedId)
      ?? articleFeedSections[0]
      ?? null
  }, [activeArticleFeedId, activeSection.id, articleFeedSections])
  const effectiveFeedSection = useMemo<FeedRailSection>(() => {
    if (activeSection.id !== 'articles' || !activeArticleFeed) return activeSection

    return {
      id: activeArticleFeed.id,
      label: activeArticleFeed.label,
      summary: activeArticleFeed.summary,
      filter: activeArticleFeed.filter,
      tagTimeline: activeArticleFeed.tagTimeline ?? null,
    }
  }, [activeArticleFeed, activeSection])
  const activeTagTimeline = effectiveFeedSection.tagTimeline ?? null
  const activeSavedTagFeed = useMemo(
    () => {
      // Only show saved feed header for saved/tag feed sections, not for primary sections
      const isSavedOrTagFeedSection = activeSection.id.startsWith('tag-feed:') || activeSection.id.startsWith('tag-route:')
      return isSavedOrTagFeedSection && isSavedTagFeedTimeline(activeSection.tagTimeline)
        ? activeSection.tagTimeline
        : null
    },
    [activeSection.id, activeSection.tagTimeline],
  )
  const activeTagTimelineDetails = useMemo(
    () => describeTagTimeline(activeTagTimeline),
    [activeTagTimeline],
  )
  const headerSection = useMemo(
    () => getFeedHeaderSection(activeSection, DEFAULT_FIRST_SECTION),
    [activeSection],
  )

  const feedScopeKey = useMemo(
    () => `${currentUser?.pubkey ?? 'anon'}::${effectiveFeedSection.id}`,
    [currentUser?.pubkey, effectiveFeedSection.id],
  )

  const resumeScopeId = useMemo(
    () => currentUser?.pubkey ?? 'anon',
    [currentUser?.pubkey],
  )

  useEffect(() => {
    if (articleFeedSections.length === 0) return
    if (!articleFeedSections.some((section) => section.id === activeArticleFeedId)) {
      setActiveArticleFeedId(articleFeedSections[0]?.id ?? '')
    }
  }, [activeArticleFeedId, articleFeedSections])

  const { events, loading, eose } = useNostrFeed({ section: effectiveFeedSection })
  const {
    events: semanticTimelineEvents,
    scores: semanticTimelineScores,
    loading: semanticTimelineLoading,
    error: semanticTimelineError,
  } = useTagTimelineSemanticFeed(activeTagTimeline, effectiveFeedSection.filter.kinds)
  const timelineCandidateEvents = useMemo(() => {
    if (!activeTagTimeline) return events

    const merged = new Map<string, NostrEvent>()
    for (const event of [...events, ...semanticTimelineEvents]) {
      const existing = merged.get(event.id)
      if (!existing || event.created_at > existing.created_at) {
        merged.set(event.id, event)
      }
    }

    return [...merged.values()].sort((a, b) => b.created_at - a.created_at)
  }, [activeTagTimeline, events, semanticTimelineEvents])
  const tagMatchedEvents = useMemo(
    () => (activeTagTimeline
      ? timelineCandidateEvents.filter((event) => matchesTagTimeline(event, activeTagTimeline, {
        semanticScore: semanticTimelineScores.get(event.id) ?? null,
      }))
      : events),
    [activeTagTimeline, events, semanticTimelineScores, timelineCandidateEvents],
  )
  // Moderate after exact-tag and semantic candidates are merged so hashtag
  // timelines follow the same safety path as every other feed surface.
  const moderationDocuments = useMemo(
    () => tagMatchedEvents
      .map((event) => buildEventModerationDocument(event))
      .filter((document): document is NonNullable<ReturnType<typeof buildEventModerationDocument>> => document !== null),
    [tagMatchedEvents],
  )
  const moderationDocumentIds = useMemo(
    () => new Set(moderationDocuments.map((document) => document.id)),
    [moderationDocuments],
  )
  const {
    allowedIds: allowedModerationIds,
    loading: moderationLoading,
  } = useModerationDocuments(moderationDocuments)

  const pullY     = useMotionValue(0)
  const pullHint  = useTransform(pullY, [0, COMPOSE_TRIGGER_OFFSET], [0, 1])
  const hintY     = useTransform(pullY, [0, COMPOSE_TRIGGER_OFFSET], [-8, 0])

  const visibleEvents = useMemo(
    () => filterNsfwTaggedEvents(
      tagMatchedEvents.filter((event) => {
        if (isMuted(event.pubkey)) return false
        if (moderationDocumentIds.has(event.id) && !allowedModerationIds.has(event.id) && !moderationLoading) return false

        // Word mutes: hide events whose content contains a muted keyword.
        if (mutedWords.size > 0) {
          const lower = event.content.toLowerCase()
          for (const word of mutedWords) {
            if (lower.includes(word)) return false
          }
        }

        // Hashtag mutes: hide events that carry a muted #tag.
        if (mutedHashtags.size > 0) {
          const tags = extractEventHashtags(event)
          if (tags.some((tag) => mutedHashtags.has(tag))) return false
        }

        return true
      }),
      hideNsfwTaggedPosts,
    ),
    [allowedModerationIds, hideNsfwTaggedPosts, isMuted, moderationDocumentIds, moderationLoading, mutedHashtags, mutedWords, tagMatchedEvents],
  )
  const repostFeatureEnabled = !activeTagTimeline && activeSection.id === 'feed' && repostCarouselVisible
  const repostCarouselItems = useMemo(
    () => (repostFeatureEnabled
      ? collectRepostCarouselItems(visibleEvents, { minReposts: 3, maxItems: 12 })
      : []),
    [repostFeatureEnabled, visibleEvents],
  )
  const featuredRepostTargetIds = useMemo(
    () => (repostFeatureEnabled
      ? new Set(repostCarouselItems.map((item) => item.targetEventId))
      : new Set<string>()),
    [repostCarouselItems, repostFeatureEnabled],
  )
  const curatedFeedEvents = useMemo(() => {
    if (!repostFeatureEnabled) return visibleEvents

    const reducedEvents = visibleEvents.filter((event) => {
      const repost = parseRepostEvent(event)
      if (!repost) return true
      return !featuredRepostTargetIds.has(repost.targetEventId)
    })

    return reducedEvents.length >= MIN_PRIMARY_FEED_ITEMS ? reducedEvents : visibleEvents
  }, [featuredRepostTargetIds, repostFeatureEnabled, visibleEvents])
  // ── Topic clustering ────────────────────────────────────────────────────
  // Only run on text-heavy sections where topic grouping is meaningful.
  const topicClustersEnabled = (
    activeSection.id === 'feed' ||
    activeSection.id === 'notes'
  )
  const {
    topics,
    topicFilter,
    setTopicFilter,
    eventPassesFilter,
    clustering,
  } = useTopicClusters(visibleEvents, topicClustersEnabled)

  const topicFilteredEvents = useMemo(
    () => topicFilter === null
      ? curatedFeedEvents
      : curatedFeedEvents.filter(e => eventPassesFilter(e.id)),
    [topicFilter, curatedFeedEvents, eventPassesFilter],
  )

  const heroEvent = topicFilteredEvents[0] ?? null
  const secondaryEvents = topicFilteredEvents.slice(1)
  const feedSurfaceLoading = loading || moderationLoading
  const _feedLoading = loading || semanticTimelineLoading || moderationLoading || muteListLoading

  useEffect(() => {
    warmSelfThreadIndexCache(visibleEvents)
  }, [visibleEvents])

  const persistFeedPosition = useCallback(() => {
    if (!resumeFeedPosition) return
    const container = scrollContainerRef.current
    if (!container) return

    const anchor = getVisibleAnchor(container)
    saveFeedViewSnapshot(feedScopeKey, {
      anchorEventId: anchor?.id ?? null,
      anchorOffset: anchor?.offset ?? 0,
      scrollTop: container.scrollTop,
      savedAt: Date.now(),
    })
  }, [feedScopeKey, resumeFeedPosition])

  useEffect(() => {
    setResumeFeedPosition(getFeedResumeEnabled(resumeScopeId))

    const onUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ scopeId?: string }>
      if (customEvent.detail?.scopeId !== resumeScopeId) return
      setResumeFeedPosition(getFeedResumeEnabled(resumeScopeId))
    }

    const onStorage = (event: StorageEvent) => {
      if (!event.key) return
      if (!event.key.endsWith(`:${resumeScopeId}`)) return
      setResumeFeedPosition(getFeedResumeEnabled(resumeScopeId))
    }

    window.addEventListener(FEED_RESUME_UPDATED_EVENT, onUpdated as EventListener)
    window.addEventListener('storage', onStorage)

    return () => {
      window.removeEventListener(FEED_RESUME_UPDATED_EVENT, onUpdated as EventListener)
      window.removeEventListener('storage', onStorage)
    }
  }, [resumeScopeId])

  useEffect(() => {
    if (!resumeFeedPosition) {
      clearFeedViewSnapshot(feedScopeKey)
      const container = scrollContainerRef.current
      if (container) {
        container.scrollTop = 0
      }
      restoreCompletedRef.current = true
    } else {
      restoreCompletedRef.current = false
    }
  }, [feedScopeKey, resumeFeedPosition])

  useEffect(() => {
    if (!resumeFeedPosition) return
    const container = scrollContainerRef.current
    if (!container) return

    const onScroll = () => {
      if (rafSaveRef.current !== null) {
        cancelAnimationFrame(rafSaveRef.current)
      }
      rafSaveRef.current = requestAnimationFrame(() => {
        persistFeedPosition()
        rafSaveRef.current = null
      })
    }

    container.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      container.removeEventListener('scroll', onScroll)
      if (rafSaveRef.current !== null) {
        cancelAnimationFrame(rafSaveRef.current)
        rafSaveRef.current = null
      }
    }
  }, [persistFeedPosition, resumeFeedPosition])

  useEffect(() => {
    if (!resumeFeedPosition) return
    const onPageHide = () => persistFeedPosition()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        persistFeedPosition()
      }
    }
    const onFreeze = () => persistFeedPosition()

    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('freeze', onFreeze)

    return () => {
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('freeze', onFreeze)
      persistFeedPosition()
    }
  }, [persistFeedPosition, resumeFeedPosition])

  useEffect(() => {
    if (!resumeFeedPosition) return
    if (restoreCompletedRef.current) return
    if (feedSurfaceLoading) return
    if (visibleEvents.length === 0 && !eose) return

    const container = scrollContainerRef.current
    const snapshot = getFeedViewSnapshot(feedScopeKey)
    if (!container) {
      restoreCompletedRef.current = true
      return
    }

    if (!snapshot) {
      container.scrollTop = 0
      restoreCompletedRef.current = true
      return
    }

    let firstFrame: number | null = null
    let secondFrame: number | null = null
    let cancelled = false

    const restore = () => {
      if (cancelled) return true

      let restored = false

      if (snapshot.anchorEventId) {
        const selector = `[data-feed-event-id="${snapshot.anchorEventId}"]`
        const anchorElement = container.querySelector<HTMLElement>(selector)
        if (anchorElement) {
          const nextTop = Math.max(0, anchorElement.offsetTop - snapshot.anchorOffset)
          container.scrollTop = nextTop
          restored = true
        }
      }

      // If we have an anchor but it is not loaded yet, wait for more feed items
      // instead of falling back early and causing a visible jump later.
      if (!restored && snapshot.anchorEventId && !eose) {
        return false
      }

      if (!restored && Number.isFinite(snapshot.scrollTop) && snapshot.scrollTop > 0) {
        container.scrollTop = snapshot.scrollTop
        restored = true
      }

      return restored || eose
    }

    // Let layout settle before applying the anchor offset.
    firstFrame = requestAnimationFrame(() => {
      if (cancelled) return
      const firstPassDone = restore()
      secondFrame = requestAnimationFrame(() => {
        if (cancelled) return
        const secondPassDone = restore()
        if (firstPassDone || secondPassDone) {
          restoreCompletedRef.current = true
        }
      })
    })

    return () => {
      cancelled = true
      if (firstFrame !== null) {
        cancelAnimationFrame(firstFrame)
      }
      if (secondFrame !== null) {
        cancelAnimationFrame(secondFrame)
      }
    }
  }, [eose, feedScopeKey, feedSurfaceLoading, resumeFeedPosition, visibleEvents])

  const checkEvent      = useEventFilterCheck()
  const semanticResults = useSemanticFiltering(visibleEvents)

  const virtualizer = useVirtualizer({
    count: secondaryEvents.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 280,
    overscan: 5,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const virtualPaddingTop = virtualItems.length > 0 ? (virtualItems[0]?.start ?? 0) : 0
  const virtualPaddingBottom = virtualItems.length > 0
    ? virtualizer.getTotalSize() - (virtualItems.at(-1)?.end ?? 0)
    : 0

  const handleCompose = useCallback(() => {
    navigate({
      pathname: location.pathname,
      search: buildComposeSearch(location.search),
    })
  }, [location.pathname, location.search, navigate])

  const handleComposeStory = useCallback(() => {
    navigate({
      pathname: location.pathname,
      search: buildComposeSearch(location.search, { story: true }),
    })
  }, [location.pathname, location.search, navigate])

  const stopPullGestureCapture = useCallback((event: React.PointerEvent) => {
    event.stopPropagation()
  }, [])

  const handlePullRelease = useCallback(
    (_: unknown, info: { offset: { y: number } }) => {
      if (info.offset.y >= COMPOSE_TRIGGER_OFFSET) {
        handleCompose()
      }
      pullY.set(0)
    },
    [handleCompose, pullY],
  )

  const handleSectionChange = useCallback((id: string) => {
    const section = railSections.find((candidate) => candidate.id === id)
    if (!section) return

    if (section.href) {
      navigate(section.href, { replace: section.href === `${location.pathname}${location.search}` })
      return
    }

    setActiveSectionId(id)
    setTopicFilter(null)
    if (routeSection) {
      navigate('/', { replace: true })
    }
  }, [location.pathname, location.search, navigate, railSections, routeSection, setTopicFilter])

  useEffect(() => {
    const scopeId = currentUser?.pubkey ?? 'anon'
    setRepostCarouselVisible(getRepostCarouselVisible(scopeId))
    setFeedInlineAutoplayEnabled(getFeedInlineMediaAutoplayEnabled(scopeId))

    const onUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ scopeId?: string }>
      if ((customEvent.detail?.scopeId ?? 'anon') !== scopeId) return
      setRepostCarouselVisible(getRepostCarouselVisible(scopeId))
      setFeedInlineAutoplayEnabled(getFeedInlineMediaAutoplayEnabled(scopeId))
    }

    const onStorage = (storageEvent: StorageEvent) => {
      if (!storageEvent.key) return
      if (!storageEvent.key.endsWith(`:${scopeId}`)) return
      setRepostCarouselVisible(getRepostCarouselVisible(scopeId))
      setFeedInlineAutoplayEnabled(getFeedInlineMediaAutoplayEnabled(scopeId))
    }

    window.addEventListener(ZEN_SETTINGS_UPDATED_EVENT, onUpdated as EventListener)
    window.addEventListener('storage', onStorage)

    return () => {
      window.removeEventListener(ZEN_SETTINGS_UPDATED_EVENT, onUpdated as EventListener)
      window.removeEventListener('storage', onStorage)
    }
  }, [currentUser?.pubkey])

  const sectionSummary = headerSection.summary
  const showStories = !activeTagTimeline && activeSection.id === 'feed'
  const showRepostCarousel = repostFeatureEnabled && repostCarouselItems.length > 0
  const showArticleFeeds = activeSection.id === 'articles' && activeArticleFeed !== null
  const customArticleFeedCount = articleFeedSections.filter((section) => section.tone === 'custom').length
  const savedFeedTopicOverflow = Math.max(0, (activeSavedTagFeed?.includeTags.length ?? 0) - 4)
  const headerActions = (
    <div className="flex items-center gap-1 pt-0.5">
      <button
        type="button"
        onClick={() => navigate(currentUser ? '/profile' : '/onboard')}
        onPointerDownCapture={stopPullGestureCapture}
        className="
          flex h-10 w-10 shrink-0 items-center justify-center rounded-full
          overflow-hidden text-[rgb(var(--color-label-secondary))]
          transition-opacity active:opacity-70
        "
        aria-label={currentUser ? tApp('navMyProfile') : tApp('navSignIn')}
      >
        {currentUserProfile?.picture ? (
          <img
            src={currentUserProfile.picture}
            alt="Profile"
            className="h-9 w-9 rounded-full object-cover"
            loading="lazy"
          />
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="8" r="5" />
            <path d="M20 21a8 8 0 0 0-16 0" />
          </svg>
        )}
      </button>

      <button
        type="button"
        onClick={() => navigate('/activity')}
        onPointerDownCapture={stopPullGestureCapture}
        className="
          relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full
          text-[rgb(var(--color-label-secondary))]
          transition-opacity active:opacity-70
        "
        aria-label={tApp('navActivity')}
      >
        {currentUser && hasUnreadActivity && (
          <span
            className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-[rgb(var(--color-system-red))] px-1 py-[1px] text-center text-[10px] font-semibold leading-[1.2] text-white"
            aria-label={tApp('navUnreadNotifications', { count: activityUnreadCount })}
          >
            {activityUnreadBadgeText}
          </span>
        )}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
          <path d="M10.5 20a1.5 1.5 0 0 0 3 0" />
        </svg>
      </button>

      <button
        type="button"
        onClick={() => navigate('/settings')}
        onPointerDownCapture={stopPullGestureCapture}
        className="
          flex h-10 w-10 shrink-0 items-center justify-center rounded-full
          text-[rgb(var(--color-label-secondary))]
          transition-opacity active:opacity-70
        "
        aria-label={tApp('navSettings')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      <button
        type="button"
        onClick={handleCompose}
        onPointerDownCapture={stopPullGestureCapture}
        className="
          flex h-10 w-10 shrink-0 items-center justify-center rounded-full
          text-[rgb(var(--color-label))]
          transition-opacity active:opacity-70
        "
        aria-label={tApp('navComposeNote')}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))] flex flex-col overflow-hidden">

      {/* Pull-down compose hint — fades in as the user pulls */}
      <motion.div
        className="
          absolute top-safe left-0 right-0 z-20
          flex items-center justify-center pt-3 pb-2
          pointer-events-none
        "
        style={{ opacity: pullHint, y: hintY }}
        aria-hidden="true"
      >
        <div className="glass rounded-full px-4 py-1.5 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[rgb(var(--color-accent))]" />
          <span className="text-[rgb(var(--color-label))] text-[14px] font-medium">
            {tApp('feedPullToCompose')}
          </span>
        </div>
      </motion.div>

      {/* Main draggable container — pull-down triggers compose */}
      <motion.div
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.45 }}
        dragMomentum={false}
        style={{ y: pullY }}
        onDragEnd={handlePullRelease}
        className="flex min-h-0 flex-col flex-1"
      >
        <div
          ref={scrollContainerRef}
          id={`feed-section-${activeSection.id}`}
          role="tabpanel"
          className="
            min-h-0 flex-1 overflow-y-auto
            px-4 pb-safe
          "
        >
          <div className="pb-6 pt-safe">
            <section className="px-1 pt-2">
              {activeSavedTagFeed ? (
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1" />
                  {headerActions}
                </div>
              ) : (
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="section-kicker">Nostr Paper</p>
                    <h1 className="mt-1.5 text-[30px] font-semibold leading-[1.02] tracking-[-0.04em] text-[rgb(var(--color-label))]">
                      <TwemojiText text={headerSection.label} />
                    </h1>
                    <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                      {sectionSummary}
                    </p>
                  </div>

                  {headerActions}
                </div>
              )}

              <button
                type="button"
                onClick={() => navigate('/explore')}
                onPointerDownCapture={stopPullGestureCapture}
                className="
                  mt-4 flex w-full items-center gap-3 border-b border-[rgb(var(--color-fill)/0.12)] pb-3
                  text-left text-[15px] text-[rgb(var(--color-label-tertiary))]
                  transition-opacity active:opacity-80
                "
                aria-label={tApp('feedOpenSearch')}
              >
                <svg
                  width="16" height="16" viewBox="0 0 16 16" fill="none"
                  className="text-[rgb(var(--color-label-tertiary))] flex-shrink-0"
                  aria-hidden
                >
                  <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="truncate">{tApp('feedSearchPrompt')}</span>
              </button>
            </section>

            <div className="mt-2">
              <SectionRail
                sections={railSections}
                activeId={activeSection.id}
                onSelect={handleSectionChange}
              />
              <TopicFilterRail
                topics={topics}
                activeTopicId={topicFilter}
                onSelect={setTopicFilter}
                clustering={clustering}
              />
            </div>

            {activeSavedTagFeed && (
              <div className="mt-4 px-1">
                <div className="overflow-hidden rounded-[28px] border border-[rgb(var(--color-fill)/0.1)] bg-[rgb(var(--color-bg-secondary))]">
                  <div className="relative h-40 overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(var(--color-accent),0.2),_transparent_55%),linear-gradient(180deg,_rgba(var(--color-fill),0.14),_rgba(var(--color-fill),0.05))]">
                    <FeedHeaderImage
                      src={activeSavedTagFeed.banner || null}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,0.22))]" />
                  </div>

                  <div className="relative px-4 pb-4">
                    <div className="-mt-10 flex items-end justify-between gap-3">
                      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full ring-4 ring-[rgb(var(--color-bg))]">
                        <FeedHeaderImage
                          src={activeSavedTagFeed.avatar || null}
                          alt={`${headerSection.label} avatar`}
                          className="h-full w-full object-cover"
                          fallback={(
                            <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(145deg,rgba(var(--color-accent),0.18),rgba(var(--color-fill),0.12))] text-[rgb(var(--color-label))]">
                              <span className="text-[28px] font-semibold">
                                {(headerSection.label.trim().replace(/^#/, '')[0] ?? 'F').toUpperCase()}
                              </span>
                            </div>
                          )}
                        />
                      </div>

                      <div className="flex flex-wrap justify-end gap-2">
                        <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))]">
                          {activeSavedTagFeed.includeTags.length} topic{activeSavedTagFeed.includeTags.length === 1 ? '' : 's'}
                        </span>
                        <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))]">
                          {activeSavedTagFeed.mode === 'all' ? 'All topics' : 'Any topic'}
                        </span>
                        {activeSavedTagFeed.profilePubkeys.length > 0 && (
                          <span className="rounded-full bg-[rgb(var(--color-accent)/0.08)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))]">
                            {activeSavedTagFeed.profilePubkeys.length} profile{activeSavedTagFeed.profilePubkeys.length === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-3">
                      <h1 className="text-[30px] font-semibold leading-[1.02] tracking-[-0.04em] text-[rgb(var(--color-label))]">
                        <TwemojiText text={headerSection.label} />
                      </h1>
                      <p className="mt-2 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                        {sectionSummary}
                      </p>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {activeSavedTagFeed.includeTags.slice(0, 4).map((tag) => (
                        <span
                          key={`saved-header:${activeSavedTagFeed.id}:${tag}`}
                          className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label))]"
                        >
                          #{tag}
                        </span>
                      ))}
                      {savedFeedTopicOverflow > 0 && (
                        <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">
                          +{savedFeedTopicOverflow}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {showArticleFeeds && activeArticleFeed && (
              <div className="mt-4 space-y-3">
                <ArticleFeedShowcase
                  feed={activeArticleFeed}
                  totalFeedCount={articleFeedSections.length}
                  customFeedCount={customArticleFeedCount}
                  followingCount={articleFeedFollowingCount}
                  loading={articleFeedSectionsLoading}
                  onManage={() => navigate('/settings/tag-feeds')}
                />

                <SectionRail
                  sections={articleFeedSections}
                  activeId={activeArticleFeed.id}
                  onSelect={setActiveArticleFeedId}
                />
              </div>
            )}

            {activeTagTimeline && semanticTimelineError && (
              <p className="mt-3 px-1 text-[12px] leading-5 text-[rgb(var(--color-label-tertiary))]">
                Semantic context is temporarily unavailable. Exact hashtags and plain-text matching are still active.
              </p>
            )}

            {showStories && (
              <div className="mt-3">
                <StoryRail onComposeStory={handleComposeStory} />
              </div>
            )}

            {showRepostCarousel && (
              <div className="mt-3">
                <RepostCarousel items={repostCarouselItems} />
              </div>
            )}

            <div className="mt-3">
              {feedSurfaceLoading && !heroEvent ? (
                <FeedSkeleton type="hero" />
              ) : heroEvent ? (
                <div data-feed-event-id={heroEvent.id}>
                  <FilteredGate
                    result={mergeResults(
                      checkEvent(heroEvent),
                      semanticResults.get(heroEvent.id) ?? { action: null, matches: [] },
                    )}
                  >
                    <HeroCard event={heroEvent} index={0} />
                  </FilteredGate>
                </div>
              ) : eose && !moderationLoading ? (
                <EmptyState
                  isTagMix={Boolean(activeTagTimelineDetails && (activeTagTimelineDetails.includeTags.length > 1 || activeTagTimelineDetails.excludeTags.length > 0))}
                  tag={activeTagTimelineDetails && activeTagTimelineDetails.includeTags.length === 1
                    ? activeTagTimelineDetails.includeTags[0] ?? null
                    : null}
                />
              ) : null}
            </div>

            <div className="mt-4">
              {feedSurfaceLoading && secondaryEvents.length === 0 ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }, (_, i) => (
                    <FeedSkeleton key={i} type="card" />
                  ))}
                </div>
              ) : (
                  <div style={{ paddingTop: `${virtualPaddingTop}px`, paddingBottom: `${virtualPaddingBottom}px` }}>
                    {virtualItems.map((virtualRow) => {
                      const event = secondaryEvents[virtualRow.index] as NostrEvent
                      return (
                        <div
                          key={event.id}
                          ref={virtualizer.measureElement}
                          data-index={virtualRow.index}
                          className="pb-3"
                        >
                          <MemoSecondaryCard
                            event={event}
                            index={virtualRow.index}
                            checkEvent={checkEvent}
                            semanticResult={semanticResults.get(event.id) ?? EMPTY_FILTER_RESULT}
                            feedInlineAutoplayEnabled={feedInlineAutoplayEnabled}
                          />
                        </div>
                      )
                    })}
                  </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ── Secondary Card ───────────────────────────────────────────

interface SecondaryCardProps {
  event: NostrEvent
  index: number
  checkEvent: (_event: NostrEvent, _profile?: Profile) => FilterCheckResult
  semanticResult: FilterCheckResult
  feedInlineAutoplayEnabled: boolean
}

export function SecondaryCard({ event, index, checkEvent, semanticResult, feedInlineAutoplayEnabled }: SecondaryCardProps) {
  const navigate = useNavigate()
  const { profile } = useProfile(event.pubkey, { background: false })
  const threadIndex = useSelfThreadIndex(event)
  const followStatus = useFollowStatus(event.pubkey)
  const { ref: visibilityRef, visible: storyPreviewVisible } = useVisibilityOnce<HTMLDivElement>()
  const filterResult = mergeResults(checkEvent(event, profile ?? undefined), semanticResult)
  const entryDelay = Math.min(index, 5) * 0.04
  const comment = parseCommentEvent(event)
  const {
    article,
    poll,
    video,
    repost,
    thread,
    attachments,
    hiddenUrls,
    quoteBody,
    contentWarning,
    isArticleStory,
    isVideoStory: _isVideoStory,
    isStoryCard,
    articlePreview,
    videoPoster,
    videoPlaybackPlan,
    storyAuthor,
    storyNostrCreator,
    storyNostrNip05,
    storyHostname,
    storySiteName,
    storySummary,
    storyTitle,
  } = useStoryCardPreview(event, { ogEnabled: storyPreviewVisible })
  const href = article?.route ?? video?.route ?? `/note/${event.id}`
  return (
    <FilteredGate result={filterResult}>
      <motion.div
        ref={visibilityRef}
        data-feed-event-id={event.id}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{
          type:    'spring',
          stiffness: 280,
          damping:   28,
          delay:   entryDelay,
        }}
        className="
          app-panel
          rounded-ios-xl p-4
          card-elevated
          tap-none cursor-pointer
        "
        role="button"
        tabIndex={0}
        onPointerDownCapture={(eventPointer) => {
          eventPointer.stopPropagation()
        }}
        onClick={() => navigate(href)}
        onKeyDown={(eventKey) => {
          if (eventKey.key === 'Enter' || eventKey.key === ' ') {
            eventKey.preventDefault()
            navigate(href)
          }
        }}
      >
        {isStoryCard && (
          <RichStoryMedia
            eventId={event.id}
            eventCreatedAt={event.created_at}
            isArticle={isArticleStory}
            articleImage={articlePreview}
            video={video}
            videoPoster={videoPoster}
            playbackSources={videoPlaybackPlan?.sources}
            isSensitive={contentWarning !== null}
            sensitiveReason={contentWarning?.reason}
            isUnfollowed={followStatus === false}
            feedInlineAutoplayEnabled={feedInlineAutoplayEnabled}
          />
        )}

        {repost && (
          <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M17 1l4 4-4 4" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <path d="M7 23l-4-4 4-4" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
            <span>Repost</span>
          </div>
        )}
        <AuthorRow
          pubkey={event.pubkey}
          profile={profile}
          timestamp={event.created_at}
          actions
        />
        {(thread || comment) && (
          <p className="mt-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
            {thread ? 'Thread' : 'Comment'}
          </p>
        )}
        <ThreadIndexBadge threadIndex={threadIndex} className="mt-3" />
        {poll ? (
          <PollPreview poll={poll} className="mt-3" compact />
        ) : storyTitle && (
          <h3 className="mt-3 text-[20px] leading-tight font-semibold tracking-[-0.025em] text-[rgb(var(--color-label))]">
            <TwemojiText text={storyTitle} />
          </h3>
        )}
        {!poll && (storyAuthor || storySiteName) && isStoryCard && (
          <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-tertiary))]">
            {storyAuthor && storySiteName
              ? `By ${storyAuthor} • ${storySiteName}`
              : storyAuthor
                ? `By ${storyAuthor}`
                : storySiteName}
          </p>
        )}
        {!poll && isStoryCard && storyNostrCreator && (
          <NostrCreatorAttribution
            nostrCreator={storyNostrCreator}
            {...(storyNostrNip05 !== undefined ? { nostrNip05: storyNostrNip05 } : {})}
            pageHostname={storyHostname ?? null}
            className="mt-2 rounded-[14px] bg-[rgb(var(--color-fill)/0.03)]"
          />
        )}
        {!poll && storySummary ? (
          <>
            <p className="mt-2 text-[15px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
              <TwemojiText text={storySummary} />
            </p>
            {!isStoryCard && (
              <TranslateTextPanel text={thread?.content ?? ''} />
            )}
          </>
        ) : !poll && repost ? (
          <RepostBody event={event} className="mt-3" compact linked={false} showLabel={false} />
        ) : !poll ? (
          <>
            {quoteBody.trim().length > 0 && (
              <NoteContent
                content={quoteBody}
                compact
                className="mt-2"
                hiddenUrls={hiddenUrls}
                allowTranslation
              />
            )}
            {attachments.length > 0 && (
              <NoteMediaAttachments
                attachments={attachments}
                className="mt-3"
                compact
                interactive
                isSensitive={contentWarning !== null}
                sensitiveReason={contentWarning?.reason ?? null}
              />
            )}
            <QuotePreviewList event={event} className="mt-3" compact linked={false} maxItems={1} showHeader={false} />
          </>
        ) : null}
        <EventMetricsRow event={event} interactive />
      </motion.div>
    </FilteredGate>
  )
}

const MemoSecondaryCard = memo(SecondaryCard)

interface RichStoryMediaProps {
  eventId: string
  eventCreatedAt: number
  isArticle: boolean
  articleImage: string | undefined
  video: ParsedVideoEvent | null
  videoPoster: string | undefined
  playbackSources: Array<{ url: string; type?: string }> | undefined
  isSensitive: boolean
  sensitiveReason: string | null | undefined
  isUnfollowed: boolean
  feedInlineAutoplayEnabled: boolean
}

const FEED_INLINE_MEDIA_CIRCUIT_OPEN_EVENT = 'paper:feed-inline-media-circuit-open'
const FEED_INLINE_MEDIA_FAILURE_THRESHOLD = 3
const FEED_INLINE_MEDIA_CIRCUIT_COOLDOWN_MS = 5 * 60 * 1000
let feedInlineMediaAutoplayFailures = 0
let feedInlineMediaAutoplayCircuitOpen = false
let feedInlineMediaAutoplayCircuitOpenedAt = 0

function isFeedInlineMediaAutoplayCircuitOpen(): boolean {
  if (!feedInlineMediaAutoplayCircuitOpen) return false
  if (Date.now() - feedInlineMediaAutoplayCircuitOpenedAt < FEED_INLINE_MEDIA_CIRCUIT_COOLDOWN_MS) {
    return true
  }

  feedInlineMediaAutoplayCircuitOpen = false
  feedInlineMediaAutoplayFailures = 0
  feedInlineMediaAutoplayCircuitOpenedAt = 0
  return false
}

function recordFeedInlineMediaAutoplayFailure(): void {
  if (isFeedInlineMediaAutoplayCircuitOpen()) return

  feedInlineMediaAutoplayFailures += 1
  if (feedInlineMediaAutoplayFailures < FEED_INLINE_MEDIA_FAILURE_THRESHOLD) return

  feedInlineMediaAutoplayCircuitOpen = true
  feedInlineMediaAutoplayCircuitOpenedAt = Date.now()
  window.dispatchEvent(new Event(FEED_INLINE_MEDIA_CIRCUIT_OPEN_EVENT))
}

function markInlineAutoplaySourcesFailed(
  currentSrc: string,
  sources: Array<{ url: string }>,
) {
  if (currentSrc) {
    recordMediaUrlFailure(currentSrc)
  }

  sources.forEach((source) => {
    if (source.url !== currentSrc) {
      recordMediaUrlFailure(source.url)
    }
  })
}

function RichStoryMedia({
  eventId,
  eventCreatedAt,
  isArticle,
  articleImage,
  video,
  videoPoster,
  playbackSources,
  isSensitive,
  sensitiveReason,
  isUnfollowed,
  feedInlineAutoplayEnabled,
}: RichStoryMediaProps) {
  const enableFeedInlineMedia = import.meta.env.VITE_ENABLE_FEED_INLINE_MEDIA === 'true' && feedInlineAutoplayEnabled
  const [autoplayFailed, setAutoplayFailed] = useState(false)

  // ── Rich-story media moderation ──────────────────────────────
  // Classify the card image/poster before rendering. failClosed keeps the
  // placeholder visible during classification instead of flashing content.
  const richMediaModerationDocument = useMemo(
    () => buildMediaModerationDocument({
      id: `${eventId}:rich-story`,
      kind: isArticle ? 'image' : 'video_preview',
      url: (articleImage ?? videoPoster) ?? null,
      updatedAt: eventCreatedAt,
    }),
    [eventId, eventCreatedAt, articleImage, videoPoster, isArticle],
  )
  const { blocked: richMediaBlocked, loading: richModerationLoading } = useMediaModerationDocument(
    richMediaModerationDocument,
    { failClosed: true },
  )
  const filteredPlaybackSources = useMemo(
    () => (playbackSources ?? []).filter((source) => shouldAttemptMediaUrl(source.url)),
    [playbackSources],
  )

  useEffect(() => {
    setAutoplayFailed(false)
  }, [video?.id])

  useEffect(() => {
    if (isFeedInlineMediaAutoplayCircuitOpen()) {
      setAutoplayFailed(true)
      return undefined
    }

    const handleCircuitOpen = () => {
      setAutoplayFailed(true)
    }

    window.addEventListener(FEED_INLINE_MEDIA_CIRCUIT_OPEN_EVENT, handleCircuitOpen)
    return () => window.removeEventListener(FEED_INLINE_MEDIA_CIRCUIT_OPEN_EVENT, handleCircuitOpen)
  }, [])

  const sourceCandidates = useMemo(
    () => [
      ...(video?.references ?? []),
      ...(filteredPlaybackSources.map((source) => source.url)),
    ],
    [filteredPlaybackSources, video?.references],
  )

  const youTubeId = useMemo(() => {
    for (const candidate of sourceCandidates) {
      const id = getYouTubeVideoId(candidate)
      if (id) return id
    }
    return null
  }, [sourceCandidates])

  const vimeoId = useMemo(() => {
    for (const candidate of sourceCandidates) {
      const id = getVimeoVideoId(candidate)
      if (id) return id
    }
    return null
  }, [sourceCandidates])

  const peertubeEmbed = useMemo(() => {
    for (const candidate of sourceCandidates) {
      const embed = getPeerTubeEmbedUrl(candidate)
      if (embed) return embed
    }
    return null
  }, [sourceCandidates])

  const canAutoplayVideo = Boolean(
    enableFeedInlineMedia &&
    video &&
    filteredPlaybackSources.length > 0 &&
    !isSensitive &&
    !isUnfollowed &&
    !youTubeId &&
    !vimeoId &&
    !peertubeEmbed &&
    !isFeedInlineMediaAutoplayCircuitOpen() &&
    !autoplayFailed &&
    !richMediaBlocked &&
    !richModerationLoading,
  )
  const { ref: mediaRef, visible: mediaVisible } = useVisibilityOnce<HTMLDivElement>({
    rootMargin: '320px 0px',
  })
  const imageSrc = articleImage ?? videoPoster
  const aspectClassName = video?.isShort ? 'aspect-[4/5]' : 'aspect-[16/9]'
  const label = isArticle ? 'Article' : video?.isShort ? 'Short video' : 'Video'

  return (
    <div ref={mediaRef} className={`relative mb-4 overflow-hidden rounded-[18px] bg-[rgb(var(--color-surface-secondary))] ${aspectClassName}`}>
      {richMediaBlocked || richModerationLoading ? (
        <div
          className="h-full w-full"
          style={{
            background: 'linear-gradient(135deg, rgba(42, 54, 72, 0.18), rgba(42, 54, 72, 0.04))',
          }}
        />
      ) : enableFeedInlineMedia && mediaVisible && youTubeId ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${youTubeId}?modestbranding=1&playsinline=1&rel=0`}
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="YouTube video"
        />
      ) : enableFeedInlineMedia && mediaVisible && vimeoId ? (
        <iframe
          src={`https://player.vimeo.com/video/${vimeoId}?title=0&byline=0&portrait=0`}
          className="h-full w-full"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          title="Vimeo video"
        />
      ) : enableFeedInlineMedia && mediaVisible && peertubeEmbed ? (
        <iframe
          src={peertubeEmbed}
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="PeerTube video"
        />
      ) : mediaVisible && canAutoplayVideo ? (
        <video
          poster={videoPoster ?? undefined}
          muted
          playsInline
          autoPlay
          loop
          preload="none"
          onLoadedData={() => {
            filteredPlaybackSources.forEach((source) => recordMediaUrlSuccess(source.url))
          }}
          onError={(mediaEvent) => {
            const currentSrc = mediaEvent.currentTarget.currentSrc
            markInlineAutoplaySourcesFailed(currentSrc, filteredPlaybackSources)
            recordFeedInlineMediaAutoplayFailure()
            setAutoplayFailed(true)
          }}
          onAbort={(mediaEvent) => {
            const currentSrc = mediaEvent.currentTarget.currentSrc
            markInlineAutoplaySourcesFailed(currentSrc, filteredPlaybackSources)
            recordFeedInlineMediaAutoplayFailure()
            setAutoplayFailed(true)
          }}
          className="h-full w-full object-cover"
          aria-label={label}
        >
          {filteredPlaybackSources.map((source) => (
            <source
              key={`${source.url}:${source.type ?? 'unknown'}`}
              src={source.url}
              {...(source.type ? { type: source.type } : {})}
            />
          ))}
        </video>
      ) : imageSrc && !richMediaBlocked && !richModerationLoading ? (
        <SensitiveImage
          src={imageSrc}
          className="h-full w-full"
          disableTilt
          isSensitive={isSensitive}
          reason={sensitiveReason}
          isUnfollowed={isUnfollowed}
        />
      ) : (
        <div
          className="h-full w-full"
          style={{
            background: 'linear-gradient(135deg, rgba(42, 54, 72, 0.18), rgba(42, 54, 72, 0.04))',
          }}
        />
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/50 to-transparent" />

      <div className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-black/28 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white backdrop-blur-md">
        {video && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
            <path d="M3 2.25v5.5L7.25 5 3 2.25Z" fill="currentColor" />
          </svg>
        )}
        <span>{label}</span>
      </div>
    </div>
  )
}

// ── Empty State ──────────────────────────────────────────────

function EmptyState({
  tag,
  isTagMix = false,
}: {
  tag?: string | null
  isTagMix?: boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="
        flex flex-col items-center justify-center
        app-panel rounded-ios-2xl
        px-8 py-14 text-center
      "
      style={{ height: 'clamp(320px, 44svh, 460px)' }}
    >
      <div className="mb-5 h-14 w-14 rounded-full bg-[rgb(var(--color-fill)/0.08)]" aria-hidden="true" />
      <p className="text-headline text-[rgb(var(--color-label))] mb-2">
        {isTagMix ? 'No matching posts yet' : tag ? `No #${tag} posts yet` : 'No posts yet'}
      </p>
      <p className="text-body text-[rgb(var(--color-label-secondary))]">
        {isTagMix
          ? 'Try fewer required hashtags or remove an excluded tag.'
          : tag
            ? 'Try another hashtag or check back after relays sync.'
            : 'Connecting to relays…'}
      </p>
    </motion.div>
  )
}
