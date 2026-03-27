import { describe, expect, it, vi } from 'vitest'
import type { NostrEvent, NostrFilter } from '@/types'
import { Kind } from '@/types'
import { getSelfThreadIndex } from './threadIndex'

const queryEventsMock = vi.fn<(filter: NostrFilter) => Promise<NostrEvent[]>>()

vi.mock('@/lib/db/nostr', () => ({
  queryEvents: (filter: NostrFilter) => queryEventsMock(filter),
}))

function event(overrides: Partial<NostrEvent>): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: Kind.ShortNote,
    tags: [],
    content: 'note',
    sig: 'c'.repeat(128),
    ...overrides,
  }
}

describe('getSelfThreadIndex', () => {
  it('returns chronological self-thread indices and reuses cache', async () => {
    const root = event({
      id: '1'.repeat(64),
      pubkey: 'a'.repeat(64),
      created_at: 100,
      tags: [],
    })

    const replyOne = event({
      id: '2'.repeat(64),
      pubkey: root.pubkey,
      created_at: 110,
      tags: [
        ['e', root.id, '', 'root', root.pubkey],
        ['e', root.id, '', 'reply', root.pubkey],
        ['p', root.pubkey],
      ],
    })

    const replyTwo = event({
      id: '3'.repeat(64),
      pubkey: root.pubkey,
      created_at: 120,
      tags: [
        ['e', root.id, '', 'root', root.pubkey],
        ['e', replyOne.id, '', 'reply', root.pubkey],
        ['p', root.pubkey],
      ],
    })

    const otherAuthorReply = event({
      id: '4'.repeat(64),
      pubkey: 'f'.repeat(64),
      created_at: 125,
      tags: [
        ['e', root.id, '', 'root', root.pubkey],
        ['e', root.id, '', 'reply', root.pubkey],
        ['p', root.pubkey],
      ],
    })

    queryEventsMock.mockImplementation(async (filter) => {
      if (filter.ids?.includes(root.id)) {
        return [root]
      }
      if (filter['#e']?.includes(root.id)) {
        return [replyTwo, replyOne, otherAuthorReply]
      }
      return []
    })

    const first = await getSelfThreadIndex(replyTwo)
    const second = await getSelfThreadIndex(replyOne)
    const third = await getSelfThreadIndex(root)

    expect(first).toEqual({ index: 3, total: 3, rootEventId: root.id })
    expect(second).toEqual({ index: 2, total: 3, rootEventId: root.id })
    expect(third).toEqual({ index: 1, total: 3, rootEventId: root.id })
    expect(queryEventsMock).toHaveBeenCalledTimes(2)
  })
})
