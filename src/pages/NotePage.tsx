import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { NoteContent } from '@/components/cards/NoteContent'
import { FileMetadataView } from '@/components/file/FileMetadataView'
import { BadgeAwardBody } from '@/components/nostr/BadgeAwardBody'
import { ConversationSection } from '@/components/nostr/ConversationSection'
import { DeletionRequestBody } from '@/components/nostr/DeletionRequestBody'
import { DvmFeedbackBody } from '@/components/nostr/DvmFeedbackBody'
import { DvmRequestBody } from '@/components/nostr/DvmRequestBody'
import { DvmResultBody } from '@/components/nostr/DvmResultBody'
import { EventActionBar } from '@/components/nostr/EventActionBar'
import { HandlerInformationBody } from '@/components/nostr/HandlerInformationBody'
import { HandlerRecommendationBody } from '@/components/nostr/HandlerRecommendationBody'
import { ListBody } from '@/components/nostr/ListBody'
import { NoteMediaAttachments } from '@/components/nostr/NoteMediaAttachments'
import { PollBody } from '@/components/nostr/PollBody'
import { PollVoteBody } from '@/components/nostr/PollVoteBody'
import { QuotePreviewList } from '@/components/nostr/QuotePreviewList'
import { ReactionBody } from '@/components/nostr/ReactionBody'
import { ReportBody } from '@/components/nostr/ReportBody'
import { RepostBody } from '@/components/nostr/RepostBody'
import { ThreadBody } from '@/components/nostr/ThreadBody'
import { UnknownKindBody } from '@/components/nostr/UnknownKindBody'
import { UserStatusBody } from '@/components/nostr/UserStatusBody'
import { useEventCombinedModeration } from '@/hooks/useEventCombinedModeration'
import { useFilterOverride } from '@/hooks/useFilterOverride'
import { usePageHead } from '@/hooks/usePageHead'
import { useProfile } from '@/hooks/useProfile'
import { getEvent } from '@/lib/db/nostr'
import {
  isNostrPaperSupportedKind,
  parseHandlerInformationEvent,
  parseHandlerRecommendationEvent,
} from '@/lib/nostr/appHandlers'
import { parseBadgeAwardEvent } from '@/lib/nostr/badges'
import { parseDeletionEvent } from '@/lib/nostr/deletion'
import {
  parseDvmJobFeedbackEvent,
  parseDvmJobRequestEvent,
  parseDvmJobResultEvent,
} from '@/lib/nostr/dvm'
import { parseFileMetadataEvent } from '@/lib/nostr/fileMetadata'
import {
  getEventMediaAttachments,
  getImetaHiddenUrls,
  getMediaAttachmentKind,
  getMediaAttachmentPreviewUrl,
} from '@/lib/nostr/imeta'
import { parseNip51ListEvent } from '@/lib/nostr/lists'
import { parseLongFormEvent } from '@/lib/nostr/longForm'
import { buildNoteMetaTags, buildNoteTitle } from '@/lib/nostr/meta'
import { decodeEventReference } from '@/lib/nostr/nip21'
import { getNDK, waitForCachedEvents } from '@/lib/nostr/ndk'
import { parsePollEvent, parsePollVoteEvent } from '@/lib/nostr/polls'
import { parseReactionEvent } from '@/lib/nostr/reaction'
import { parseReportEvent } from '@/lib/nostr/report'
import { getQuotePostBody, parseRepostEvent } from '@/lib/nostr/repost'
import { parseUserStatusEvent } from '@/lib/nostr/status'
import { parseCommentEvent, parseThreadEvent } from '@/lib/nostr/thread'
import { parseVideoEvent } from '@/lib/nostr/video'
import { withRetry } from '@/lib/retry'
import { Kind, type NostrEvent } from '@/types'

export default function NotePage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const handleBack = () => {
    // navigate(-1) is a no-op when the user landed directly on this URL.
    // Fall back to home so the back button always works.
    if (window.history.state?.idx > 0) navigate(-1)
    else navigate('/')
  }
  const [event, setEvent] = useState<NostrEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [override, setOverride] = useState(false)
  const { profile } = useProfile(event?.pubkey)
  const { overridden: filterOverride, setOverridden: setFilterOverride } = useFilterOverride(event?.id)
  const {
    blocked:      isBlocked,
    loading:      moderationLoading,
    mlBlocked:    eventBlocked,
    mlDecision:   moderationDecision,
    keywordResult: keywordFilterResult,
  } = useEventCombinedModeration(event, profile)
  const keywordGated = keywordFilterResult.action !== null && !filterOverride
  const keywordHidden = keywordFilterResult.action === 'hide'
  const blockedByTagr = eventBlocked && (moderationDecision?.reason?.startsWith('tagr:') ?? false)

  // First image attachment URL — used as og:image
  const ogImageUrl = useMemo(() => {
    if (!event) return null
    for (const att of getEventMediaAttachments(event)) {
      if (getMediaAttachmentKind(att) === 'image') {
        return getMediaAttachmentPreviewUrl(att)
      }
    }
    return null
  }, [event])

  usePageHead(
    event && !moderationLoading && (!isBlocked || override) && !keywordGated
      ? {
          title: buildNoteTitle(event, profile),
          tags: buildNoteMetaTags({ event, profile, imageUrl: ogImageUrl }),
        }
      : {},
  )

  useEffect(() => {
    const reference = decodeEventReference(id)
    if (!reference) {
      setEvent(null)
      setLoading(false)
      setError('Invalid note id.')
      return
    }

    const controller = new AbortController()
    const { signal } = controller
    const noteId = reference.eventId

    async function loadLocal(): Promise<NostrEvent | null> {
      return getEvent(noteId)
    }

    async function fetchFromRelays(): Promise<void> {
      let ndk
      try {
        ndk = getNDK()
      } catch {
        return
      }

      await withRetry(
        async () => {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          await ndk.fetchEvents({ ids: [noteId], limit: 1 })
        },
        {
          maxAttempts: 2,
          baseDelayMs: 1_000,
          signal,
        },
      )
    }

    setLoading(true)
    setError(null)
    setEvent(null)

    loadLocal()
      .then(async (cached) => {
        if (signal.aborted) return

        if (cached) {
          const article = parseLongFormEvent(cached)
          const video = parseVideoEvent(cached)
          if (article) {
            navigate(article.route, { replace: true })
            return
          }
          if (video) {
            navigate(video.route, { replace: true })
            return
          }
          setEvent(cached)
          setLoading(false)
          return
        }

        await fetchFromRelays()
        if (signal.aborted) return

        await waitForCachedEvents([noteId])
        if (signal.aborted) return

        const fetched = await loadLocal()
        if (signal.aborted) return

        const article = fetched ? parseLongFormEvent(fetched) : null
        const video = fetched ? parseVideoEvent(fetched) : null
        if (article) {
          navigate(article.route, { replace: true })
          return
        }
        if (video) {
          navigate(video.route, { replace: true })
          return
        }

        setEvent(fetched)
        setLoading(false)
        if (!fetched) {
          setError('Note not found.')
        }
      })
      .catch((loadError: unknown) => {
        if (signal.aborted) return
        setLoading(false)
        setError(loadError instanceof Error ? loadError.message : 'Note load failed.')
      })

    return () => controller.abort()
  }, [id, navigate])

  if (loading || (event !== null && moderationLoading)) {
    return (
      <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pt-safe pb-safe">
        <div className="sticky top-0 z-10 bg-[rgb(var(--color-bg)/0.88)] py-4 backdrop-blur-xl">
          <button
            type="button"
            onClick={handleBack}
            className="rounded-full bg-[rgb(var(--color-fill)/0.09)] px-4 py-2 text-[15px] text-[rgb(var(--color-label))]"
          >
            Back
          </button>
        </div>
        <div className="pt-6 text-[rgb(var(--color-label-secondary))]">
          Loading note…
        </div>
      </div>
    )
  }

  if (!event || ((isBlocked && !override) || keywordGated)) {
    return (
      <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pt-safe pb-safe">
        <div className="sticky top-0 z-10 bg-[rgb(var(--color-bg)/0.88)] py-4 backdrop-blur-xl">
          <button
            type="button"
            onClick={handleBack}
            className="rounded-full bg-[rgb(var(--color-fill)/0.09)] px-4 py-2 text-[15px] text-[rgb(var(--color-label))]"
          >
            Back
          </button>
        </div>
        <div className="pt-6">
          <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-[rgb(var(--color-label))]">
            {isBlocked || keywordHidden ? 'Content hidden' : keywordGated ? 'Content warning' : 'Note unavailable'}
          </h1>
          {isBlocked || keywordGated ? (
            <>
              <p className="mt-3 text-[16px] leading-7 text-[rgb(var(--color-label-secondary))]">
                {isBlocked
                  ? 'This note was hidden by your content filters or mute list.'
                  : 'This note matched your keyword filters.'}
              </p>
              {!isBlocked && keywordFilterResult.matches[0]?.term ? (
                <p className="mt-2 text-[14px] text-[rgb(var(--color-label-secondary))]">
                  Matched filter: &ldquo;{keywordFilterResult.matches[0].term}&rdquo;.
                </p>
              ) : null}
              {blockedByTagr ? (
                <p className="mt-2 text-[14px] font-medium text-[rgb(var(--color-system-red))]">
                  Blocked by Tagr.
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (isBlocked) setOverride(true)
                  if (keywordGated) setFilterOverride(true)
                }}
                className="mt-4 rounded-full bg-[rgb(var(--color-fill)/0.12)] px-4 py-2 text-[15px] font-medium text-[rgb(var(--color-label))]"
              >
                Show Anyway
              </button>
            </>
          ) : error ? (
            <>
              <p className="mt-3 text-[16px] leading-7 text-[rgb(var(--color-label-secondary))]">
                {error === 'Note not found.'
                  ? 'This note could not be found on connected relays. It may have been deleted or the relay may be unavailable.'
                  : error}
              </p>
              <button
                type="button"
                onClick={() => { window.location.reload() }}
                className="mt-4 rounded-full bg-[rgb(var(--color-fill)/0.12)] px-4 py-2 text-[15px] font-medium text-[rgb(var(--color-label))]"
              >
                Try Again
              </button>
            </>
          ) : null}
        </div>
      </div>
    )
  }

  const fileMetadata = parseFileMetadataEvent(event)
  const badgeAward = parseBadgeAwardEvent(event)
  const deletionRequest = parseDeletionEvent(event)
  const dvmRequest = parseDvmJobRequestEvent(event)
  const dvmResult = parseDvmJobResultEvent(event)
  const dvmFeedback = parseDvmJobFeedbackEvent(event)
  const handlerInformation = parseHandlerInformationEvent(event)
  const handlerRecommendation = parseHandlerRecommendationEvent(event)
  const nip51List = parseNip51ListEvent(event)
  const poll = parsePollEvent(event)
  const pollVote = parsePollVoteEvent(event)
  const repost = parseRepostEvent(event)
  const reaction = parseReactionEvent(event)
  const report = parseReportEvent(event)
  const thread = parseThreadEvent(event)
  const comment = parseCommentEvent(event)
  const userStatus = parseUserStatusEvent(event)
  const unsupportedKind = !isNostrPaperSupportedKind(event.kind)
    || (event.kind === Kind.Poll && !poll)
    || (event.kind === Kind.PollVote && !pollVote)
  const quoteBody = getQuotePostBody(event)
  const attachments = getEventMediaAttachments(event)
  const hiddenUrls = getImetaHiddenUrls(event)

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pb-safe">
      <div className="sticky top-0 z-10 bg-[rgb(var(--color-bg)/0.88)] py-4 pt-safe backdrop-blur-xl">
        <button
          type="button"
          onClick={handleBack}
          className="rounded-full bg-[rgb(var(--color-fill)/0.09)] px-4 py-2 text-[15px] text-[rgb(var(--color-label))]"
        >
          Back
        </button>
      </div>

      <article className="pb-10 pt-4">
        {fileMetadata ? (
          <>
            <FileMetadataView event={event} metadata={fileMetadata} profile={profile} />
            <EventActionBar event={event} className="mt-5" />
            <ConversationSection event={event} section="replies" className="mt-6" />
          </>
        ) : (
          <>
            {/* Parent context — shows above the post if this is a reply */}
            <ConversationSection event={event} section="root" className="mb-4" />

            <AuthorRow
              pubkey={event.pubkey}
              profile={profile}
              timestamp={event.created_at}
              large
              actions
            />

            {repost ? (
              <RepostBody event={event} className="mt-4" />
            ) : poll ? (
              <PollBody event={event} className="mt-4" />
            ) : pollVote ? (
              <PollVoteBody event={event} className="mt-4" />
            ) : badgeAward ? (
              <BadgeAwardBody event={event} className="mt-4" />
            ) : handlerInformation ? (
              <HandlerInformationBody event={event} className="mt-4" />
            ) : handlerRecommendation ? (
              <HandlerRecommendationBody event={event} className="mt-4" />
            ) : deletionRequest ? (
              <DeletionRequestBody event={event} className="mt-4" />
            ) : dvmRequest ? (
              <DvmRequestBody event={event} className="mt-4" />
            ) : dvmResult ? (
              <DvmResultBody event={event} className="mt-4" />
            ) : dvmFeedback ? (
              <DvmFeedbackBody event={event} className="mt-4" />
            ) : reaction ? (
              <ReactionBody event={event} className="mt-4" />
            ) : report ? (
              <ReportBody event={event} className="mt-4" />
            ) : thread ? (
              <ThreadBody event={event} className="mt-4" />
            ) : comment ? (
              <>
                {comment.content.trim().length > 0 && (
                  <NoteContent content={comment.content} className="mt-4" allowTranslation enableMarkdown />
                )}
                <QuotePreviewList event={event} showHeader={false} className="mt-5" />
              </>
            ) : userStatus ? (
              <UserStatusBody event={event} className="mt-4" />
            ) : nip51List ? (
              <ListBody event={event} className="mt-4" />
            ) : unsupportedKind ? (
              <UnknownKindBody event={event} className="mt-4" />
            ) : (
              <>
                {quoteBody.trim().length > 0 && (
                  <NoteContent content={quoteBody} className="mt-4" hiddenUrls={hiddenUrls} allowTranslation enableMarkdown />
                )}
                {attachments.length > 0 && (
                  <NoteMediaAttachments attachments={attachments} className="mt-5" />
                )}
                <QuotePreviewList event={event} showHeader={false} className="mt-5" />
              </>
            )}

            <EventActionBar event={event} className="mt-5" />
            <ConversationSection event={event} section="replies" className="mt-6" />
          </>
        )}
      </article>
    </div>
  )
}
