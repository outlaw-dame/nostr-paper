import { useEffect, useMemo, useState } from 'react'
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

interface ReplyTreeNode {
  event: NostrEvent
  children: ReplyTreeNode[]
}

function sortChronologically(events: NostrEvent[]): NostrEvent[] {
  return [...events].sort((a, b) => (
    a.created_at - b.created_at || a.id.localeCompare(b.id)
  ))
}

function getReplyParentEventId(reply: NostrEvent): string | null {
  if (reply.kind === Kind.ShortNote) {
    return parseTextNoteReply(reply)?.parentEventId ?? null
  }
  if (reply.kind === Kind.Comment) {
    return parseCommentEvent(reply)?.parentEventId ?? null
  }
  return null
}

function sortTree(nodes: ReplyTreeNode[]): ReplyTreeNode[] {
  return [...nodes]
    .sort((a, b) => (
      a.event.created_at - b.event.created_at || a.event.id.localeCompare(b.event.id)
    ))
    .map((node) => ({
      event: node.event,
      children: sortTree(node.children),
    }))
}

function buildReplyTree(replies: NostrEvent[]): ReplyTreeNode[] {
  const sortedReplies = sortChronologically(replies)
  const byId = new Map<string, ReplyTreeNode>()
  for (const reply of sortedReplies) {
    byId.set(reply.id, { event: reply, children: [] })
  }

  const roots: ReplyTreeNode[] = []
  for (const reply of sortedReplies) {
    const node = byId.get(reply.id)
    if (!node) continue

    const parentId = getReplyParentEventId(reply)
    const parentNode = parentId ? byId.get(parentId) : undefined
    if (!parentNode || parentId === reply.id) {
      roots.push(node)
      continue
    }

    parentNode.children.push(node)
  }

  return sortTree(roots)
}

function countDescendants(node: ReplyTreeNode): number {
  return node.children.reduce((acc, child) => acc + 1 + countDescendants(child), 0)
}

function collectDefaultCollapsedIds(nodes: ReplyTreeNode[], depth = 0, set = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.children.length > 0 && depth >= 1) {
      set.add(node.event.id)
    }
    collectDefaultCollapsedIds(node.children, depth + 1, set)
  }
  return set
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
      const parentId = getReplyParentEventId(reply)
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
