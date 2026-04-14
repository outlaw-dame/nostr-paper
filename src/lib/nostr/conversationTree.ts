import { parseCommentEvent, parseTextNoteReply } from '@/lib/nostr/thread'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

export interface ReplyTreeNode {
  event: NostrEvent
  detached: boolean
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

function getReplyRootEventId(reply: NostrEvent): string | null {
  if (reply.kind === Kind.ShortNote) {
    return parseTextNoteReply(reply)?.rootEventId ?? null
  }
  if (reply.kind === Kind.Comment) {
    return parseCommentEvent(reply)?.rootEventId ?? null
  }
  return null
}

function isLikelyTopLevelReply(reply: NostrEvent, parentId: string): boolean {
  const rootId = getReplyRootEventId(reply)
  return Boolean(rootId && rootId === parentId)
}

function sortTree(nodes: ReplyTreeNode[]): ReplyTreeNode[] {
  return [...nodes]
    .sort((a, b) => (
      a.event.created_at - b.event.created_at || a.event.id.localeCompare(b.event.id)
    ))
    .map((node) => ({
      event: node.event,
      detached: node.detached,
      children: sortTree(node.children),
    }))
}

function introducesParentCycle(
  eventId: string,
  parentId: string,
  parentByEventId: Map<string, string>,
): boolean {
  const seen = new Set<string>([eventId])
  let cursor: string | undefined = parentId

  while (cursor) {
    if (seen.has(cursor)) return true
    seen.add(cursor)
    cursor = parentByEventId.get(cursor)
  }

  return false
}

export function buildReplyTree(replies: NostrEvent[]): ReplyTreeNode[] {
  const sortedReplies = sortChronologically(replies)
  const byId = new Map<string, ReplyTreeNode>()
  const parentByEventId = new Map<string, string>()
  const detachedRootIds = new Set<string>()

  for (const reply of sortedReplies) {
    byId.set(reply.id, { event: reply, detached: false, children: [] })
    const parentId = getReplyParentEventId(reply)
    if (parentId) {
      parentByEventId.set(reply.id, parentId)
    }
  }

  const rootIds = new Set<string>()

  for (const reply of sortedReplies) {
    const node = byId.get(reply.id)
    if (!node) continue

    const parentId = parentByEventId.get(reply.id)
    if (!parentId) {
      rootIds.add(reply.id)
      continue
    }

    if (parentId === reply.id) {
      rootIds.add(reply.id)
      detachedRootIds.add(reply.id)
      continue
    }

    const parentNode = byId.get(parentId)
    if (!parentNode) {
      rootIds.add(reply.id)
      if (!isLikelyTopLevelReply(reply, parentId)) {
        detachedRootIds.add(reply.id)
      }
      continue
    }

    if (introducesParentCycle(reply.id, parentId, parentByEventId)) {
      rootIds.add(reply.id)
      detachedRootIds.add(reply.id)
      continue
    }

    parentNode.children.push(node)
  }

  const roots: ReplyTreeNode[] = sortedReplies
    .map((event) => byId.get(event.id))
    .filter((node): node is ReplyTreeNode => Boolean(node && rootIds.has(node.event.id)))
    .map((node) => ({
      event: node.event,
      detached: detachedRootIds.has(node.event.id),
      children: node.children,
    }))

  return sortTree(roots)
}

export function countDescendants(node: ReplyTreeNode): number {
  return node.children.reduce((acc, child) => acc + 1 + countDescendants(child), 0)
}

export function collectDefaultCollapsedIds(
  nodes: ReplyTreeNode[],
  depth = 0,
  set = new Set<string>(),
): Set<string> {
  for (const node of nodes) {
    if (node.children.length > 0 && depth >= 1) {
      set.add(node.event.id)
    }
    collectDefaultCollapsedIds(node.children, depth + 1, set)
  }
  return set
}