/**
 * ExplorePage
 *
 * Combined explore + search screen. When idle (no query typed), shows trending
 * topics from the local cache and recently-active accounts. When the user types,
 * the same inline search results used by SearchPage appear in place.
 *
 * The FeedPage search button navigates here so tapping it lands on content
 * rather than a blank prompt.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { SearchBar } from '@/components/search/SearchBar'
import { FeedSkeleton } from '@/components/feed/FeedSkeleton'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { NoteContent } from '@/components/cards/NoteContent'
import { NoteMediaAttachments } from '@/components/nostr/NoteMediaAttachments'
import { PollPreview } from '@/components/nostr/PollPreview'
import { ThreadIndexBadge } from '@/components/nostr/ThreadIndexBadge'
import { EventMetricsRow } from '@/components/nostr/EventMetricsRow'
import { TwemojiText } from '@/components/ui/TwemojiText'
import { useApp } from '@/contexts/app-context'
import { useExploreFollowPacks } from '@/hooks/useExploreFollowPacks'
import { useModerationDocuments } from '@/hooks/useModeration'
import { useSearch } from '@/hooks/useSearch'
import { useProfile } from '@/hooks/useProfile'
import { useSelfThreadIndex } from '@/hooks/useSelfThreadIndex'
import { useMuteList } from '@/hooks/useMuteList'
import { useHideNsfwTaggedPosts } from '@/hooks/useHideNsfwTaggedPosts'
import { useTrendingTopics } from '@/hooks/useTrendingTopics'
import { usePopularProfiles } from '@/hooks/usePopularProfiles'
import {
  getExploreFollowPackLabel,
  getExploreFollowPackSummary,
  rankExploreFollowPacks,
  type FollowPackProfileEntry,
  type RankedExploreFollowPack,
} from '@/lib/explore/followPacks'
import { getEventMediaAttachments, getImetaHiddenUrls } from '@/lib/nostr/imeta'
import { getFreshContactList, saveCurrentUserContactEntries } from '@/lib/nostr/contacts'
import { parseLongFormEvent } from '@/lib/nostr/longForm'
import {
  buildEventModerationDocument,
  buildProfileModerationDocument,
} from '@/lib/moderation/content'
import { filterNsfwTaggedEvents } from '@/lib/moderation/nsfwTags'
import { formatNip05Identifier } from '@/lib/nostr/nip05'
import { parsePollEvent } from '@/lib/nostr/polls'
import { parseSearchQuery, warmSearchRelays } from '@/lib/nostr/search'
import { parseCommentEvent, parseThreadEvent } from '@/lib/nostr/thread'
import { sanitizeText } from '@/lib/security/sanitize'
import { parseVideoEvent } from '@/lib/nostr/video'
import type { NostrEvent, Profile } from '@/types'
import { Kind } from '@/types'
import type { RecentHashtagStat } from '@/lib/db/nostr'

const SEARCHABLE_KINDS = [
  Kind.ShortNote,
  Kind.Thread,
  Kind.Poll,
  Kind.LongFormContent,
  Kind.Video,
  Kind.ShortVideo,
  Kind.AddressableVideo,
  Kind.AddressableShortVideo,
]

export default function ExplorePage() {
  const { currentUser } = useApp()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryParam = searchParams.get('q') ?? ''
  const previousQueryParamRef = useRef(queryParam)
  const [followedPubkeys, setFollowedPubkeys] = useState<Set<string>>(new Set())

  // Pre-warm relay connections so first search is fast
  useEffect(() => { warmSearchRelays() }, [])

  const {
    input,
    query,
    setInput,
    commitNow,
    clear,
    events,
    profiles,
    localLoading,
    relayLoading,
    relayError,
    semanticError,
  } = useSearch({ kinds: SEARCHABLE_KINDS, localLimit: 40, relayLimit: 40 })

  const { isMuted, loading: muteListLoading } = useMuteList()
  const hideNsfwTaggedPosts = useHideNsfwTaggedPosts()
  const { topics, loading: topicsLoading } = useTrendingTopics(24)
  const { packs: followPackCandidates, loading: followPackLoading } = useExploreFollowPacks(18)
  const { profiles: popularProfiles, loading: popularLoading } = usePopularProfiles(8)

  useEffect(() => {
    if (!currentUser?.pubkey) {
      setFollowedPubkeys(new Set())
      return
    }

    const controller = new AbortController()
    getFreshContactList(currentUser.pubkey, { signal: controller.signal })
      .then((contactList) => {
        if (controller.signal.aborted) return
        const next = new Set(contactList?.entries.map((entry) => entry.pubkey) ?? [])
        setFollowedPubkeys(next)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setFollowedPubkeys(new Set())
      })

    return () => controller.abort()
  }, [currentUser?.pubkey])

  const parsedQuery = useMemo(() => parseSearchQuery(query), [query])
  const unsupportedKeys = useMemo(
    () => [...new Set(parsedQuery.unsupportedExtensions.map(ext => ext.key))],
    [parsedQuery],
  )

  const eventModerationDocuments = useMemo(
    () => events
      .map(buildEventModerationDocument)
      .filter((d): d is NonNullable<typeof d> => d !== null),
    [events],
  )
  const profileModerationDocuments = useMemo(
    () => profiles
      .map(buildProfileModerationDocument)
      .filter((d): d is NonNullable<typeof d> => d !== null),
    [profiles],
  )
  const eventModerationIds = useMemo(
    () => new Set(eventModerationDocuments.map(d => d.id)),
    [eventModerationDocuments],
  )
  const profileModerationIds = useMemo(
    () => new Set(profileModerationDocuments.map(d => d.id)),
    [profileModerationDocuments],
  )
  const followPackModerationDocuments = useMemo(
    () => followPackCandidates
      .map((candidate) => buildEventModerationDocument(candidate.event))
      .filter((d): d is NonNullable<typeof d> => d !== null),
    [followPackCandidates],
  )
  const followPackModerationIds = useMemo(
    () => new Set(followPackModerationDocuments.map((document) => document.id)),
    [followPackModerationDocuments],
  )

  const { allowedIds: allowedEventIds } = useModerationDocuments(eventModerationDocuments)
  const { allowedIds: allowedProfileIds } = useModerationDocuments(profileModerationDocuments)
  const {
    allowedIds: allowedFollowPackIds,
    loading: followPackModerationLoading,
  } = useModerationDocuments(followPackModerationDocuments)

  const visibleEvents = useMemo(
    () => filterNsfwTaggedEvents(
      events.filter(e => !isMuted(e.pubkey) && (!eventModerationIds.has(e.id) || allowedEventIds.has(e.id))),
      hideNsfwTaggedPosts,
    ),
    [allowedEventIds, eventModerationIds, events, hideNsfwTaggedPosts, isMuted],
  )
  const visibleProfiles = useMemo(
    () => profiles.filter(p => !isMuted(p.pubkey) && (!profileModerationIds.has(p.pubkey) || allowedProfileIds.has(p.pubkey))),
    [allowedProfileIds, profileModerationIds, profiles, isMuted],
  )
  const visibleFollowPacks = useMemo(
    () => rankExploreFollowPacks(
      followPackCandidates.filter((candidate) =>
        !followPackModerationIds.has(candidate.event.id) || allowedFollowPackIds.has(candidate.event.id),
      ),
      {
        currentUserPubkey: currentUser?.pubkey ?? null,
        followedPubkeys,
        isMuted,
        limit: 6,
      },
    ),
    [allowedFollowPackIds, currentUser?.pubkey, followPackCandidates, followPackModerationIds, followedPubkeys, isMuted],
  )

  const handleFollowPack = useCallback(async (pack: RankedExploreFollowPack) => {
    if (!currentUser) {
      throw new Error('Connect a signer to follow pack profiles together.')
    }
    if (pack.missingProfiles.length === 0) return

    await saveCurrentUserContactEntries(pack.missingProfiles)
    setFollowedPubkeys((previous) => {
      const next = new Set(previous)
      for (const profile of pack.missingProfiles) {
        next.add(profile.pubkey)
      }
      return next
    })
  }, [currentUser])

  // Sync URL ↔ search input
  useEffect(() => {
    if (queryParam === previousQueryParamRef.current) return
    previousQueryParamRef.current = queryParam
    setInput(queryParam)
  }, [queryParam, setInput])

  useEffect(() => {
    if (queryParam === query) return
    const next = new URLSearchParams(searchParams)
    if (query) next.set('q', query)
    else next.delete('q')
    setSearchParams(next, { replace: true })
  }, [query, queryParam, searchParams, setSearchParams])

  const fetchLoading = localLoading || relayLoading || muteListLoading
  const idle = input.trim().length === 0
  const hasResults = visibleEvents.length > 0 || visibleProfiles.length > 0
  const showSkeleton = fetchLoading && !hasResults && !idle
  const empty = !fetchLoading && query.length > 0 && !hasResults

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))]">

      {/* Sticky header */}
      <div className="app-chrome sticky top-0 z-20 px-4 pt-safe pb-2.5">
        <div className="flex items-center gap-3 pt-1.5">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="app-panel-muted h-10 w-10 rounded-full text-[rgb(var(--color-label))] flex items-center justify-center active:opacity-80"
            aria-label="Go back"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M9.5 3.25L4.75 8l4.75 4.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <p className="section-kicker">Explore</p>
            <h1 className="mt-1 text-[28px] font-semibold leading-[1.02] tracking-[-0.035em] text-[rgb(var(--color-label))]">
              Discover
            </h1>
          </div>
        </div>

        <SearchBar
          value={input}
          onChange={setInput}
          onSubmit={commitNow}
          onClear={clear}
          autoFocus
          className="mt-2.5"
        />

        {query.length > 0 && (
          <p className="mt-2 text-[13px] text-[rgb(var(--color-label-secondary))]">
            {localLoading
              ? 'Searching local cache…'
              : relayLoading
                ? `${hasResults ? `${visibleProfiles.length} local results` : 'No local results'} — fetching from relays…`
                : `Showing ${visibleProfiles.length} people and ${visibleEvents.length} posts.`}
          </p>
        )}

        {unsupportedKeys.length > 0 && (
          <p className="mt-2 text-[13px] text-[rgb(var(--color-label-secondary))]">
            Relay-only filters in use: {unsupportedKeys.join(', ')}.
          </p>
        )}

        {relayError && (
          <p className="mt-2 text-[13px] text-[#C65D2E]">Relay search degraded: {relayError}</p>
        )}
        {semanticError && (
          <p className="mt-2 text-[13px] text-[#C65D2E]">Semantic reranking degraded: {semanticError}</p>
        )}
      </div>

      {/* Body */}
      <div className="px-4 pb-safe pb-8">
        {idle ? (
          <ExploreContent
            topics={topics}
            topicsLoading={topicsLoading}
            followPacks={visibleFollowPacks}
            followPacksLoading={followPackLoading || followPackModerationLoading}
            canBulkFollow={Boolean(currentUser)}
            onFollowPack={handleFollowPack}
            popularProfiles={popularProfiles}
            popularLoading={popularLoading}
          />
        ) : showSkeleton ? (
          <div className="space-y-3 mt-2">
            <FeedSkeleton type="card" />
            <FeedSkeleton type="card" />
            <FeedSkeleton type="card" />
          </div>
        ) : empty ? (
          <SearchEmpty />
        ) : (
          <div className="space-y-5 mt-4">
            {visibleProfiles.length > 0 && (
              <section>
                <h2 className="section-kicker px-1 mb-3">People</h2>
                <div className="space-y-3">
                  {visibleProfiles.map(profile => (
                    <ProfileResult key={profile.pubkey} profile={profile} />
                  ))}
                </div>
              </section>
            )}
            {visibleEvents.length > 0 && (
              <section>
                <h2 className="section-kicker px-1 mb-3">Posts</h2>
                <div className="space-y-3">
                  {visibleEvents.map(event => (
                    <EventResult key={event.id} event={event} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Explore idle content ──────────────────────────────────────

function ExploreContent({
  topics,
  topicsLoading,
  followPacks,
  followPacksLoading,
  canBulkFollow,
  onFollowPack,
  popularProfiles,
  popularLoading,
}: {
  topics: RecentHashtagStat[]
  topicsLoading: boolean
  followPacks: RankedExploreFollowPack[]
  followPacksLoading: boolean
  canBulkFollow: boolean
  onFollowPack: (pack: RankedExploreFollowPack) => Promise<void>
  popularProfiles: Profile[]
  popularLoading: boolean
}) {
  return (
    <div className="space-y-8 mt-4">

      {/* Trending topics */}
      <section>
        <h2 className="section-kicker px-1 mb-3">Trending Topics</h2>
        {topicsLoading ? (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="h-9 rounded-full bg-[rgb(var(--color-fill)/0.1)] animate-pulse"
                style={{ width: `${60 + (i * 17) % 60}px` }}
              />
            ))}
          </div>
        ) : topics.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {topics.map((topic, i) => (
              <motion.div
                key={topic.tag}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.15, delay: i * 0.02 }}
              >
                <Link
                  to={`/t/${encodeURIComponent(topic.tag)}`}
                  className="
                    inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full
                    app-panel-muted border border-[rgb(var(--color-fill)/0.14)]
                    text-[14px] font-medium text-[rgb(var(--color-label))]
                    transition-all active:scale-95 active:opacity-70
                  "
                >
                  <span className="text-[rgb(var(--color-accent))] font-semibold">#</span>
                  {topic.tag}
                  <span className="text-[12px] text-[rgb(var(--color-label-tertiary))] ml-0.5">
                    {topic.usageCount}
                  </span>
                </Link>
              </motion.div>
            ))}
          </div>
        ) : (
          <p className="px-1 text-[14px] text-[rgb(var(--color-label-tertiary))]">
            No trending topics yet — sync more content to see what's popular.
          </p>
        )}
      </section>

      <section>
        <h2 className="section-kicker px-1 mb-3">Follow Packs</h2>
        {followPacksLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[228px] rounded-ios-xl bg-[rgb(var(--color-fill)/0.08)] animate-pulse" />
            ))}
          </div>
        ) : followPacks.length > 0 ? (
          <div className="space-y-3">
            {followPacks.map((pack, i) => (
              <motion.div
                key={pack.parsed.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: i * 0.04 }}
              >
                <ExploreFollowPackCard
                  pack={pack}
                  canBulkFollow={canBulkFollow}
                  onFollowPack={onFollowPack}
                />
              </motion.div>
            ))}
          </div>
        ) : (
          <p className="px-1 text-[14px] text-[rgb(var(--color-label-tertiary))]">
            No starter packs cached yet. Explore will surface them here as your relays publish more curated follow lists.
          </p>
        )}
      </section>

      {/* Popular accounts */}
      <section>
        <h2 className="section-kicker px-1 mb-3">Popular Accounts</h2>
        {popularLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[72px] rounded-ios-xl bg-[rgb(var(--color-fill)/0.08)] animate-pulse" />
            ))}
          </div>
        ) : popularProfiles.length > 0 ? (
          <div className="space-y-3">
            {popularProfiles.map((profile, i) => (
              <motion.div
                key={profile.pubkey}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: i * 0.04 }}
              >
                <ProfileResult profile={profile} />
              </motion.div>
            ))}
          </div>
        ) : (
          <p className="px-1 text-[14px] text-[rgb(var(--color-label-tertiary))]">
            No profiles cached yet.
          </p>
        )}
      </section>

    </div>
  )
}

// ── Search result cards (shared with SearchPage) ──────────────

function FollowPackPreviewPerson({ entry }: { entry: FollowPackProfileEntry }) {
  const { profile } = useProfile(entry.pubkey, { background: false })

  return (
    <Link
      to={`/profile/${entry.pubkey}`}
      className="
        block rounded-[16px] border border-[rgb(var(--color-fill)/0.12)]
        bg-[rgb(var(--color-bg))] px-3 py-3 transition-opacity active:opacity-80
      "
    >
      <AuthorRow pubkey={entry.pubkey} profile={profile} />
      {(entry.petname || entry.relayUrl) && (
        <p className="mt-2 break-all text-[12px] leading-5 text-[rgb(var(--color-label-tertiary))]">
          {[entry.petname ? `Pack note: ${entry.petname}` : null, entry.relayUrl].filter(Boolean).join(' • ')}
        </p>
      )}
    </Link>
  )
}

function ExploreFollowPackCard({
  pack,
  canBulkFollow,
  onFollowPack,
}: {
  pack: RankedExploreFollowPack
  canBulkFollow: boolean
  onFollowPack: (pack: RankedExploreFollowPack) => Promise<void>
}) {
  const { profile: curatorProfile } = useProfile(pack.parsed.pubkey, { background: false })
  const [following, setFollowing] = useState(false)
  const [followMessage, setFollowMessage] = useState<string | null>(null)
  const [followError, setFollowError] = useState<string | null>(null)
  const hiddenPreviewCount = Math.max(pack.totalProfiles - pack.previewProfiles.length, 0)
  const followLabel = pack.missingCount > 0
    ? `Follow ${pack.missingCount}`
    : 'Already Following'

  const handleFollow = async () => {
    if (!canBulkFollow || following || pack.missingCount === 0) return

    setFollowing(true)
    setFollowMessage(null)
    setFollowError(null)

    try {
      await onFollowPack(pack)
      setFollowMessage(
        `Added ${pack.missingCount} new profile${pack.missingCount === 1 ? '' : 's'} from this pack to your follows.`,
      )
    } catch (error) {
      setFollowError(error instanceof Error ? error.message : 'Failed to follow this pack.')
    } finally {
      setFollowing(false)
    }
  }

  return (
    <div className="app-panel rounded-ios-xl p-4 card-elevated">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-[rgb(var(--color-fill)/0.1)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
          {getExploreFollowPackLabel(pack.parsed.kind)}
        </span>
        <p className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
          {pack.reason}
        </p>
      </div>

      <h3 className="mt-3 text-[20px] leading-tight font-semibold tracking-[-0.02em] text-[rgb(var(--color-label))]">
        <TwemojiText text={pack.parsed.title ?? getExploreFollowPackLabel(pack.parsed.kind)} />
      </h3>

      <p className="mt-2 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
        <TwemojiText text={getExploreFollowPackSummary(pack.parsed)} />
      </p>

      <div className="mt-3 rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] px-3 py-3">
        <Link to={`/profile/${pack.parsed.pubkey}`} className="block">
          <AuthorRow pubkey={pack.parsed.pubkey} profile={curatorProfile} />
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">
          {pack.totalProfiles} profile{pack.totalProfiles === 1 ? '' : 's'}
        </span>
        <span className="rounded-full bg-[rgb(var(--color-accent)/0.14)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label))]">
          {pack.missingCount} new
        </span>
        {pack.overlapCount > 0 && (
          <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">
            {pack.overlapCount} already follow
          </span>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {pack.previewProfiles.map((entry) => (
          <FollowPackPreviewPerson key={entry.pubkey} entry={entry} />
        ))}
      </div>

      {hiddenPreviewCount > 0 && (
        <p className="mt-3 text-[13px] text-[rgb(var(--color-label-tertiary))]">
          +{hiddenPreviewCount} more profile{hiddenPreviewCount === 1 ? '' : 's'} inside this pack
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {canBulkFollow && (
          <button
            type="button"
            onClick={() => void handleFollow()}
            disabled={following || pack.missingCount === 0}
            className="rounded-[14px] bg-[rgb(var(--color-label))] px-3 py-2 text-[13px] font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-40"
          >
            {following ? 'Following…' : followLabel}
          </button>
        )}

        <Link
          to={pack.parsed.route}
          className="rounded-[14px] border border-[rgb(var(--color-fill)/0.14)] px-3 py-2 text-[13px] font-semibold text-[rgb(var(--color-label))] transition-opacity active:opacity-80"
        >
          Open Pack
        </Link>
      </div>

      {!canBulkFollow && (
        <p className="mt-3 text-[13px] leading-6 text-[rgb(var(--color-label-tertiary))]">
          Connect a signer to follow the missing profiles from this pack together.
        </p>
      )}

      {followMessage && (
        <p className="mt-3 text-[13px] text-[rgb(var(--color-system-green))]">
          {followMessage}
        </p>
      )}

      {followError && (
        <p className="mt-3 text-[13px] text-[rgb(var(--color-system-red))]">
          {followError}
        </p>
      )}
    </div>
  )
}

function ProfileResult({ profile }: { profile: Profile }) {
  const about = profile.about ? sanitizeText(profile.about).slice(0, 180) : ''

  return (
    <Link
      to={`/profile/${profile.pubkey}`}
      className="app-panel block rounded-ios-xl p-4 card-elevated"
    >
      <AuthorRow pubkey={profile.pubkey} profile={profile} />

      {profile.nip05 && profile.nip05Verified && (
        <p className="mt-2 text-[13px] text-[rgb(var(--color-label-secondary))]">
          {formatNip05Identifier(profile.nip05)}
        </p>
      )}

      {about && (
        <p className="mt-2 text-[14px] leading-relaxed text-[rgb(var(--color-label-secondary))] line-clamp-3">
          {about}
        </p>
      )}
    </Link>
  )
}

function EventResult({ event }: { event: NostrEvent }) {
  const { profile } = useProfile(event.pubkey, { background: false })
  const threadIndex = useSelfThreadIndex(event)
  const article = parseLongFormEvent(event)
  const poll = parsePollEvent(event)
  const video = parseVideoEvent(event)
  const thread = parseThreadEvent(event)
  const comment = parseCommentEvent(event)
  const attachments = getEventMediaAttachments(event)
  const hiddenUrls = getImetaHiddenUrls(event)
  const kindLabel = poll ? 'Poll'
    : article ? 'Article'
    : thread ? 'Thread'
    : comment ? 'Comment'
    : video ? (video.isShort ? 'Short video' : 'Video')
    : 'Note'
  const href = article?.route ?? video?.route ?? `/note/${event.id}`

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
    >
      <Link to={href} className="app-panel block rounded-ios-xl p-4 card-elevated">
        <div className="flex items-start justify-between gap-3">
          <AuthorRow pubkey={event.pubkey} profile={profile} timestamp={event.created_at} />
          <span className="px-2 py-1 rounded-full text-[11px] font-semibold uppercase tracking-[0.08em] bg-[rgb(var(--color-fill)/0.1)] text-[rgb(var(--color-label-secondary))]">
            {kindLabel}
          </span>
        </div>

        {!poll && (article?.title || video?.title || thread?.title) && (
          <h3 className="mt-3 text-[20px] leading-tight font-semibold tracking-[-0.02em] text-[rgb(var(--color-label))]">
            {article?.title ?? video?.title ?? thread?.title}
          </h3>
        )}

        <ThreadIndexBadge threadIndex={threadIndex} className="mt-3" />

        {poll ? (
          <PollPreview poll={poll} className="mt-3" />
        ) : (article?.summary || video?.summary || thread?.content || comment?.content) ? (
          <p className="mt-3 text-[15px] leading-7 text-[rgb(var(--color-label-secondary))]">
            {article?.summary ?? video?.summary ?? thread?.content ?? comment?.content}
          </p>
        ) : (
          <>
            <NoteContent content={event.content} className="mt-3" hiddenUrls={hiddenUrls} interactive={false} />
            {attachments.length > 0 && (
              <NoteMediaAttachments attachments={attachments} className="mt-3" compact interactive={false} />
            )}
          </>
        )}
        <EventMetricsRow event={event} interactive />
      </Link>
    </motion.div>
  )
}

function SearchEmpty() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="mt-8 rounded-ios-2xl p-8 text-center app-panel"
    >
      <p className="text-headline text-[rgb(var(--color-label))] mb-2">No search results</p>
      <p className="text-body text-[rgb(var(--color-label-secondary))]">
        Try a broader query or remove any relay-only filters.
      </p>
    </motion.div>
  )
}
