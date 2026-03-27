import { describe, expect, it } from 'vitest'
import { collectRepostCarouselItems } from './reposts'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

function makeEvent(id: string, pubkey: string, kind: number, createdAt: number, content = '', tags: string[][] = []): NostrEvent {
  return {
    id,
    pubkey,
    created_at: createdAt,
    kind,
    tags,
    content,
    sig: 'f'.repeat(128),
  }
}

function makeRepost(id: string, pubkey: string, target: NostrEvent, createdAt: number): NostrEvent {
  return makeEvent(
    id,
    pubkey,
    Kind.Repost,
    createdAt,
    JSON.stringify(target),
    [
      ['e', target.id, '', '', target.pubkey],
      ['p', target.pubkey],
    ],
  )
}

describe('collectRepostCarouselItems', () => {
  it('keeps only targets with at least three unique reposts', () => {
    const targetA = makeEvent('a'.repeat(64), 'b'.repeat(64), Kind.ShortNote, 100, 'Target A')
    const targetB = makeEvent('c'.repeat(64), 'd'.repeat(64), Kind.ShortNote, 100, 'Target B')

    const events: NostrEvent[] = [
      targetA,
      targetB,
      makeRepost('1'.repeat(64), 'e'.repeat(64), targetA, 200),
      makeRepost('2'.repeat(64), 'f'.repeat(64), targetA, 210),
      makeRepost('3'.repeat(64), '0'.repeat(64), targetA, 220),
      makeRepost('4'.repeat(64), '1'.repeat(64), targetB, 230),
      makeRepost('5'.repeat(64), '2'.repeat(64), targetB, 240),
    ]

    const items = collectRepostCarouselItems(events, { minReposts: 3 })

    expect(items).toHaveLength(1)
    expect(items[0]?.targetEventId).toBe(targetA.id)
    expect(items[0]?.repostCount).toBe(3)
  })

  it('dedupes repeated reposts by the same pubkey', () => {
    const target = makeEvent('9'.repeat(64), '8'.repeat(64), Kind.ShortNote, 100, 'Target')

    const events: NostrEvent[] = [
      target,
      makeRepost('a'.repeat(64), '7'.repeat(64), target, 200),
      makeRepost('b'.repeat(64), '7'.repeat(64), target, 210),
      makeRepost('c'.repeat(64), '6'.repeat(64), target, 220),
      makeRepost('d'.repeat(64), '5'.repeat(64), target, 230),
    ]

    const items = collectRepostCarouselItems(events, { minReposts: 3 })

    expect(items).toHaveLength(1)
    expect(items[0]?.repostCount).toBe(3)
  })
})
