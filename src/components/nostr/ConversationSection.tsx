import { EventPreviewCard } from '@/components/nostr/EventPreviewCard'
import { useConversationThread } from '@/hooks/useConversationThread'
import {
  getConversationRootReference,
  parseCommentEvent,
  parseTextNoteReply,
  parseThreadEvent,
} from '@/lib/nostr/thread'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

interface ConversationSectionProps {
  event: NostrEvent
  className?: string
}

export function ConversationSection({
  event,
  className = '',
}: ConversationSectionProps) {
  const { rootEvent, replies, loading, rootLoading, error } = useConversationThread(event)
  const rootReference = getConversationRootReference(event)
  const noteReply = parseTextNoteReply(event)
  const comment = parseCommentEvent(event)
  const thread = parseThreadEvent(event)

  const isRootEvent = (
    (event.kind === Kind.ShortNote && !noteReply) ||
    event.kind === Kind.Thread ||
    (
      event.kind !== Kind.Comment &&
      event.kind !== Kind.ShortNote &&
      rootReference !== null &&
      (
        rootReference.eventId === event.id ||
        rootReference.address !== undefined
      )
    )
  )

  const label = event.kind === Kind.ShortNote
    ? 'Replies'
    : event.kind === Kind.Thread || comment?.rootKind === String(Kind.Thread)
      ? 'Thread Replies'
      : 'Comments'
  const showRootBlock = !isRootEvent
  const showRepliesBlock = replies.length > 0 || loading || error

  if (
    !thread &&
    event.kind !== Kind.ShortNote &&
    event.kind !== Kind.Comment &&
    replies.length === 0 &&
    !loading &&
    !rootLoading &&
    !error
  ) {
    return null
  }

  if (!showRootBlock && !showRepliesBlock) {
    return null
  }

  return (
    <section className={`space-y-3 ${className}`}>
      {showRootBlock && (
        <div className="space-y-2">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
            In Conversation
          </p>
          {rootEvent ? (
            <EventPreviewCard event={rootEvent} compact linked />
          ) : (
            <div className="rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3">
              <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
                {rootLoading ? 'Loading conversation root…' : 'Conversation root unavailable.'}
              </p>
            </div>
          )}
        </div>
      )}

      {showRepliesBlock && (
        <div className="space-y-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
            {label}
          </p>

          {replies.map((reply) => (
            <EventPreviewCard key={reply.id} event={reply} compact />
          ))}

          {loading && (
            <div className="rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3">
              <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
                Loading conversation…
              </p>
            </div>
          )}

          {error && !loading && (
            <div className="rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3">
              <p className="text-[14px] text-[rgb(var(--color-system-red))]">
                {error}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
