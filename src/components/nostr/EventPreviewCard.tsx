import { Link } from 'react-router-dom'
import { NoteContent } from '@/components/cards/NoteContent'
import { NoteMediaAttachments } from '@/components/nostr/NoteMediaAttachments'
import { PollPreview } from '@/components/nostr/PollPreview'
import { ThreadIndexBadge } from '@/components/nostr/ThreadIndexBadge'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { TwemojiText } from '@/components/ui/TwemojiText'
import { useSelfThreadIndex } from '@/hooks/useSelfThreadIndex'
import { useEventModeration } from '@/hooks/useModeration'
import { useProfile } from '@/hooks/useProfile'
import {
  getHandlerDisplayName,
  getHandlerRecommendationSummary,
  getHandlerSummary,
  isNostrPaperSupportedKind,
  parseHandlerInformationEvent,
  parseHandlerRecommendationEvent,
} from '@/lib/nostr/appHandlers'
import { parseBadgeAwardEvent } from '@/lib/nostr/badges'
import { parseDeletionEvent } from '@/lib/nostr/deletion'
import {
  getDvmFeedbackPreviewText,
  getDvmRequestPreviewText,
  getDvmResultPreviewText,
  parseDvmJobFeedbackEvent,
  parseDvmJobRequestEvent,
  parseDvmJobResultEvent,
} from '@/lib/nostr/dvm'
import { parseFileMetadataEvent } from '@/lib/nostr/fileMetadata'
import { getEventMediaAttachments, getImetaHiddenUrls } from '@/lib/nostr/imeta'
import { getNip51ListLabel, getNip51ListPreviewText, parseNip51ListEvent } from '@/lib/nostr/lists'
import { parseLongFormEvent } from '@/lib/nostr/longForm'
import { parsePollEvent, parsePollVoteEvent } from '@/lib/nostr/polls'
import { getReactionLabel, parseReactionEvent } from '@/lib/nostr/reaction'
import { getReportPreviewText, parseReportEvent } from '@/lib/nostr/report'
import { getQuotePostBody, getRepostPreviewText, parseQuoteTags, parseRepostEvent } from '@/lib/nostr/repost'
import { getUserStatusExternalHref, getUserStatusLabel, parseUserStatusEvent } from '@/lib/nostr/status'
import { parseCommentEvent, parseThreadEvent } from '@/lib/nostr/thread'
import { parseVideoEvent } from '@/lib/nostr/video'
import type { NostrEvent } from '@/types'

interface EventPreviewCardProps {
  event: NostrEvent
  className?: string
  compact?: boolean
  linked?: boolean
}

function getHref(event: NostrEvent): string {
  const article = parseLongFormEvent(event)
  const video = parseVideoEvent(event)
  const list = parseNip51ListEvent(event)
  return article?.route ?? video?.route ?? list?.route ?? `/note/${event.id}`
}

function getKindLabel(event: NostrEvent): string | null {
  if (parseLongFormEvent(event)) return 'Article'
  const video = parseVideoEvent(event)
  if (video) return video.isShort ? 'Short video' : 'Video'
  const list = parseNip51ListEvent(event)
  if (list) return getNip51ListLabel(event.kind)
  if (parseHandlerInformationEvent(event)) return 'App handler'
  if (parseHandlerRecommendationEvent(event)) return 'Recommendation'
  if (parseDvmJobRequestEvent(event)) return 'DVM request'
  if (parseDvmJobResultEvent(event)) return 'DVM result'
  if (parseDvmJobFeedbackEvent(event)) return 'DVM feedback'
  if (parseFileMetadataEvent(event)) return 'File metadata'
  if (parseBadgeAwardEvent(event)) return 'Badge award'
  if (parsePollEvent(event)) return 'Poll'
  if (parsePollVoteEvent(event)) return 'Poll vote'
  if (parseDeletionEvent(event)) return 'Deletion request'
  if (parseReactionEvent(event)) return 'Reaction'
  if (parseReportEvent(event)) return 'Report'
  if (parseRepostEvent(event)) return 'Repost'
  if (parseThreadEvent(event)) return 'Thread'
  if (parseCommentEvent(event)) return 'Comment'
  const userStatus = parseUserStatusEvent(event)
  if (userStatus) return userStatus.identifier === 'music' ? 'Music status' : 'User status'
  return null
}

function PreviewBody({ event, compact = false, interactive = true }: { event: NostrEvent; compact?: boolean; interactive?: boolean }) {
  const list = parseNip51ListEvent(event)
  if (list) {
    return (
      <>
        {list.title && list.title !== list.definition.name && (
          <h3 className="mt-3 text-[18px] leading-tight font-semibold tracking-[-0.02em] text-[rgb(var(--color-label))]">
            <TwemojiText text={list.title} />
          </h3>
        )}
        <p className="mt-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
          <TwemojiText text={list.description ?? getNip51ListPreviewText(event)} />
        </p>
      </>
    )
  }

  const article = parseLongFormEvent(event)
  if (article) {
    return (
      <>
        {article.title && (
          <h3 className="mt-3 text-[18px] leading-tight font-semibold tracking-[-0.02em] text-[rgb(var(--color-label))]">
            <TwemojiText text={article.title} />
          </h3>
        )}
        {article.summary && (
          <p className="mt-2 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
            <TwemojiText text={article.summary} />
          </p>
        )}
      </>
    )
  }

  const video = parseVideoEvent(event)
  if (video) {
    return (
      <>
        <h3 className="mt-3 text-[18px] leading-tight font-semibold tracking-[-0.02em] text-[rgb(var(--color-label))]">
          <TwemojiText text={video.title} />
        </h3>
        {video.summary && (
          <p className="mt-2 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
            <TwemojiText text={video.summary} />
          </p>
        )}
      </>
    )
  }

  const handlerInformation = parseHandlerInformationEvent(event)
  if (handlerInformation) {
    return (
      <>
        <h3 className="mt-3 text-[18px] leading-tight font-semibold tracking-[-0.02em] text-[rgb(var(--color-label))]">
          <TwemojiText text={getHandlerDisplayName(handlerInformation)} />
        </h3>
        <p className="mt-2 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
          <TwemojiText text={getHandlerSummary(handlerInformation)} />
        </p>
      </>
    )
  }

  const handlerRecommendation = parseHandlerRecommendationEvent(event)
  if (handlerRecommendation) {
    return (
      <p className="mt-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
        <TwemojiText text={getHandlerRecommendationSummary(handlerRecommendation)} />
      </p>
    )
  }

  const dvmRequest = parseDvmJobRequestEvent(event)
  if (dvmRequest) {
    return (
      <p className="mt-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
        <TwemojiText text={getDvmRequestPreviewText(event)} />
      </p>
    )
  }

  const dvmResult = parseDvmJobResultEvent(event)
  if (dvmResult) {
    return (
      <p className="mt-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
        <TwemojiText text={getDvmResultPreviewText(event)} />
      </p>
    )
  }

  const dvmFeedback = parseDvmJobFeedbackEvent(event)
  if (dvmFeedback) {
    return (
      <p className="mt-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
        <TwemojiText text={getDvmFeedbackPreviewText(event)} />
      </p>
    )
  }

  const fileMetadata = parseFileMetadataEvent(event)
  if (fileMetadata) {
    const description = fileMetadata.metadata.alt ?? fileMetadata.metadata.summary ?? fileMetadata.description ?? 'Shared a file.'
    return (
      <p className="mt-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
        <TwemojiText text={description} />
      </p>
    )
  }

  const badgeAward = parseBadgeAwardEvent(event)
  if (badgeAward) {
    return (
      <p className="mt-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
        <TwemojiText text={badgeAward.note ?? `Awarded a badge to ${badgeAward.recipients.length} profile${badgeAward.recipients.length === 1 ? '' : 's'}.`} />
      </p>
    )
  }

  const deletion = parseDeletionEvent(event)
  if (deletion) {
    const targetCount = deletion.eventIds.length + deletion.coordinates.length
    return (
      <p className="mt-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
        <TwemojiText text={deletion.reason ?? `Requested deletion of ${targetCount} target${targetCount === 1 ? '' : 's'}.`} />
      </p>
    )
  }

  const reaction = parseReactionEvent(event)
  if (reaction) {
    return (
      <p className="mt-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
        <TwemojiText text={getReactionLabel(reaction)} />
      </p>
    )
  }

  const reportPreview = getReportPreviewText(event)
  if (reportPreview) {
    return (
      <p className="mt-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
        <TwemojiText text={reportPreview} />
      </p>
    )
  }

  const repost = parseRepostEvent(event)
  if (repost) {
    return (
      <p className="mt-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
        <TwemojiText text={getRepostPreviewText(event)} />
      </p>
    )
  }

  const poll = parsePollEvent(event)
  if (poll) {
    return <PollPreview poll={poll} className="mt-3" compact={compact} />
  }

  const pollVote = parsePollVoteEvent(event)
  if (pollVote) {
    return (
      <p className="mt-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
        <TwemojiText
          text={pollVote.responses.length > 0
            ? `Voted for ${pollVote.responses.length} option${pollVote.responses.length === 1 ? '' : 's'} in a poll.`
            : 'Submitted a poll vote.'}
        />
      </p>
    )
  }

  const thread = parseThreadEvent(event)
  if (thread) {
    return (
      <>
        {thread.title && (
          <h3 className="mt-3 text-[18px] leading-tight font-semibold tracking-[-0.02em] text-[rgb(var(--color-label))]">
            <TwemojiText text={thread.title} />
          </h3>
        )}
        {thread.content && (
          <p className="mt-2 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
            <TwemojiText text={thread.content} />
          </p>
        )}
      </>
    )
  }

  const comment = parseCommentEvent(event)
  if (comment) {
    return (
      <p className="mt-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
        <TwemojiText text={comment.content || 'Commented on an event.'} />
      </p>
    )
  }

  const userStatus = parseUserStatusEvent(event)
  if (userStatus) {
    const externalHref = getUserStatusExternalHref(userStatus)
    return (
      <p className="mt-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
        <TwemojiText
          text={externalHref
            ? `${getUserStatusLabel(userStatus)} • ${externalHref}`
            : getUserStatusLabel(userStatus)}
        />
      </p>
    )
  }

  const quoteBody = getQuotePostBody(event)
  const attachments = getEventMediaAttachments(event)
  const hiddenUrls = getImetaHiddenUrls(event)
  if (quoteBody.trim().length === 0 && parseQuoteTags(event).length > 0) {
    return (
      <p className="mt-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
        <TwemojiText text="Quoted an event." />
      </p>
    )
  }

  if (
    !isNostrPaperSupportedKind(event.kind)
    || (event.kind === 1068 && !poll)
    || (event.kind === 1018 && !pollVote)
  ) {
    return (
      <p className="mt-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
        <TwemojiText text={`Unsupported kind ${event.kind}.`} />
      </p>
    )
  }

  return (
    <>
      <NoteContent
        content={quoteBody}
        compact={compact}
        className="mt-3"
        hiddenUrls={hiddenUrls}
        interactive={interactive}
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
  )
}

export function EventPreviewCard({
  event,
  className = '',
  compact = false,
  linked = true,
}: EventPreviewCardProps) {
  const threadIndex = useSelfThreadIndex(event)
  const { blocked, loading, decision } = useEventModeration(event)
  const { profile } = useProfile(event.pubkey, { background: false })
  const blockedByTagr = blocked && (decision?.reason?.startsWith('tagr:') ?? false)

  if (loading) return null

  if (blockedByTagr) {
    return (
      <div className={`rounded-[18px] border border-[rgb(var(--color-system-red)/0.22)] bg-[rgb(var(--color-system-red)/0.06)] p-3 ${className}`}>
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-system-red))]">
          Content hidden
        </p>
        <p className="mt-1 text-[14px] text-[rgb(var(--color-label-secondary))]">
          Blocked by Tagr.
        </p>
      </div>
    )
  }

  if (blocked) return null

  const kindLabel = getKindLabel(event)
  const href = getHref(event)

  const content = (
    <div className={`rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3 ${className}`}>
      <AuthorRow
        pubkey={event.pubkey}
        profile={profile}
        timestamp={event.created_at}
      />

      {kindLabel && (
        <p className="mt-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
          {kindLabel}
        </p>
      )}

      <ThreadIndexBadge threadIndex={threadIndex} className="mt-3" />

      <PreviewBody event={event} compact={compact} interactive={!linked} />
    </div>
  )

  if (!linked) return content

  return (
    <Link to={href} className="block">
      {content}
    </Link>
  )
}
