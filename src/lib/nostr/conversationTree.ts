import { parseCommentEvent, parseTextNoteReply } from '@/lib/nostr/thread'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

export interface ReplyTreeNode {
  event: NostrEvent
  detached: boolean
  children: ReplyTreeNode[]
}

export interface CompressedBranchPreview {
  tail: ReplyTreeNode
  hiddenCount: number
}

interface BuildReplyTreeOptions {
  anchorEventId?: string
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

export function buildReplyTree(
  replies: NostrEvent[],
  options: BuildReplyTreeOptions = {},
): ReplyTreeNode[] {
  const sortedReplies = sortChronologically(replies)
  const { anchorEventId } = options
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
      if (parentId !== anchorEventId && !isLikelyTopLevelReply(reply, parentId)) {
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

  const sortedRoots = sortTree(roots)
  if (!anchorEventId) return sortedRoots

  return [...sortedRoots].sort((a, b) => {
    const aAnchored = parentByEventId.get(a.event.id) === anchorEventId
    const bAnchored = parentByEventId.get(b.event.id) === anchorEventId
    if (aAnchored !== bAnchored) return aAnchored ? -1 : 1
    return a.event.created_at - b.event.created_at || a.event.id.localeCompare(b.event.id)
  })
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

function collectLinearChildChain(node: ReplyTreeNode): ReplyTreeNode[] {
  if (node.children.length !== 1) return []

  const chain: ReplyTreeNode[] = []
  let cursor: ReplyTreeNode | null = node.children[0] ?? null

  while (cursor) {
    chain.push(cursor)
    if (cursor.children.length !== 1) break
    cursor = cursor.children[0] ?? null
  }

  return chain
}

export function getCompressedBranchPreview(
  node: ReplyTreeNode,
  threshold = 4,
): CompressedBranchPreview | null {
  const normalizedThreshold = Math.max(1, Math.floor(Number.isFinite(threshold) ? threshold : 4))
  const chain = collectLinearChildChain(node)
  if (chain.length <= normalizedThreshold) return null

  const tail = chain[chain.length - 1]
  if (!tail) return null

  return {
    tail,
    hiddenCount: Math.max(1, chain.length - 1),
  }
}

export function collectDefaultCompressedBranchIds(
  nodes: ReplyTreeNode[],
  threshold = 4,
  set = new Set<string>(),
): Set<string> {
  const normalizedThreshold = Math.max(1, Math.floor(Number.isFinite(threshold) ? threshold : 4))
  for (const node of nodes) {
    const preview = getCompressedBranchPreview(node, normalizedThreshold)
    if (preview) {
      set.add(node.event.id)
    }
    collectDefaultCompressedBranchIds(node.children, normalizedThreshold, set)
  }
  return set
}
