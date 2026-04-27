import { describe, expect, it } from 'vitest'
import { rankThreadReplies, getThreadReplyRelevanceScore } from './threadRelevance'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

function baseEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: Kind.ShortNote,
    tags: [],
    content: '',
    sig: 'c'.repeat(128),
    ...overrides,
  }
}

describe('thread relevance scoring', () => {
  it('scores semantically related replies higher than off-topic replies', () => {
    const root = baseEvent({ content: 'Nostr relay latency optimization using Thompson sampling and retries' })

    const related = baseEvent({
      id: 'd'.repeat(64),
      content: 'Relay latency optimization with retries improved query speed',
      created_at: root.created_at + 10,
    })

    const offTopic = baseEvent({
      id: 'e'.repeat(64),
      content: 'My banana bread recipe is finally perfect today',
      created_at: root.created_at + 20,
    })

    const relatedScore = getThreadReplyRelevanceScore(root, related, root.created_at + 30)
    const offTopicScore = getThreadReplyRelevanceScore(root, offTopic, root.created_at + 30)

    expect(relatedScore).toBeGreaterThan(offTopicScore)
  })

  it('ranks related replies ahead of unrelated ones', () => {
    const root = baseEvent({ content: 'NIP-94 metadata tags and media URL parsing' })

    const replies = [
      baseEvent({
        id: 'f'.repeat(64),
        content: 'Completely unrelated comment about weather',
        created_at: root.created_at + 15,
      }),
      baseEvent({
        id: 'g'.repeat(64),
        content: 'NIP-94 media metadata parsing for url m x tags',
        created_at: root.created_at + 30,
      }),
    ]

    const ranked = rankThreadReplies(root, replies)
    expect(ranked[0]?.id).toBe('g'.repeat(64))
  })
})
