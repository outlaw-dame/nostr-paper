import { parseDeletionEvent } from './deletion'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

function baseEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: Kind.EventDeletion,
    tags: [
      ['e', 'c'.repeat(64)],
    ],
    content: '',
    sig: 'd'.repeat(128),
    ...overrides,
  }
}

describe('parseDeletionEvent', () => {
  it('parses e-tags, same-author a-tags, and declared kinds', () => {
    const parsed = parseDeletionEvent(baseEvent({
      tags: [
        ['e', 'c'.repeat(64)],
        ['e', 'c'.repeat(64)],
        ['a', `30023:${'b'.repeat(64)}:draft-post`],
        ['a', `30023:${'f'.repeat(64)}:foreign-post`],
        ['k', '1'],
        ['k', '30023'],
      ],
      content: '<b>published by accident</b>',
    }))

    expect(parsed).not.toBeNull()
    expect(parsed?.eventIds).toEqual(['c'.repeat(64)])
    expect(parsed?.coordinates).toEqual([`30023:${'b'.repeat(64)}:draft-post`])
    expect(parsed?.kinds).toEqual([1, 30023])
    expect(parsed?.reason).toBe('published by accident')
  })

  it('rejects deletion events without any valid targets', () => {
    expect(parseDeletionEvent(baseEvent({
      tags: [['e', 'not-hex']],
    }))).toBeNull()
  })
})
