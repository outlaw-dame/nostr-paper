/**
 * ExpandedNote
 *
 * Full-screen note view that morphs from HeroCard via Framer Motion layoutId.
 * Pull-down to dismiss — only when content is scrolled to top.
 * Uses dragControls to start drag only from the top region of the view,
 * preventing conflicts with the scrollable content below.
 */

import { useCallback, useRef, useState } from 'react'
import {
  motion,
  useMotionValue,
  useTransform,
  useDragControls,
  type PanInfo,
} from 'motion/react'
import { Navbar, Block } from 'konsta/react'
import { ArticleBody } from '@/components/article/ArticleBody'
import { SensitiveImage } from '@/components/media/SensitiveImage'
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
import { AuthorRow } from '@/components/profile/AuthorRow'
import { VideoBody } from '@/components/video/VideoBody'
import { NoteContent } from './NoteContent'
import {
  isNostrPaperSupportedKind,
  parseHandlerInformationEvent,
  parseHandlerRecommendationEvent,
} from '@/lib/nostr/appHandlers'
import { parseContentWarning } from '@/lib/nostr/contentWarning'
import { parseBadgeAwardEvent } from '@/lib/nostr/badges'
import { parseDeletionEvent } from '@/lib/nostr/deletion'
import {
  parseDvmJobFeedbackEvent,
  parseDvmJobRequestEvent,
  parseDvmJobResultEvent,
} from '@/lib/nostr/dvm'
import { getEventMediaAttachments, getImetaHiddenUrls, getMediaAttachmentPreviewUrl } from '@/lib/nostr/imeta'
import { parseNip51ListEvent } from '@/lib/nostr/lists'
import { parseLongFormEvent } from '@/lib/nostr/longForm'
import { parsePollEvent, parsePollVoteEvent } from '@/lib/nostr/polls'
import { parseReactionEvent } from '@/lib/nostr/reaction'
import { parseReportEvent } from '@/lib/nostr/report'
import { getQuotePostBody, parseRepostEvent } from '@/lib/nostr/repost'
import { parseUserStatusEvent } from '@/lib/nostr/status'
import { parseCommentEvent, parseThreadEvent } from '@/lib/nostr/thread'
import { getProxyInfo, getProtocolMeta } from '@/lib/nostr/proxyTag'
import { getVideoPreviewImage, parseVideoEvent } from '@/lib/nostr/video'
import { useFollowStatus } from '@/hooks/useFollowStatus'
import { Kind, type NostrEvent, type Profile } from '@/types'

interface ExpandedNoteProps {
  event:   NostrEvent
  profile: Profile | null
  onClose: () => void
}

const DISMISS_OFFSET = 110  // px pull-down to dismiss
const DISMISS_VEL    = 700  // px/s velocity to dismiss

export function ExpandedNote({ event, profile, onClose }: ExpandedNoteProps) {
  const scrollRef   = useRef<HTMLDivElement>(null)
  const dragY       = useMotionValue(0)
  const dragControls = useDragControls()
  const [isDragging, setIsDragging] = useState(false)
  const followStatus = useFollowStatus(event.pubkey)
  const contentWarning = parseContentWarning(event)

  // Parallax effect on drag — note "peels back" as user pulls
  const overlayOpacity = useTransform(dragY, [0, 100, DISMISS_OFFSET], [1, 0.9, 0.6])
  const contentScale   = useTransform(dragY, [0, DISMISS_OFFSET], [1, 0.97])

  const article = parseLongFormEvent(event)
  const video = parseVideoEvent(event)
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
    const proxyInfo = getProxyInfo(event)
  const primaryMedia = article?.image ?? (video ? getVideoPreviewImage(video) : undefined) ?? attachments
    .map((attachment) => getMediaAttachmentPreviewUrl(attachment))
    .find((url): url is string => typeof url === 'string')

  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      setIsDragging(false)
      if (info.offset.y > DISMISS_OFFSET || info.velocity.y > DISMISS_VEL) {
        onClose()
      } else {
        dragY.set(0)
      }
    },
    [onClose, dragY],
  )

  // Start drag only when content is scrolled to the top.
  // Fired from the top-drag-handle region via onPointerDown.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const scrollEl = scrollRef.current
      if (scrollEl && scrollEl.scrollTop > 8) return  // Content scrolled — don't drag
      setIsDragging(true)
      dragControls.start(e)
    },
    [dragControls],
  )

  return (
    <motion.div
      layoutId={`card-${event.id}`}
      className="
        fixed inset-0 z-50
        bg-[rgb(var(--color-bg))]
        flex flex-col
        overflow-hidden
      "
      initial={{ borderRadius: 24 }}
      animate={{ borderRadius: 0 }}
      exit={{
        borderRadius: 24,
        opacity: 0,
        scale: 0.95,
        transition: { duration: 0.22, ease: [0.32, 0.72, 0, 1] },
      }}
      style={{ opacity: overlayOpacity }}
      drag="y"
      dragControls={dragControls}
      dragListener={false}          // Only drag when dragControls.start() is called
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.35 }}
      dragMomentum={false}
      onDragEnd={handleDragEnd}
    >
      <motion.div
        className="flex flex-col h-full"
        style={{ scale: contentScale }}
      >
        {/* Drag handle zone at top — tap area that initiates the dismiss gesture */}
        <div
          className="
            absolute top-0 left-0 right-0 h-16 z-20
            cursor-grab active:cursor-grabbing
          "
          style={{ touchAction: 'none' }}
          onPointerDown={handlePointerDown}
          aria-hidden="true"
        />

        {/* Pull-down indicator pill */}
        {isDragging && (
          <motion.div
            className="
              absolute top-3 left-1/2 -translate-x-1/2 z-30
              h-1 w-10 rounded-full bg-[rgb(var(--color-fill)/0.32)]
            "
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          />
        )}

        {/* Sticky top chrome */}
        <div className="app-chrome sticky top-0 z-30 pt-safe">
          <Navbar
            left={
              <button
                type="button"
                onClick={onClose}
                className="flex items-center gap-1 text-[rgb(var(--color-accent))] active:opacity-60"
              >
                <svg width="10" height="16" viewBox="0 0 10 17" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8.5 1.5L1.5 8.5L8.5 15.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-[17px]">Feed</span>
              </button>
            }
            title={
              <span className="text-[17px] font-semibold tracking-tight text-[rgb(var(--color-label))]">
                {article?.title ?? video?.title ?? profile?.display_name ?? profile?.name ?? 'Note'}
              </span>
            }
          />
        </div>

        {/* Scrollable content — drag does not intercept here */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto scroll-momentum scrollbar-none overscroll-contain"
        >
          {primaryMedia && attachments.length === 0 && !video && (
            <div className="w-full aspect-video bg-[rgb(var(--color-bg-secondary))]">
              <SensitiveImage
                src={primaryMedia}
                className="w-full h-full"
                disableTilt
                isSensitive={contentWarning !== null}
                reason={contentWarning?.reason}
                isUnfollowed={followStatus === false}
              />
            </div>
          )}

          <Block>
            {article ? (
              <ArticleBody event={event} profile={profile} />
            ) : video ? (
              <VideoBody event={event} profile={profile} />
            ) : (
              <>
                <AuthorRow
                  pubkey={event.pubkey}
                  profile={profile}
                  timestamp={event.created_at}
                  large
                />

                  {proxyInfo && (
                    <div className="mt-2.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${getProtocolMeta(proxyInfo.protocol).badgeClass}`}
                      >
                        {getProtocolMeta(proxyInfo.protocol).label}
                      </span>
                    </div>
                  )}

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
                      <NoteContent
                        content={comment.content}
                        className="mt-4"
                        allowTranslation
                        enableMarkdown
                      />
                    )}
                    <QuotePreviewList event={event} className="mt-5" />
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
                      <NoteContent
                        content={quoteBody}
                        className="mt-4"
                        hiddenUrls={hiddenUrls}
                        allowTranslation
                        enableMarkdown
                      />
                    )}
                    {attachments.length > 0 && (
                      <NoteMediaAttachments attachments={attachments} className="mt-5" />
                    )}
                    <QuotePreviewList event={event} className="mt-5" />
                  </>
                )}

                <EventActionBar event={event} className="mt-5" />
                <ConversationSection event={event} className="mt-6" />
              </>
            )}
          </Block>

          <div className="h-[max(32px,_env(safe-area-inset-bottom))]" />
        </div>
      </motion.div>
    </motion.div>
  )
}
