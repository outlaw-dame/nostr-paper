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

import { useState, useCallback, useMemo } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { motion, useMotionValue, useTransform, AnimatePresence } from 'motion/react'
import { useApp } from '@/contexts/app-context'
import { useNostrFeed } from '@/hooks/useNostrFeed'
import { HeroCard } from '@/components/cards/HeroCard'
import { StoryRail } from '@/components/feed/StoryRail'
import { SectionRail } from '@/components/feed/SectionRail'
import { FeedSkeleton } from '@/components/feed/FeedSkeleton'
import { NoteContent } from '@/components/cards/NoteContent'
import { SensitiveImage } from '@/components/media/SensitiveImage'
import { NoteMediaAttachments } from '@/components/nostr/NoteMediaAttachments'
import { PollPreview } from '@/components/nostr/PollPreview'
import { QuotePreviewList } from '@/components/nostr/QuotePreviewList'
import { RepostBody } from '@/components/nostr/RepostBody'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { TwemojiText } from '@/components/ui/TwemojiText'
import { TranslateTextPanel } from '@/components/translation/TranslateTextPanel'
import { FilteredGate } from '@/components/filters/FilteredGate'
import { useFollowStatus } from '@/hooks/useFollowStatus'
import { useProfile } from '@/hooks/useProfile'
import { useModerationDocuments } from '@/hooks/useModeration'
import { useMuteList } from '@/hooks/useMuteList'
import { useStoryCardPreview } from '@/hooks/useStoryCardPreview'
import { useVisibilityOnce } from '@/hooks/useVisibilityOnce'
import { useEventFilterCheck, useSemanticFiltering, mergeResults } from '@/hooks/useKeywordFilters'
import { buildComposeSearch } from '@/lib/compose'
import { buildEventModerationDocument } from '@/lib/moderation/content'
import { parseCommentEvent } from '@/lib/nostr/thread'
import { normalizeHashtag } from '@/lib/security/sanitize'
import type { ParsedVideoEvent } from '@/lib/nostr/video'
import type { FilterCheckResult } from '@/lib/filters/types'
import type { FeedSection, NostrEvent, Profile } from '@/types'
import { Kind } from '@/types'

// ── Default sections ─────────────────────────────────────────
// Declared outside the component so filter objects have stable references
// and do not trigger useEffect re-runs on every render.

const DEFAULT_SECTIONS: FeedSection[] = [
  {
    id:     'feed',
    label:  'Feed',
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
    filter: { kinds: [Kind.ShortNote, Kind.Thread, Kind.Repost, Kind.GenericRepost, Kind.Poll], limit: 30 },
  },
  {
    id:     'articles',
    label:  'Articles',
    filter: { kinds: [Kind.LongFormContent], limit: 20 },
  },
  {
    id:     'videos',
    label:  'Videos',
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
    id:     'bitcoin',
    label:  'Bitcoin',
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
]

const COMPOSE_TRIGGER_OFFSET = 85  // px downward pull to open compose sheet
const SECTION_SUMMARY: Record<string, string> = {
  feed: 'Latest across your network.',
  notes: 'Fast conversation and short-form posts.',
  articles: 'Longer reading and analysis.',
  videos: 'Clips, explainers, and moving images.',
  bitcoin: 'Bitcoin discussion and market signal.',
  nostr: 'Builders, releases, and protocol chatter.',
}

export default function FeedPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser } = useApp()
  const { tag: routeTag } = useParams<{ tag?: string }>()
  const normalizedTag = useMemo(
    () => (routeTag ? normalizeHashtag(routeTag) : null),
    [routeTag],
  )
  const [activeSectionId, setActiveSectionId] = useState(DEFAULT_SECTIONS[0]!.id)

  const { profile: currentUserProfile } = useProfile(currentUser?.pubkey)
  const { isMuted, loading: muteListLoading } = useMuteList()
  const activeSection = useMemo<FeedSection>(() => {
    if (normalizedTag) {
      return {
        id: `tag:${normalizedTag}`,
        label: `#${normalizedTag}`,
        emoji: '#',
        filter: {
          kinds: [
            Kind.ShortNote,
            Kind.Thread,
            Kind.Poll,
            Kind.LongFormContent,
            Kind.Video,
            Kind.ShortVideo,
            Kind.AddressableVideo,
            Kind.AddressableShortVideo,
          ],
          '#t': [normalizedTag],
          limit: 50,
        },
      }
    }

    return DEFAULT_SECTIONS.find((section) => section.id === activeSectionId) ?? DEFAULT_SECTIONS[0]!
  }, [activeSectionId, normalizedTag])

  const { events, loading, eose } = useNostrFeed({ section: activeSection })
  const moderationDocuments = useMemo(
    () => events
      .map((event) => buildEventModerationDocument(event))
      .filter((document): document is NonNullable<ReturnType<typeof buildEventModerationDocument>> => document !== null),
    [events],
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
    () => events.filter((event) => (
      !isMuted(event.pubkey) &&
      (!moderationDocumentIds.has(event.id) || allowedModerationIds.has(event.id))
    )),
    [allowedModerationIds, events, isMuted, moderationDocumentIds],
  )
  const heroEvent = visibleEvents[0] ?? null
  const secondaryEvents = visibleEvents.slice(1)
  const feedLoading = loading || moderationLoading || muteListLoading

  const checkEvent      = useEventFilterCheck()
  const semanticResults = useSemanticFiltering(visibleEvents)

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
    setActiveSectionId(id)
    if (normalizedTag) {
      navigate('/', { replace: true })
    }
  }, [navigate, normalizedTag])

  const sectionSummary = normalizedTag
    ? `Posts, articles, and videos collected around #${normalizedTag}.`
    : SECTION_SUMMARY[activeSection.id] ?? SECTION_SUMMARY.feed
  const showStories = !normalizedTag && activeSection.id === 'feed' && currentUser !== null

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
            Pull to compose
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
          id={`feed-section-${activeSection.id}`}
          role="tabpanel"
          className="
            min-h-0 flex-1 overflow-y-auto
            px-4 pb-safe
          "
        >
          <div className="pb-6 pt-safe">
            <section className="app-chrome rounded-ios-xl px-4 pb-3 pt-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="section-kicker">
                    {normalizedTag ? 'Tag Feed' : 'Nostr Paper'}
                  </p>
                  <h1 className="mt-1.5 text-[30px] font-semibold leading-[1.02] tracking-[-0.04em] text-[rgb(var(--color-label))]">
                    {normalizedTag ? (
                      <TwemojiText text={`#${normalizedTag}`} />
                    ) : (
                      activeSection.label
                    )}
                  </h1>
                  <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                    {sectionSummary}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  {!currentUser && (
                    <button
                      type="button"
                      onClick={() => navigate('/onboard')}
                      className="
                        app-panel-muted
                        flex h-10 shrink-0 items-center justify-center rounded-full
                        px-3 text-[13px] font-medium text-[rgb(var(--color-label))]
                        transition-transform active:scale-[0.98]
                      "
                      aria-label="Sign In"
                    >
                      Sign In
                    </button>
                  )}

                  {currentUser && (
                    <button
                      type="button"
                      onClick={() => navigate('/profile')}
                      className="
                        app-panel-muted
                        flex h-10 w-10 shrink-0 items-center justify-center rounded-full
                        overflow-hidden text-[rgb(var(--color-label-secondary))]
                        transition-transform active:scale-[0.98]
                      "
                      aria-label="My Profile"
                    >
                      {currentUserProfile?.picture ? (
                        <img
                          src={currentUserProfile.picture}
                          alt="Profile"
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="8" r="5" />
                          <path d="M20 21a8 8 0 1 0-16 0" />
                        </svg>
                      )}
                    </button>
                  )}

                  {currentUser && (
                    <button
                      type="button"
                      onClick={() => navigate('/settings')}
                      className="
                        app-panel-muted
                        flex h-10 w-10 shrink-0 items-center justify-center rounded-full
                        text-[rgb(var(--color-label-secondary))]
                        transition-transform active:scale-[0.98]
                      "
                      aria-label="Settings"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                      </svg>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleCompose}
                    className="
                      app-panel-muted
                      flex h-10 w-10 shrink-0 items-center justify-center rounded-full
                      text-[rgb(var(--color-label))]
                      transition-transform active:scale-[0.98]
                    "
                    aria-label="Compose a note"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                      <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => navigate('/search')}
                className="
                  app-panel-muted mt-3 flex h-10 w-full items-center gap-3 rounded-[14px] px-3.5
                  text-left text-[14px] text-[rgb(var(--color-label-tertiary))]
                  transition-colors active:opacity-80
                "
                aria-label="Open search"
              >
                <svg
                  width="16" height="16" viewBox="0 0 16 16" fill="none"
                  className="text-[rgb(var(--color-label-tertiary))] flex-shrink-0"
                  aria-hidden
                >
                  <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span>Search notes, articles, videos, and people</span>
              </button>

              {normalizedTag && (
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="
                    mt-2 inline-flex items-center gap-2 rounded-full
                    bg-[rgb(var(--color-fill)/0.08)] px-3 py-1.5
                    text-[13px] font-medium text-[rgb(var(--color-label-secondary))]
                  "
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                    <path d="M6.5 2L3.5 5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>All sections</span>
                </button>
              )}
            </section>

            {!normalizedTag && (
              <div className="mt-3">
                <SectionRail
                  sections={DEFAULT_SECTIONS}
                  activeId={activeSection.id}
                  onSelect={handleSectionChange}
                />
              </div>
            )}

            {showStories && (
              <div className="mt-3">
                <StoryRail onComposeStory={handleComposeStory} />
              </div>
            )}

            <div className="mt-3">
              {feedLoading && !heroEvent ? (
                <FeedSkeleton type="hero" />
              ) : heroEvent ? (
                <FilteredGate
                  result={mergeResults(
                    checkEvent(heroEvent),
                    semanticResults.get(heroEvent.id) ?? { action: null, matches: [] },
                  )}
                >
                  <HeroCard event={heroEvent} index={0} />
                </FilteredGate>
              ) : eose && !moderationLoading ? (
                <EmptyState tag={normalizedTag} />
              ) : null}
            </div>

            <div className="mt-4 space-y-3">
              {feedLoading && secondaryEvents.length === 0 ? (
                Array.from({ length: 3 }, (_, i) => (
                  <FeedSkeleton key={i} type="card" />
                ))
              ) : (
                <AnimatePresence initial={false}>
                  {secondaryEvents.map((event, i) => (
                    <SecondaryCard
                      key={event.id}
                      event={event}
                      index={i}
                      checkEvent={checkEvent}
                      semanticResult={semanticResults.get(event.id) ?? { action: null, matches: [] }}
                    />
                  ))}
                </AnimatePresence>
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
  checkEvent: (event: NostrEvent, profile?: Profile) => FilterCheckResult
  semanticResult: FilterCheckResult
}

export function SecondaryCard({ event, index, checkEvent, semanticResult }: SecondaryCardProps) {
  const navigate = useNavigate()
  const { profile } = useProfile(event.pubkey, { background: false })
  const followStatus = useFollowStatus(event.pubkey)
  const { ref: visibilityRef, visible: storyPreviewVisible } = useVisibilityOnce<HTMLDivElement>()
  const filterResult = mergeResults(checkEvent(event, profile ?? undefined), semanticResult)
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
    isVideoStory,
    isStoryCard,
    articlePreview,
    videoPoster,
    videoPlaybackPlan,
    storyAuthor,
    storySiteName,
    storySummary,
    storyTitle,
  } = useStoryCardPreview(event, { ogEnabled: storyPreviewVisible })
  const href = article?.route ?? video?.route ?? `/note/${event.id}`
  return (
    <FilteredGate result={filterResult}>
      <motion.div
        ref={visibilityRef}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{
          type:    'spring',
          stiffness: 280,
          damping:   28,
          delay:   index * 0.04,
        }}
        className="
          app-panel
          rounded-ios-xl p-4
          card-elevated
          tap-none cursor-pointer
        "
        role="button"
        tabIndex={0}
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
            isArticle={isArticleStory}
            articleImage={articlePreview}
            video={video}
            videoPoster={videoPoster}
            playbackSources={videoPlaybackPlan?.sources}
            isSensitive={contentWarning !== null}
            sensitiveReason={contentWarning?.reason}
            isUnfollowed={followStatus === false}
          />
        )}

        <AuthorRow
          pubkey={event.pubkey}
          profile={profile}
          timestamp={event.created_at}
          actions
        />
        {(repost || thread || comment) && (
          <p className="mt-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
            {thread ? 'Thread' : comment ? 'Comment' : 'Repost'}
          </p>
        )}
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
          <RepostBody event={event} className="mt-3" compact linked={false} />
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
              />
            )}
            <QuotePreviewList event={event} className="mt-3" compact linked={false} maxItems={1} />
          </>
        ) : null}
      </motion.div>
    </FilteredGate>
  )
}

interface RichStoryMediaProps {
  isArticle: boolean
  articleImage: string | undefined
  video: ParsedVideoEvent | null
  videoPoster: string | undefined
  playbackSources: Array<{ url: string; type?: string }> | undefined
  isSensitive: boolean
  sensitiveReason: string | null | undefined
  isUnfollowed: boolean
}

function RichStoryMedia({
  isArticle,
  articleImage,
  video,
  videoPoster,
  playbackSources,
  isSensitive,
  sensitiveReason,
  isUnfollowed,
}: RichStoryMediaProps) {
  const canAutoplayVideo = Boolean(video && (playbackSources?.length ?? 0) > 0 && !isSensitive && !isUnfollowed)
  const imageSrc = articleImage ?? videoPoster
  const aspectClassName = video?.isShort ? 'aspect-[4/5]' : 'aspect-[16/9]'
  const label = isArticle ? 'Article' : video?.isShort ? 'Short video' : 'Video'

  return (
    <div className={`relative mb-4 overflow-hidden rounded-[18px] bg-[rgb(var(--color-surface-secondary))] ${aspectClassName}`}>
      {canAutoplayVideo ? (
        <video
          poster={videoPoster}
          muted
          playsInline
          autoPlay
          loop
          preload="metadata"
          className="h-full w-full object-cover"
          aria-label={label}
        >
          {playbackSources?.map((source) => (
            <source
              key={`${source.url}:${source.type ?? 'unknown'}`}
              src={source.url}
              {...(source.type ? { type: source.type } : {})}
            />
          ))}
        </video>
      ) : imageSrc ? (
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

function EmptyState({ tag }: { tag?: string | null }) {
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
        {tag ? `No #${tag} posts yet` : 'No posts yet'}
      </p>
      <p className="text-body text-[rgb(var(--color-label-secondary))]">
        {tag ? 'Try another hashtag or check back after relays sync.' : 'Connecting to relays…'}
      </p>
    </motion.div>
  )
}
