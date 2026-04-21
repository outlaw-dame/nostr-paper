/**
 * SearchPage
 *
 * Local-first NIP-50 search over cached notes/articles and profiles, with
 * relay forwarding in the background. Query state is mirrored in the URL so
 * searches are shareable and survive navigation.
 */

import { useEffect, useMemo, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { FilteredGate } from '@/components/filters/FilteredGate'
import { SearchBar } from '@/components/search/SearchBar'
import { SearchAiAnswer } from '@/components/search/SearchAiAnswer'
import { FeedSkeleton } from '@/components/feed/FeedSkeleton'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { NoteContent } from '@/components/cards/NoteContent'
import { NoteMediaAttachments } from '@/components/nostr/NoteMediaAttachments'
import { PollPreview } from '@/components/nostr/PollPreview'
import { ThreadIndexBadge } from '@/components/nostr/ThreadIndexBadge'
import { mergeResults, useEventFilterCheck, useSemanticFiltering } from '@/hooks/useKeywordFilters'
import { useModerationDocuments } from '@/hooks/useModeration'
import { useSearch } from '@/hooks/useSearch'
import { useProfile } from '@/hooks/useProfile'
import { useSelfThreadIndex } from '@/hooks/useSelfThreadIndex'
import { useMuteList } from '@/hooks/useMuteList'
import { useHideNsfwTaggedPosts } from '@/hooks/useHideNsfwTaggedPosts'
import { getEventMediaAttachments, getImetaHiddenUrls } from '@/lib/nostr/imeta'
import { parseLongFormEvent } from '@/lib/nostr/longForm'
import {
  buildEventModerationDocument,
  buildProfileModerationDocument,
} from '@/lib/moderation/content'
import { filterNsfwTaggedEvents } from '@/lib/moderation/nsfwTags'
import { formatNip05Identifier } from '@/lib/nostr/nip05'
import { parsePollEvent } from '@/lib/nostr/polls'
import { parseSearchQuery, warmSearchRelays } from '@/lib/nostr/search'
import { initSemanticSearch } from '@/lib/semantic/client'
import { parseCommentEvent, parseThreadEvent } from '@/lib/nostr/thread'
import { sanitizeText } from '@/lib/security/sanitize'
import { parseVideoEvent } from '@/lib/nostr/video'
import type { FilterCheckResult } from '@/lib/filters/types'
import type { NostrEvent, Profile } from '@/types'
import { Kind } from '@/types'

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

export default function SearchPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryParam = searchParams.get('q') ?? ''
  const previousQueryParamRef = useRef(queryParam)

  // Pre-warm NIP-50 relay connections as soon as the search page mounts so
  // the first actual search doesn't pay the full WebSocket setup cost.
  useEffect(() => {
    warmSearchRelays()
    void initSemanticSearch().catch((error: unknown) => {
      console.warn('[SearchPage] Semantic prewarm degraded:', error)
    })
  }, [])

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
  } = useSearch({
    kinds: SEARCHABLE_KINDS,
    localLimit: 40,
    relayLimit: 40,
  })

  const { isMuted, loading: muteListLoading } = useMuteList()
  const hideNsfwTaggedPosts = useHideNsfwTaggedPosts()
  const checkEvent = useEventFilterCheck()

  const parsedQuery = useMemo(() => parseSearchQuery(query), [query])
  const unsupportedKeys = useMemo(
    () => [...new Set(parsedQuery.unsupportedExtensions.map(ext => ext.key))],
    [parsedQuery],
  )
  const eventModerationDocuments = useMemo(
    () => events
      .map((event) => buildEventModerationDocument(event))
      .filter((document): document is NonNullable<ReturnType<typeof buildEventModerationDocument>> => document !== null),
    [events],
  )
  const profileModerationDocuments = useMemo(
    () => profiles
      .map((profile) => buildProfileModerationDocument(profile))
      .filter((document): document is NonNullable<ReturnType<typeof buildProfileModerationDocument>> => document !== null),
    [profiles],
  )
  const eventModerationIds = useMemo(
    () => new Set(eventModerationDocuments.map((document) => document.id)),
    [eventModerationDocuments],
  )
  const profileModerationIds = useMemo(
    () => new Set(profileModerationDocuments.map((document) => document.id)),
    [profileModerationDocuments],
  )
  const {
    allowedIds: allowedEventIds,
    loading: eventModerationLoading,
  } = useModerationDocuments(eventModerationDocuments)
  const {
    allowedIds: allowedProfileIds,
    loading: profileModerationLoading,
  } = useModerationDocuments(profileModerationDocuments)
  const visibleEvents = useMemo(() => {
    const filtered = filterNsfwTaggedEvents(
      events.filter((event) => !isMuted(event.pubkey) && (!eventModerationIds.has(event.id) || allowedEventIds.has(event.id))),
      hideNsfwTaggedPosts,
    )

    return [...filtered].sort((left, right) => {
      if (right.created_at !== left.created_at) return right.created_at - left.created_at
      return right.id.localeCompare(left.id)
    })
  }, [allowedEventIds, eventModerationIds, events, hideNsfwTaggedPosts, isMuted])
  const semanticFilterResults = useSemanticFiltering(visibleEvents)
  const visibleProfiles = useMemo(
    () => profiles.filter((profile) => !isMuted(profile.pubkey) && (!profileModerationIds.has(profile.pubkey) || allowedProfileIds.has(profile.pubkey))),
    [allowedProfileIds, profileModerationIds, profiles, isMuted],
  )

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

  // localLoading / relayLoading drive the status text and skeleton display.
  // Moderation loading is intentionally excluded — it runs in the background
  // after results are already visible and should not gate the empty-state check.
  const fetchLoading = localLoading || relayLoading || muteListLoading
  const idle = input.trim().length === 0
  const hasResults = visibleEvents.length > 0 || visibleProfiles.length > 0
  const showSkeleton = fetchLoading && !hasResults && !idle
  const empty = !fetchLoading && query.length > 0 && !hasResults

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))]">
      <div className="app-chrome sticky top-0 z-20 px-4 pt-safe pb-2.5">
        <div className="flex items-center gap-3 pt-1.5">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="
              app-panel-muted
              h-10 w-10 rounded-full
              text-[rgb(var(--color-label))]
              flex items-center justify-center
              active:opacity-80
            "
            aria-label="Go back"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M9.5 3.25L4.75 8l4.75 4.75"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <div className="min-w-0 flex-1">
            <p className="section-kicker">Search</p>
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
          <p className="mt-2 text-[13px] text-[#C65D2E]">
            Relay search degraded: {relayError}
          </p>
        )}

        {semanticError && (
          <p className="mt-2 text-[13px] text-[#C65D2E]">
            Semantic reranking degraded: {semanticError}
          </p>
        )}
      </div>

      <div className="px-4 pb-safe pb-8">
        {idle ? (
          <SearchHint />
        ) : showSkeleton ? (
          <div className="space-y-3 mt-2">
            <FeedSkeleton type="card" />
            <FeedSkeleton type="card" />
            <FeedSkeleton type="card" />
          </div>
        ) : empty ? (
          <SearchEmpty />
        ) : (
          <div className="space-y-5">
            <SearchAiAnswer
              query={query}
              events={visibleEvents}
              profiles={visibleProfiles}
            />

            {visibleProfiles.length > 0 && (
              <section>
                <h2 className="section-kicker px-1 mb-3">
                  People
                </h2>
                <div className="space-y-3">
                  {visibleProfiles.map(profile => (
                    <ProfileResult key={profile.pubkey} profile={profile} />
                  ))}
                </div>
              </section>
            )}

            {visibleEvents.length > 0 && (
              <section>
                <h2 className="section-kicker px-1 mb-3">
                  Posts
                </h2>
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

function ProfileResult({ profile }: { profile: Profile }) {
  const about = profile.about ? sanitizeText(profile.about).slice(0, 180) : ''

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
    >
      <Link
        to={`/profile/${profile.pubkey}`}
        className="
          app-panel block rounded-ios-xl p-4
          card-elevated
        "
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
    </motion.div>
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
  const kindLabel = poll
    ? 'Poll'
    : article
    ? 'Article'
    : thread
      ? 'Thread'
      : comment
        ? 'Comment'
    : video
      ? (video.isShort ? 'Short video' : 'Video')
      : 'Note'
  const href = article?.route ?? video?.route ?? `/note/${event.id}`

  return (
    <FilteredGate result={filterResult} eventId={event.id}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
      >
        <Link
          to={href}
          className="
            app-panel block rounded-ios-xl p-4
            card-elevated
          "
        >
          <div className="flex items-start justify-between gap-3">
            <AuthorRow
              pubkey={event.pubkey}
              profile={profile}
              timestamp={event.created_at}
            />

            <span className="
              px-2 py-1 rounded-full
              text-[11px] font-semibold uppercase tracking-[0.08em]
              bg-[rgb(var(--color-fill)/0.1)]
              text-[rgb(var(--color-label-secondary))]
            ">
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
              <NoteContent
                content={event.content}
                className="mt-3"
                hiddenUrls={hiddenUrls}
                interactive={false}
              />
              {attachments.length > 0 && (
                <NoteMediaAttachments
                  attachments={attachments}
                  className="mt-3"
                  compact
                  interactive={false}
                />
              )}
            </>
          )}
        </Link>
      </motion.div>
    </FilteredGate>
  )
}

function SearchHint() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="
        mt-8 rounded-ios-2xl p-6
        app-panel
        text-[rgb(var(--color-label))]
      "
    >
      <p className="text-headline mb-2">Search the people and stories already close at hand</p>
      <p className="text-body text-[rgb(var(--color-label-secondary))]">
        Use phrases in quotes for exact matches. Local ranking is blended with
        on-device semantic results when available, and standardized
        `domain:example.com` filters continue to pass through to relays.
      </p>
    </motion.div>
  )
}

function SearchEmpty() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="
        mt-8 rounded-ios-2xl p-8 text-center
        app-panel
      "
    >
      <p className="text-headline text-[rgb(var(--color-label))] mb-2">
        No search results
      </p>
      <p className="text-body text-[rgb(var(--color-label-secondary))]">
        Try a broader query or remove any relay-only filters.
      </p>
    </motion.div>
  )
}
