import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ReportSheet } from '@/components/nostr/ReportSheet'
import { ZapSheet } from '@/components/nostr/ZapSheet'
import { formatZapAmount } from '@/lib/nostr/zap'
import { useApp } from '@/contexts/app-context'
import { buildComposeSearch } from '@/lib/compose'
import { getEventEngagementSummary } from '@/lib/db/nostr'
import { publishDeletionRequest } from '@/lib/nostr/deletion'
import {
  canBookmarkEvent,
  getFreshNip51ListEvent,
  isEventInBookmarkList,
  toggleGlobalBookmark,
} from '@/lib/nostr/lists'
import { buildEventReferenceValue } from '@/lib/nostr/nip21'
import { publishReaction } from '@/lib/nostr/reaction'
import { publishRepost } from '@/lib/nostr/repost'
import {
  classifySocialPublishFailure,
  recordSocialPublishFailure,
} from '@/lib/nostr/socialTelemetry'
import type { EventEngagementSummary, NostrEvent } from '@/types'
import { Kind } from '@/types'

const EMPTY_SUMMARY: EventEngagementSummary = {
  replyCount: 0,
  repostCount: 0,
  reactionCount: 0,
  likeCount: 0,
  dislikeCount: 0,
  emojiReactions: [],
  zapCount: 0,
  zapTotalMsats: 0,
  currentUserHasReposted: false,
  currentUserHasLiked: false,
  currentUserHasDisliked: false,
}

interface EventActionBarProps {
  event: NostrEvent
  className?: string
}

export function EventActionBar({ event, className = '' }: EventActionBarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser } = useApp()
  const [summary, setSummary] = useState<EventEngagementSummary>(EMPTY_SUMMARY)
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState<'like' | 'repost' | 'delete' | 'bookmark' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleted, setDeleted] = useState(false)
  const [reported, setReported] = useState(false)
  const [reportSheetOpen, setReportSheetOpen] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const [bookmarkLoading, setBookmarkLoading] = useState(false)
  const [zapSheetOpen, setZapSheetOpen] = useState(false)
  const publishingGuardRef = useRef<Set<'like' | 'repost' | 'delete' | 'bookmark'>>(new Set())

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)

    getEventEngagementSummary(event.id, currentUser?.pubkey)
      .then((nextSummary) => {
        if (controller.signal.aborted) return
        setSummary(nextSummary)
        setError(null)
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return
        setError(loadError instanceof Error ? loadError.message : 'Failed to load reactions.')
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [event.id, currentUser?.pubkey])

  useEffect(() => {
    const controller = new AbortController()

    if (!currentUser || !canBookmarkEvent(event)) {
      setBookmarked(false)
      setBookmarkLoading(false)
      return () => controller.abort()
    }

    setBookmarkLoading(true)
    getFreshNip51ListEvent(currentUser.pubkey, Kind.Bookmarks, { signal: controller.signal })
      .then((bookmarkList) => {
        if (controller.signal.aborted) return
        setBookmarked(isEventInBookmarkList(event, bookmarkList))
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setBookmarked(false)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setBookmarkLoading(false)
        }
      })

    return () => controller.abort()
  }, [currentUser?.pubkey, event])

  const refresh = async () => {
    const nextSummary = await getEventEngagementSummary(event.id, currentUser?.pubkey)
    setSummary(nextSummary)
  }

  const handleLike = async () => {
    if (publishingGuardRef.current.has('like') || summary.currentUserHasLiked) return
    publishingGuardRef.current.add('like')
    const previousSummary = summary
    setPublishing('like')
    setError(null)
    setSummary((current) => current.currentUserHasLiked
      ? current
      : {
          ...current,
          currentUserHasLiked: true,
          reactionCount: current.reactionCount + 1,
          likeCount: current.likeCount + 1,
        })
    try {
      await publishReaction(event, '+')
      await refresh()
    } catch (publishError) {
      setSummary(previousSummary)
      recordSocialPublishFailure('reaction', classifySocialPublishFailure(publishError))
      setError(publishError instanceof Error ? publishError.message : 'Failed to publish reaction.')
    } finally {
      publishingGuardRef.current.delete('like')
      setPublishing(null)
    }
  }

  const handleRepost = async () => {
    if (publishingGuardRef.current.has('repost')) return
    publishingGuardRef.current.add('repost')
    setPublishing('repost')
    setError(null)
    try {
      await publishRepost(event)
      await refresh()
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Failed to publish repost.')
    } finally {
      publishingGuardRef.current.delete('repost')
      setPublishing(null)
    }
  }

  const handleDelete = async () => {
    if (publishingGuardRef.current.has('delete')) return
    publishingGuardRef.current.add('delete')
    setPublishing('delete')
    setError(null)
    try {
      await publishDeletionRequest(event)
      setDeleted(true)
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Failed to publish deletion request.')
    } finally {
      publishingGuardRef.current.delete('delete')
      setPublishing(null)
    }
  }

  const handleBookmark = async () => {
    if (publishingGuardRef.current.has('bookmark')) return
    publishingGuardRef.current.add('bookmark')
    setPublishing('bookmark')
    setError(null)
    try {
      const result = await toggleGlobalBookmark(event)
      setBookmarked(result.bookmarked)
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Failed to update bookmarks.')
    } finally {
      publishingGuardRef.current.delete('bookmark')
      setPublishing(null)
    }
  }

  const handleQuote = () => {
    const quoteReference = buildEventReferenceValue(event)
    if (!quoteReference) {
      setError('Failed to encode the quoted event as a NIP-21 reference.')
      return
    }

    setError(null)
    navigate({
      pathname: location.pathname,
      search: buildComposeSearch(location.search, {
        quoteReference,
        replyReference: null,
      }),
    })
  }

  const handleReply = () => {
    const replyReference = buildEventReferenceValue(event)
    if (!replyReference) {
      setError('Failed to encode the reply target as a NIP-21 reference.')
      return
    }

    setError(null)
    navigate({
      pathname: location.pathname,
      search: buildComposeSearch(location.search, {
        quoteReference: null,
        replyReference,
      }),
    })
  }

  const canRepost = event.kind !== Kind.EventDeletion
  const canReply = event.kind !== Kind.EventDeletion
  const canQuote = event.kind !== Kind.EventDeletion
  const canBookmark = canBookmarkEvent(event)
  const canDelete = currentUser?.pubkey === event.pubkey && event.kind !== Kind.EventDeletion

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-[rgb(var(--color-label-secondary))]">
        <span>{summary.likeCount} like{summary.likeCount === 1 ? '' : 's'}</span>
        {summary.dislikeCount > 0 && (
          <span>{summary.dislikeCount} dislike{summary.dislikeCount === 1 ? '' : 's'}</span>
        )}
        <span>{summary.repostCount} repost{summary.repostCount === 1 ? '' : 's'}</span>
        {summary.zapCount > 0 && (
          <span>⚡ {formatZapAmount(summary.zapTotalMsats)} sats ({summary.zapCount} zap{summary.zapCount === 1 ? '' : 's'})</span>
        )}
        {summary.emojiReactions.map((reaction) => (
          <span key={reaction.key}>
            {reaction.label} {reaction.count}
          </span>
        ))}
        {loading && <span>Refreshing…</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!currentUser || summary.currentUserHasLiked || publishing !== null}
          onClick={() => void handleLike()}
          className="
            flex-1 rounded-[14px] border border-[rgb(var(--color-fill)/0.16)]
            bg-[rgb(var(--color-bg-secondary))] px-4 py-2.5
            text-[14px] font-medium text-[rgb(var(--color-label))]
            transition-opacity active:opacity-75 disabled:opacity-40
          "
        >
          {publishing === 'like' ? 'Liking…' : summary.currentUserHasLiked ? 'Liked' : 'Like'}
        </button>

        <button
          type="button"
          disabled={!currentUser || !canRepost || summary.currentUserHasReposted || publishing !== null}
          onClick={() => void handleRepost()}
          className="
            flex-1 rounded-[14px] border border-[rgb(var(--color-fill)/0.16)]
            bg-[rgb(var(--color-bg-secondary))] px-4 py-2.5
            text-[14px] font-medium text-[rgb(var(--color-label))]
            transition-opacity active:opacity-75 disabled:opacity-40
          "
        >
          {publishing === 'repost' ? 'Reposting…' : summary.currentUserHasReposted ? 'Reposted' : 'Repost'}
        </button>

        <button
          type="button"
          disabled={!currentUser || publishing !== null}
          onClick={() => {
            setReportSheetOpen(false)
            setZapSheetOpen(true)
          }}
          className="
            flex-1 rounded-[14px] border border-[rgb(var(--color-fill)/0.16)]
            bg-[rgb(var(--color-bg-secondary))] px-4 py-2.5
            text-[14px] font-medium text-[rgb(var(--color-label))]
            transition-opacity active:opacity-75 disabled:opacity-40
          "
        >
          ⚡ Zap
        </button>

        <button
          type="button"
          disabled={!currentUser || !canReply || publishing !== null}
          onClick={handleReply}
          className="
            flex-1 rounded-[14px] border border-[rgb(var(--color-fill)/0.16)]
            bg-[rgb(var(--color-bg-secondary))] px-4 py-2.5
            text-[14px] font-medium text-[rgb(var(--color-label))]
            transition-opacity active:opacity-75 disabled:opacity-40
          "
        >
          Reply
        </button>

        <button
          type="button"
          disabled={!currentUser || !canQuote || publishing !== null}
          onClick={handleQuote}
          className="
            flex-1 rounded-[14px] border border-[rgb(var(--color-fill)/0.16)]
            bg-[rgb(var(--color-bg-secondary))] px-4 py-2.5
            text-[14px] font-medium text-[rgb(var(--color-label))]
            transition-opacity active:opacity-75 disabled:opacity-40
          "
        >
          Quote
        </button>

        {canBookmark && (
          <button
            type="button"
            disabled={!currentUser || bookmarkLoading || publishing !== null}
            onClick={() => void handleBookmark()}
            className="
              flex-1 rounded-[14px] border border-[rgb(var(--color-fill)/0.16)]
              bg-[rgb(var(--color-bg-secondary))] px-4 py-2.5
              text-[14px] font-medium text-[rgb(var(--color-label))]
              transition-opacity active:opacity-75 disabled:opacity-40
            "
          >
            {publishing === 'bookmark'
              ? (bookmarked ? 'Removing…' : 'Bookmarking…')
              : bookmarked
                ? 'Bookmarked'
                : 'Bookmark'}
          </button>
        )}

        <button
          type="button"
          disabled={!currentUser || reported || publishing !== null}
          onClick={() => {
            setError(null)
            setZapSheetOpen(false)
            setReportSheetOpen(true)
          }}
          className="
            flex-1 rounded-[14px] border border-[rgb(var(--color-system-red)/0.22)]
            bg-[rgb(var(--color-system-red)/0.08)] px-4 py-2.5
            text-[14px] font-medium text-[rgb(var(--color-system-red))]
            transition-opacity active:opacity-75 disabled:opacity-40
          "
        >
          {reported ? 'Reported' : 'Report'}
        </button>

        {canDelete && (
          <button
            type="button"
            disabled={publishing !== null || deleted}
            onClick={() => void handleDelete()}
            className="
              rounded-[14px] border border-[rgb(var(--color-system-red)/0.22)]
              bg-[rgb(var(--color-system-red)/0.08)] px-4 py-2.5
              text-[14px] font-medium text-[rgb(var(--color-system-red))]
              transition-opacity active:opacity-75 disabled:opacity-40
            "
          >
            {publishing === 'delete' ? 'Deleting…' : deleted ? 'Deleted' : 'Delete'}
          </button>
        )}
      </div>

      {deleted && (
        <p className="text-[13px] text-[rgb(var(--color-label-secondary))]">
          Deletion request published. Other views will hide this event after they refresh from local state.
        </p>
      )}

      {error && (
        <p className="text-[13px] text-[rgb(var(--color-system-red))]">
          {error}
        </p>
      )}

      <ReportSheet
        open={reportSheetOpen}
        target={{ type: 'event', event }}
        onClose={() => setReportSheetOpen(false)}
        onPublished={() => {
          setReported(true)
          setError(null)
        }}
      />

      <ZapSheet
        open={zapSheetOpen}
        recipientPubkey={event.pubkey}
        targetEvent={event}
        onClose={() => setZapSheetOpen(false)}
        onZapped={() => void refresh()}
      />
    </div>
  )
}
