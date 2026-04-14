import { useEffect, useMemo, useState } from 'react'
import { EventPreviewCard } from '@/components/nostr/EventPreviewCard'
import { useConversationThread } from '@/hooks/useConversationThread'
import {
  buildReplyTree,
  collectDefaultCollapsedIds,
  countDescendants,
  type ReplyTreeNode,
} from '@/lib/nostr/conversationTree'
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

function ReplyTreeItem({
  node,
  depth,
  collapsedIds,
  onToggleCollapsed,
}: {
  node: ReplyTreeNode
  depth: number
  collapsedIds: Set<string>
  onToggleCollapsed: (id: string) => void
}) {
  const hasChildren = node.children.length > 0
  const collapsed = hasChildren && collapsedIds.has(node.event.id)
  const totalNestedReplies = hasChildren ? countDescendants(node) : 0

  return (
    <div className={depth > 0 ? 'ml-4 border-l border-[rgb(var(--color-fill)/0.14)] pl-3' : ''}>
      <EventPreviewCard event={node.event} compact />
      {node.detached && (
        <div className="mt-1.5">
          <span
            title="Detached reply"
            aria-label="Detached reply"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] text-[rgb(var(--color-label-tertiary))]"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
              <circle cx="5" cy="5" r="1.5" fill="currentColor" />
            </svg>
          </span>
        </div>
      )}

      {hasChildren && (
        <div className="mt-2 space-y-2">
          <button
            type="button"
            onClick={() => onToggleCollapsed(node.event.id)}
            className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] px-2.5 py-1 text-[12px] font-medium text-[rgb(var(--color-label-secondary))] transition-opacity active:opacity-70"
          >
            <span>{collapsed ? 'Show' : 'Hide'}</span>
            <span>{totalNestedReplies} {totalNestedReplies === 1 ? 'reply' : 'replies'}</span>
          </button>

          {!collapsed && (
            <div className="space-y-2">
              {node.children.map((child) => (
                <ReplyTreeItem
                  key={child.event.id}
                  node={child}
                  depth={depth + 1}
                  collapsedIds={collapsedIds}
                  onToggleCollapsed={onToggleCollapsed}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
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
  const replyTree = useMemo(() => buildReplyTree(replies), [replies])
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setCollapsedIds(collectDefaultCollapsedIds(replyTree))
  }, [replyTree])

  const hasNestedReplies = useMemo(
    () => replies.some((reply) => {
      const parentId = reply.kind === Kind.ShortNote
        ? parseTextNoteReply(reply)?.parentEventId
        : parseCommentEvent(reply)?.parentEventId
      return Boolean(parentId && reply.id !== parentId && replies.some((candidate) => candidate.id === parentId))
    }),
    [replies],
  )

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
  const showRepliesBlock = replyTree.length > 0 || loading || error

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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              {label}
            </p>
            {hasNestedReplies && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCollapsedIds(new Set())}
                  className="text-[12px] font-medium text-[rgb(var(--color-label-secondary))] active:opacity-70"
                >
                  Expand all
                </button>
                <button
                  type="button"
                  onClick={() => setCollapsedIds(collectDefaultCollapsedIds(replyTree))}
                  className="text-[12px] font-medium text-[rgb(var(--color-label-secondary))] active:opacity-70"
                >
                  Collapse deep replies
                </button>
              </div>
            )}
          </div>

          {replyTree.map((node) => (
            <ReplyTreeItem
              key={node.event.id}
              node={node}
              depth={0}
              collapsedIds={collapsedIds}
              onToggleCollapsed={(id) => {
                setCollapsedIds((previous) => {
                  const next = new Set(previous)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                })
              }}
            />
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
