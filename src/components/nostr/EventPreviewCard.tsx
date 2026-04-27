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
import { parseCommentEvent, parseNumberedThreadMarker, parseTextNoteReply, parseThreadEvent } from '@/lib/nostr/thread'
import { parseVideoEvent } from '@/lib/nostr/video'
import { parseHighlightEvent } from '@/lib/nostr/highlight'
import { isThreadInspectorEnabled } from '@/lib/runtime/debugSettings'
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
  if (parseHighlightEvent(event)) return 'Highlight'
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
        {list.description ? (
          <p className="mt-2 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-3">
            <TwemojiText text={list.description} />
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {list.publicItems.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-0.5 text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">
              {list.publicItems.length} {list.publicItems.length === 1 ? 'item' : 'items'}
            </span>
          )}
          {list.hasPrivateItems && (
            <span className="inline-flex items-center rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-0.5 text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">
              + private
            </span>
          )}
          {!list.description && list.publicItems.length === 0 && (
            <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              <TwemojiText text={getNip51ListPreviewText(event)} />
            </p>
          )}
        </div>
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

  const highlight = parseHighlightEvent(event)
  if (highlight) {
    return (
      <>
        <blockquote className="mt-3 rounded-[10px] border-l-[3px] border-[rgb(var(--color-system-yellow,255_214_10))] bg-[rgb(var(--color-system-yellow,255_214_10)/0.08)] py-2 pl-3 pr-2">
          <p className="text-[14px] leading-6 text-[rgb(var(--color-label))] italic line-clamp-3">
            &ldquo;<TwemojiText text={highlight.excerpt} />&rdquo;
          </p>
        </blockquote>
        {highlight.comment && (
          <p className="mt-2 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))] line-clamp-2">
            <TwemojiText text={highlight.comment} />
          </p>
        )}
      </>
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
  const threadInspectorEnabled = isThreadInspectorEnabled()
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
  const numberedMarker = parseNumberedThreadMarker(event.content)
  const parsedReply = parseTextNoteReply(event)

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

      {threadInspectorEnabled && (
        <div className="mt-3 rounded-[12px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-2.5 py-2 font-mono text-[11px] leading-5 text-[rgb(var(--color-label-secondary))]">
          <p>kind={event.kind} id={event.id.slice(0, 12)}... sig={event.sig.slice(0, 12)}...</p>
          {numberedMarker && (
            <p>marker={numberedMarker.index}/{numberedMarker.total}</p>
          )}
          {parsedReply?.rootEventId && (
            <p>root={parsedReply.rootEventId.slice(0, 12)}... parent={parsedReply.parentEventId.slice(0, 12)}...</p>
          )}
        </div>
      )}

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
