/**
 * ExplorePage
 *
 * Combined explore + search screen. When idle (no query typed), shows trending
 * topics from the local cache plus account discovery lanes. When the user types,
 * the same inline search results used by SearchPage appear in place.
 *
 * The FeedPage search button navigates here so tapping it lands on content
 * rather than a blank prompt.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { FilteredGate } from '@/components/filters/FilteredGate'
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
import { mergeResults, useEventFilterCheck, useProfileFilterCheck, useSemanticFiltering } from '@/hooks/useKeywordFilters'
import { useMuteList } from '@/hooks/useMuteList'
import { useHideNsfwTaggedPosts } from '@/hooks/useHideNsfwTaggedPosts'
import { useTrendingTopics } from '@/hooks/useTrendingTopics'
import { useTrendingLinks } from '@/hooks/useTrendingLinks'
import { usePopularProfiles } from '@/hooks/usePopularProfiles'
import { useSuggestedProfiles } from '@/hooks/useSuggestedProfiles'
import { useSemanticFollowPacks } from '@/hooks/useSemanticFollowPacks'
import { TrendingLinkCard } from '@/components/links/TrendingLinkCard'
import type { TrendingLinkStat } from '@/lib/explore/trendingLinks'
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
import { extractEventHashtags } from '@/lib/feed/tagTimeline'
import { parseCommentEvent, parseThreadEvent } from '@/lib/nostr/thread'
import { sanitizeText } from '@/lib/security/sanitize'
import { parseVideoEvent } from '@/lib/nostr/video'
import { tApp } from '@/lib/i18n/app'
import type { FilterCheckResult } from '@/lib/filters/types'
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
  const checkEvent = useEventFilterCheck()
  const checkProfile = useProfileFilterCheck()

  const {
    isMuted,
    mutedWords,
    mutedHashtags,
    loading: muteListLoading,
  } = useMuteList()
  const hideNsfwTaggedPosts = useHideNsfwTaggedPosts()
  const [topicsWindow, setTopicsWindow] = useState<'today' | 'week'>('week')
  const [linksWindow,  setLinksWindow]  = useState<'today' | 'week'>('week')
  const { topics, loading: topicsLoading } = useTrendingTopics(24, topicsWindow)
  const { links,  loading: linksLoading  } = useTrendingLinks(8,  linksWindow)
  const { packs: followPackCandidates, loading: followPackLoading } = useExploreFollowPacks(18)
  const { profiles: suggestedProfiles, loading: suggestedLoading } = useSuggestedProfiles(currentUser?.pubkey, 8)
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

  const { allowedIds: allowedEventIds } = useModerationDocuments(eventModerationDocuments, { failClosed: true })
  const { allowedIds: allowedProfileIds } = useModerationDocuments(profileModerationDocuments, { failClosed: true })
  const {
    allowedIds: allowedFollowPackIds,
    loading: followPackModerationLoading,
  } = useModerationDocuments(followPackModerationDocuments, { failClosed: true })

  const visibleEvents = useMemo(
    () => filterNsfwTaggedEvents(
      events.filter((event) => {
        if (isMuted(event.pubkey)) return false
        if (eventModerationIds.has(event.id) && !allowedEventIds.has(event.id)) return false

        if (mutedWords.size > 0) {
          const lower = event.content.toLowerCase()
          for (const word of mutedWords) {
            if (lower.includes(word)) return false
          }
        }

        if (mutedHashtags.size > 0) {
          const tags = extractEventHashtags(event)
          if (tags.some((tag) => mutedHashtags.has(tag))) return false
        }

        return true
      }),
      hideNsfwTaggedPosts,
    ),
    [allowedEventIds, eventModerationIds, events, hideNsfwTaggedPosts, isMuted, mutedWords, mutedHashtags],
  )
  const semanticFilterResults = useSemanticFiltering(visibleEvents)
  const visibleProfiles = useMemo(
    () => profiles.filter(p => !isMuted(p.pubkey) && (!profileModerationIds.has(p.pubkey) || allowedProfileIds.has(p.pubkey))),
    [allowedProfileIds, profileModerationIds, profiles, isMuted],
  )
  const profileFilterResults = useMemo(
    () => {
      const next = new Map<string, FilterCheckResult>()
      for (const profile of visibleProfiles) {
        next.set(profile.pubkey, checkProfile(profile))
      }
      return next
    },
    [checkProfile, visibleProfiles],
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
  const {
    packs: semanticFollowPacks,
    semanticApplied: followPackSemanticApplied,
  } = useSemanticFollowPacks(visibleFollowPacks, currentUser?.pubkey)

  const handleLinkPress = useCallback((url: string) => {
    navigate(`/link?url=${encodeURIComponent(url)}`)
  }, [navigate])

  const handleFollowPack = useCallback(async (pack: RankedExploreFollowPack) => {
    if (!currentUser) {
      throw new Error(tApp('explorePackReasonConnectSigner'))
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
  const localResultText = hasResults
    ? tApp('exploreStatusLocalResultsCount', { count: visibleProfiles.length })
    : tApp('exploreStatusNoLocalResults')

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))]">

      {/* Sticky header */}
      <div className="app-chrome sticky top-0 z-20 px-4 pt-safe pb-2.5">
        <div className="flex items-center gap-3 pt-1.5">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="app-panel-muted h-10 w-10 rounded-full text-[rgb(var(--color-label))] flex items-center justify-center active:opacity-80"
            aria-label={tApp('exploreGoBack')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M9.5 3.25L4.75 8l4.75 4.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <p className="section-kicker">{tApp('exploreKicker')}</p>
            <h1 className="mt-1 text-[28px] font-semibold leading-[1.02] tracking-[-0.035em] text-[rgb(var(--color-label))]">
              {tApp('exploreTitle')}
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
              ? tApp('exploreStatusSearchingLocal')
              : relayLoading
                ? tApp('exploreStatusLocalResultsFetchingRelays', {
                  resultsText: localResultText,
                })
                : tApp('exploreStatusShowingResults', {
                  people: visibleProfiles.length,
                  posts: visibleEvents.length,
                })}
          </p>
        )}

        {unsupportedKeys.length > 0 && (
          <p className="mt-2 text-[13px] text-[rgb(var(--color-label-secondary))]">
            {tApp('exploreUnsupportedFilters', { filters: unsupportedKeys.join(', ') })}
          </p>
        )}

        {relayError && (
          <p className="mt-2 text-[13px] text-[#C65D2E]">{tApp('exploreRelayDegraded', { error: relayError })}</p>
        )}
        {semanticError && (
          <p className="mt-2 text-[13px] text-[#C65D2E]">{tApp('exploreSemanticDegraded', { error: semanticError })}</p>
        )}
      </div>

      {/* Body */}
      <div className="px-4 pb-safe pb-8">
        {idle ? (
          <ExploreContent
            topics={topics}
            topicsLoading={topicsLoading}
            topicsWindow={topicsWindow}
            onTopicsWindowChange={setTopicsWindow}
            links={links}
            linksLoading={linksLoading}
            linksWindow={linksWindow}
            onLinksWindowChange={setLinksWindow}
            onLinkPress={handleLinkPress}
            followPacks={semanticFollowPacks}
            followPackSemanticApplied={followPackSemanticApplied}
            followPacksLoading={followPackLoading || followPackModerationLoading}
            canBulkFollow={Boolean(currentUser)}
            onFollowPack={handleFollowPack}
            suggestedProfiles={suggestedProfiles}
            suggestedLoading={suggestedLoading}
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
                <h2 className="section-kicker px-1 mb-3">{tApp('explorePeopleSection')}</h2>
                <div className="space-y-3">
                  {visibleProfiles.map(profile => (
                    <FilteredGate
                      key={profile.pubkey}
                      result={profileFilterResults.get(profile.pubkey) ?? { action: null, matches: [] }}
                      eventId={`profile:${profile.pubkey}`}
                    >
                      <ProfileResult profile={profile} />
                    </FilteredGate>
                  ))}
                </div>
              </section>
            )}
            {visibleEvents.length > 0 && (
              <section>
                <h2 className="section-kicker px-1 mb-3">{tApp('explorePostsSection')}</h2>
                <div className="space-y-3">
                  {visibleEvents.map(event => (
                    <EventResult
                      key={event.id}
                      event={event}
                      checkEvent={checkEvent}
                      semanticResult={semanticFilterResults.get(event.id) ?? { action: null, matches: [] }}
                    />
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
  topicsWindow,
  onTopicsWindowChange,
  links,
  linksLoading,
  linksWindow,
  onLinksWindowChange,
  onLinkPress,
  followPacks,
  followPackSemanticApplied,
  followPacksLoading,
  canBulkFollow,
  onFollowPack,
  suggestedProfiles,
  suggestedLoading,
  popularProfiles,
  popularLoading,
}: {
  topics: RecentHashtagStat[]
  topicsLoading: boolean
  topicsWindow: 'today' | 'week'
  onTopicsWindowChange: (w: 'today' | 'week') => void
  links: TrendingLinkStat[]
  linksLoading: boolean
  linksWindow: 'today' | 'week'
  onLinksWindowChange: (w: 'today' | 'week') => void
  onLinkPress: (url: string) => void
  followPacks: RankedExploreFollowPack[]
  followPackSemanticApplied: boolean
  followPacksLoading: boolean
  canBulkFollow: boolean
  onFollowPack: (pack: RankedExploreFollowPack) => Promise<void>
  suggestedProfiles: Array<{ profile: Profile; reason: string }>
  suggestedLoading: boolean
  popularProfiles: Profile[]
  popularLoading: boolean
}) {
  return (
    <div className="space-y-8 mt-4">

      {/* Trending topics */}
      <section>
        <div className="flex items-center justify-between px-1 mb-3">
          <div>
            <h2 className="section-kicker">{tApp('exploreTrendingTopics')}</h2>
            <p className="mt-1 text-[11px] text-[rgb(var(--color-label-tertiary))]">
              {tApp('exploreTrendingTopicsHint')}
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-[rgb(var(--color-fill)/0.10)] p-0.5">
            {(['today', 'week'] as const).map((w) => (
              <button
                key={w}
                onClick={() => onTopicsWindowChange(w)}
                className={`
                  px-3 py-1 rounded-full text-[12px] font-medium transition-all
                  ${topicsWindow === w
                    ? 'bg-[rgb(var(--color-bg))] text-[rgb(var(--color-label))] shadow-sm'
                    : 'text-[rgb(var(--color-label-secondary))]'
                  }
                `}
              >
                {w === 'today' ? tApp('exploreWindowToday') : tApp('exploreWindowWeek')}
              </button>
            ))}
          </div>
        </div>
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
            {tApp('exploreNoTrendingTopics')}
          </p>
        )}
      </section>

      {/* News — trending external links */}
      <section>
        <div className="flex items-center justify-between px-1 mb-3">
          <div>
            <h2 className="section-kicker">{tApp('exploreNewsSection')}</h2>
            <p className="mt-1 text-[11px] text-[rgb(var(--color-label-tertiary))]">
              {tApp('exploreNewsSectionHint')}
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-[rgb(var(--color-fill)/0.10)] p-0.5">
            {(['today', 'week'] as const).map((w) => (
              <button
                key={w}
                onClick={() => onLinksWindowChange(w)}
                className={`
                  px-3 py-1 rounded-full text-[12px] font-medium transition-all
                  ${linksWindow === w
                    ? 'bg-[rgb(var(--color-bg))] text-[rgb(var(--color-label))] shadow-sm'
                    : 'text-[rgb(var(--color-label-secondary))]'
                  }
                `}
              >
                {w === 'today' ? tApp('exploreWindowToday') : tApp('exploreWindowWeek')}
              </button>
            ))}
          </div>
        </div>
        {linksLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[76px] rounded-[14px] bg-[rgb(var(--color-fill)/0.08)] animate-pulse" />
            ))}
          </div>
        ) : links.length > 0 ? (
          <div className="space-y-2">
            {links.map((stat, i) => (
              <motion.div
                key={stat.url}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.16, delay: i * 0.03 }}
              >
                <TrendingLinkCard stat={stat} onClick={onLinkPress} />
              </motion.div>
            ))}
          </div>
        ) : (
          <p className="px-1 text-[14px] text-[rgb(var(--color-label-tertiary))]">
            {tApp('exploreNoNews')}
          </p>
        )}
      </section>

      <section>
        <div className="px-1 mb-3">
          <h2 className="section-kicker">{tApp('exploreFollowPacks')}</h2>
          <p className="mt-1 text-[11px] text-[rgb(var(--color-label-tertiary))]">
            {followPackSemanticApplied
              ? tApp('exploreFollowPacksSemanticHint')
              : tApp('exploreFollowPacksNetworkHint')}
          </p>
        </div>
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
            {tApp('exploreNoFollowPacks')}
          </p>
        )}
      </section>

      <section>
        <div className="px-1 mb-3">
          <h2 className="section-kicker">{tApp('exploreSuggestedAccounts')}</h2>
          <p className="mt-1 text-[11px] text-[rgb(var(--color-label-tertiary))]">
            {tApp('exploreSuggestedAccountsHint')}
          </p>
        </div>
        {suggestedLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[72px] rounded-ios-xl bg-[rgb(var(--color-fill)/0.08)] animate-pulse" />
            ))}
          </div>
        ) : suggestedProfiles.length > 0 ? (
          <div className="space-y-3">
            {suggestedProfiles.map((item, i) => (
              <motion.div
                key={item.profile.pubkey}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: i * 0.04 }}
              >
                <ProfileResult profile={item.profile} subtitle={item.reason} />
              </motion.div>
            ))}
          </div>
        ) : (
          <p className="px-1 text-[14px] text-[rgb(var(--color-label-tertiary))]">
            {tApp('exploreSuggestedAccountsEmpty')}
          </p>
        )}
      </section>

      {/* Popular accounts */}
      <section>
        <div className="px-1 mb-3">
          <h2 className="section-kicker">{tApp('explorePopularAccounts')}</h2>
          <p className="mt-1 text-[11px] text-[rgb(var(--color-label-tertiary))]">
            {tApp('explorePopularAccountsHint')}
          </p>
        </div>
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
                <ProfileResult profile={profile} subtitle={tApp('explorePopularInGraph')} />
              </motion.div>
            ))}
          </div>
        ) : (
          <p className="px-1 text-[14px] text-[rgb(var(--color-label-tertiary))]">
            {tApp('exploreNoProfilesCached')}
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
          {[entry.petname ? tApp('explorePackNotePrefix', { petname: entry.petname }) : null, entry.relayUrl].filter(Boolean).join(' • ')}
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
  const profileWord = tApp(pack.missingCount === 1 ? 'exploreProfileSingular' : 'exploreProfilePlural')
  const totalProfileWord = tApp(pack.totalProfiles === 1 ? 'exploreProfileSingular' : 'exploreProfilePlural')
  const hiddenProfileWord = tApp(hiddenPreviewCount === 1 ? 'exploreProfileSingular' : 'exploreProfilePlural')
  const followLabel = pack.missingCount > 0
    ? tApp('explorePackFollowCount', { count: pack.missingCount })
    : tApp('explorePackAlreadyFollowing')

  const handleFollow = async () => {
    if (!canBulkFollow || following || pack.missingCount === 0) return

    setFollowing(true)
    setFollowMessage(null)
    setFollowError(null)

    try {
      await onFollowPack(pack)
      setFollowMessage(
        tApp('explorePackAddedProfiles', {
          count: pack.missingCount,
          profileWord,
        }),
      )
    } catch (error) {
      setFollowError(error instanceof Error ? error.message : tApp('explorePackFailedFollow'))
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
          {tApp('explorePackProfileCount', { count: pack.totalProfiles, profileWord: totalProfileWord })}
        </span>
        <span className="rounded-full bg-[rgb(var(--color-accent)/0.14)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label))]">
          {tApp('explorePackNewCount', { count: pack.missingCount })}
        </span>
        {pack.overlapCount > 0 && (
          <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">
            {tApp('explorePackAlreadyFollowCount', { count: pack.overlapCount })}
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
          {tApp('explorePackHiddenProfiles', {
            count: hiddenPreviewCount,
            profileWord: hiddenProfileWord,
          })}
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
            {following ? tApp('explorePackFollowingAction') : followLabel}
          </button>
        )}

        <Link
          to={pack.parsed.route}
          className="rounded-[14px] border border-[rgb(var(--color-fill)/0.14)] px-3 py-2 text-[13px] font-semibold text-[rgb(var(--color-label))] transition-opacity active:opacity-80"
        >
          {tApp('explorePackOpenPack')}
        </Link>
      </div>

      {!canBulkFollow && (
        <p className="mt-3 text-[13px] leading-6 text-[rgb(var(--color-label-tertiary))]">
          {tApp('explorePackConnectSignerHint')}
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

function ProfileResult({
  profile,
  subtitle,
}: {
  profile: Profile
  subtitle?: string
}) {
  const about = profile.about ? sanitizeText(profile.about).slice(0, 180) : ''

  return (
    <Link
      to={`/profile/${profile.pubkey}`}
      className="app-panel block rounded-ios-xl p-4 card-elevated"
    >
      <AuthorRow pubkey={profile.pubkey} profile={profile} />

      {subtitle && (
        <p className="mt-2 text-[13px] text-[rgb(var(--color-label-secondary))]">
          {subtitle}
        </p>
      )}

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

function EventResult({
  event,
  checkEvent,
  semanticResult,
}: {
  event: NostrEvent
  checkEvent: (event: NostrEvent, profile?: Profile) => FilterCheckResult
  semanticResult: FilterCheckResult
}) {
  const { profile } = useProfile(event.pubkey, { background: false })
  const threadIndex = useSelfThreadIndex(event)
  const filterResult = useMemo(
    () => mergeResults(checkEvent(event, profile ?? undefined), semanticResult),
    [checkEvent, event, profile, semanticResult],
  )
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
    <FilteredGate result={filterResult} eventId={event.id}>
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
    </FilteredGate>
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
