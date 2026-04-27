import type { NostrEvent } from '@/types'

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'have', 'your', 'you', 'are', 'was', 'were',
  'will', 'they', 'their', 'about', 'what', 'when', 'where', 'which', 'there', 'would', 'could',
  'should', 'into', 'onto', 'over', 'under', 'just', 'than', 'then', 'them', 'been', 'being', 'ours',
  'ourselves', 'hers', 'him', 'his', 'its', 'it', 'to', 'of', 'in', 'on', 'at', 'as', 'an', 'a', 'or',
])

function tokenize(content: string): string[] {
  return content
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
}

function lexicalSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a))
  const setB = new Set(tokenize(b))
  if (setA.size === 0 || setB.size === 0) return 0

  let overlap = 0
  for (const token of setA) {
    if (setB.has(token)) overlap += 1
  }

  const union = setA.size + setB.size - overlap
  return union > 0 ? overlap / union : 0
}

function getTagCount(event: NostrEvent, tagName: string): number {
  return event.tags.filter((tag) => tag[0] === tagName).length
}

export function getThreadReplyRelevanceScore(root: NostrEvent, reply: NostrEvent, now = Date.now() / 1000): number {
  const semantic = lexicalSimilarity(root.content, reply.content)
  const mentions = getTagCount(reply, 'p') + getTagCount(reply, 'e')
  const mentionScore = Math.min(1, mentions / 4)
  const sameAuthor = root.pubkey === reply.pubkey ? 0.15 : 0

  const ageHours = Math.max(0, (now - reply.created_at) / 3600)
  const freshness = Math.exp(-ageHours / 72) // 3-day half-life-ish

  // Weighted blend. Semantic similarity dominates.
  return (semantic * 0.55) + (mentionScore * 0.2) + (freshness * 0.1) + sameAuthor
}

/**
 * Rank replies by semantic relevance while preserving deterministic fallback order.
 */
export function rankThreadReplies(root: NostrEvent, replies: NostrEvent[]): NostrEvent[] {
  const referenceNow = Math.max(root.created_at, ...replies.map((reply) => reply.created_at))
  const scored = replies.map((reply) => ({
    reply,
    score: getThreadReplyRelevanceScore(root, reply, referenceNow),
  }))

  return scored
    .sort((a, b) => (
      b.score - a.score
      || a.reply.created_at - b.reply.created_at
      || a.reply.id.localeCompare(b.reply.id)
    ))
    .map((entry) => entry.reply)
}
