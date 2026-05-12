import { useEffect, useMemo, useState } from 'react'
import { EventPreviewCard } from '@/components/nostr/EventPreviewCard'
import { useConversationThread } from '@/hooks/useConversationThread'
import {
  buildReplyTree,
  collectDefaultCompressedBranchIds,
  collectDefaultCollapsedIds,
  countDescendants,
  getCompressedBranchPreview,
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
  section?: 'all' | 'root' | 'replies'
}

function ReplyTreeItem({
  node,
  depth,
  collapsedIds,
  compressedBranchIds,
  onToggleCollapsed,
  onToggleCompressedBranch,
  parentPubkey,
}: {
  node: ReplyTreeNode
  depth: number
  collapsedIds: Set<string>
  compressedBranchIds: Set<string>
  onToggleCollapsed: (id: string) => void
  onToggleCompressedBranch: (id: string) => void
  parentPubkey?: string
}) {
  const hasChildren = node.children.length > 0
  const collapsed = hasChildren && collapsedIds.has(node.event.id)
  const totalNestedReplies = hasChildren ? countDescendants(node) : 0
  const isContinuation = depth > 0 && parentPubkey === node.event.pubkey
  const compressedPreview = getCompressedBranchPreview(node)
  const isBranchCompressed = Boolean(compressedPreview && compressedBranchIds.has(node.event.id))
  const renderedChildren = isBranchCompressed && compressedPreview
    ? [compressedPreview.tail]
    : node.children

  return (
    <div className={depth > 0 ? 'ml-4 border-l border-[rgb(var(--color-fill)/0.14)] pl-3' : ''}>
      {isContinuation && (
        <p className="mb-1 ml-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-tertiary))]">
          Thread continuation
        </p>
      )}
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
          {compressedPreview && (
            <button
              type="button"
              onClick={() => onToggleCompressedBranch(node.event.id)}
              className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] px-2.5 py-1 text-[12px] font-medium text-[rgb(var(--color-label-secondary))] transition-opacity active:opacity-70"
            >
              <span>{isBranchCompressed ? 'Show' : 'Hide'} in-between replies</span>
              <span>{compressedPreview.hiddenCount}</span>
            </button>
          )}

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
              {renderedChildren.map((child) => (
                <ReplyTreeItem
                  key={child.event.id}
                  node={child}
                  depth={depth + 1}
                  collapsedIds={collapsedIds}
                  compressedBranchIds={compressedBranchIds}
                  onToggleCollapsed={onToggleCollapsed}
                  onToggleCompressedBranch={onToggleCompressedBranch}
                  parentPubkey={node.event.pubkey}
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
  section = 'all',
}: ConversationSectionProps) {
  const { rootEvent, replies, loading, rootLoading, error, threadingMode } = useConversationThread(event)
  const rootReference = getConversationRootReference(event)
  const noteReply = parseTextNoteReply(event)
  const comment = parseCommentEvent(event)
  const thread = parseThreadEvent(event)
  const replyTree = useMemo(
    () => buildReplyTree(replies, { anchorEventId: event.id }),
    [event.id, replies],
  )
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [compressedBranchIds, setCompressedBranchIds] = useState<Set<string>>(new Set())
  const [otherBranchesExpanded, setOtherBranchesExpanded] = useState(false)

  useEffect(() => {
    setCollapsedIds(collectDefaultCollapsedIds(replyTree))
    setCompressedBranchIds(collectDefaultCompressedBranchIds(replyTree))
    setOtherBranchesExpanded(false)
  }, [replyTree])

  const toggleCollapsed = (id: string) => {
    setCollapsedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleCompressedBranch = (id: string) => {
    setCompressedBranchIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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

  const anchoredRoots = useMemo(() => {
    if (isRootEvent) return []

    return replyTree.filter((node) => {
      const parentId = node.event.kind === Kind.ShortNote
        ? parseTextNoteReply(node.event)?.parentEventId
        : parseCommentEvent(node.event)?.parentEventId
      return parentId === event.id
    })
  }, [event.id, isRootEvent, replyTree])

  const otherBranchRoots = useMemo(() => {
    if (isRootEvent) return []
    const anchoredIds = new Set(anchoredRoots.map((node) => node.event.id))
    return replyTree.filter((node) => !anchoredIds.has(node.event.id))
  }, [anchoredRoots, isRootEvent, replyTree])

  const primaryBranchRoots = useMemo(() => {
    if (isRootEvent) return replyTree
    return anchoredRoots.length > 0 ? anchoredRoots : replyTree
  }, [anchoredRoots, isRootEvent, replyTree])

  const visibleOtherBranchRoots = useMemo(
    () => (otherBranchesExpanded ? otherBranchRoots : otherBranchRoots.slice(0, 3)),
    [otherBranchRoots, otherBranchesExpanded],
  )

  const hasNestedReplies = useMemo(
    () => replies.some((reply) => {
      const parentId = reply.kind === Kind.ShortNote
        ? parseTextNoteReply(reply)?.parentEventId
        : parseCommentEvent(reply)?.parentEventId
      return Boolean(parentId && reply.id !== parentId && replies.some((candidate) => candidate.id === parentId))
    }),
    [replies],
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

  if (section === 'all' && !showRootBlock && !showRepliesBlock) {
    return null
  }
  if (section === 'root' && (!showRootBlock || (!rootEvent && !rootLoading))) return null
  if (section === 'replies' && !showRepliesBlock) return null

  return (
    <section className={`space-y-3 ${className}`}>
      {(section === 'all' || section === 'root') && showRootBlock && (rootEvent || rootLoading) && (
        <div>
          {rootEvent ? (
            <EventPreviewCard event={rootEvent} compact linked />
          ) : (
            <div className="h-[72px] animate-pulse rounded-[18px] bg-[rgb(var(--color-fill)/0.07)]" />
          )}
        </div>
      )}

      {(section === 'all' || section === 'replies') && showRepliesBlock && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                {label}
              </p>
              {threadingMode !== 'standard' && (
                <span
                  className="inline-flex items-center rounded-full border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg-secondary))] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-[rgb(var(--color-label-tertiary))]"
                  title={threadingMode === 'numbered'
                    ? 'Built with numbered thread reconstruction'
                    : 'Built with mixed NIP-10 and numbered thread reconstruction'}
                >
                  {threadingMode === 'numbered' ? 'Numbered Thread' : 'Mixed Threading'}
                </span>
              )}
            </div>
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

          {primaryBranchRoots.map((node) => (
            <ReplyTreeItem
              key={node.event.id}
              node={node}
              depth={0}
              collapsedIds={collapsedIds}
              compressedBranchIds={compressedBranchIds}
              onToggleCollapsed={toggleCollapsed}
              onToggleCompressedBranch={toggleCompressedBranch}
              parentPubkey={event.pubkey}
            />
          ))}

          {!isRootEvent && anchoredRoots.length > 0 && otherBranchRoots.length > 0 && (
            <div className="space-y-2 rounded-[14px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] p-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                Other Branches ({otherBranchRoots.length})
              </p>
              <p className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
                Replies in the same conversation that branch away from this reply.
              </p>
              <div className="space-y-2">
                {visibleOtherBranchRoots.map((node) => (
                  <ReplyTreeItem
                    key={`other-${node.event.id}`}
                    node={node}
                    depth={0}
                    collapsedIds={collapsedIds}
                    compressedBranchIds={compressedBranchIds}
                    onToggleCollapsed={toggleCollapsed}
                    onToggleCompressedBranch={toggleCompressedBranch}
                    parentPubkey={event.pubkey}
                  />
                ))}
                {otherBranchRoots.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setOtherBranchesExpanded((previous) => !previous)}
                    className="text-[12px] font-medium text-[rgb(var(--color-label-secondary))] active:opacity-70"
                  >
                    {otherBranchesExpanded
                      ? 'Show fewer branches'
                      : `Show ${otherBranchRoots.length - visibleOtherBranchRoots.length} more branches`}
                  </button>
                )}
              </div>
            </div>
          )}

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
