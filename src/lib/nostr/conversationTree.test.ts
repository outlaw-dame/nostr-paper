import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import {
  buildReplyTree,
  collectDefaultCompressedBranchIds,
  getCompressedBranchPreview,
} from './conversationTree'
import type { NostrEvent, UnsignedEvent } from '@/types'
import { Kind } from '@/types'

function signEvent(event: Omit<UnsignedEvent, 'pubkey'> & { pubkey?: string }): NostrEvent {
  const secretKey = generateSecretKey()
  return finalizeEvent({
    pubkey: 'f'.repeat(64),
    ...event,
  }, secretKey) as NostrEvent
}

describe('buildReplyTree', () => {
  it('builds nested tree for normal reply chains', () => {
    const rootId = '1'.repeat(64)
    const replyA = signEvent({
      kind: Kind.ShortNote,
      created_at: 1,
      tags: [['e', rootId, '', 'root']],
      content: 'A',
    })
    const replyB = signEvent({
      kind: Kind.ShortNote,
      created_at: 2,
      tags: [
        ['e', rootId, '', 'root'],
        ['e', replyA.id, '', 'reply'],
      ],
      content: 'B',
    })

    const tree = buildReplyTree([replyB, replyA])

    expect(tree).toHaveLength(1)
    expect(tree[0]?.event.id).toBe(replyA.id)
    expect(tree[0]?.detached).toBe(false)
    expect(tree[0]?.children.map((child) => child.event.id)).toEqual([replyB.id])
  })

  it('treats orphaned replies as roots', () => {
    const orphan = signEvent({
      kind: Kind.ShortNote,
      created_at: 1,
      tags: [
        ['e', '1'.repeat(64), '', 'root'],
        ['e', '2'.repeat(64), '', 'reply'],
      ],
      content: 'orphan',
    })

    const tree = buildReplyTree([orphan])

    expect(tree).toHaveLength(1)
    expect(tree[0]?.event.id).toBe(orphan.id)
    expect(tree[0]?.detached).toBe(true)
  })

  it('keeps normal top-level replies attached when parent points to the conversation root id', () => {
    const rootId = '1'.repeat(64)
    const topLevel = signEvent({
      kind: Kind.ShortNote,
      created_at: 1,
      tags: [['e', rootId, '', 'root']],
      content: 'top-level',
    })

    const tree = buildReplyTree([topLevel])

    expect(tree).toHaveLength(1)
    expect(tree[0]?.event.id).toBe(topLevel.id)
    expect(tree[0]?.detached).toBe(false)
  })

  it('breaks parent cycles by promoting cyclical nodes to roots', () => {
    const rootId = '1'.repeat(64)
    const a = signEvent({
      kind: Kind.ShortNote,
      created_at: 1,
      tags: [
        ['e', rootId, '', 'root'],
        ['e', 'b'.repeat(64), '', 'reply'],
      ],
      content: 'A',
    })
    const b = signEvent({
      kind: Kind.ShortNote,
      created_at: 2,
      tags: [
        ['e', rootId, '', 'root'],
        ['e', a.id, '', 'reply'],
      ],
      content: 'B',
    })

    const aWithCycleParent = {
      ...a,
      tags: [
        ['e', rootId, '', 'root'],
        ['e', b.id, '', 'reply'],
      ],
    } as NostrEvent

    const tree = buildReplyTree([aWithCycleParent, b])

    expect(tree).toHaveLength(2)
    expect(tree.map((node) => node.event.id).sort()).toEqual([a.id, b.id].sort())
    expect(tree.every((node) => node.detached)).toBe(true)
  })

  it('creates compressed preview for long single-child chains', () => {
    const rootId = '1'.repeat(64)
    const a = signEvent({
      kind: Kind.ShortNote,
      created_at: 1,
      tags: [['e', rootId, '', 'root']],
      content: 'a',
    })
    const b = signEvent({
      kind: Kind.ShortNote,
      created_at: 2,
      tags: [['e', rootId, '', 'root'], ['e', a.id, '', 'reply']],
      content: 'b',
    })
    const c = signEvent({
      kind: Kind.ShortNote,
      created_at: 3,
      tags: [['e', rootId, '', 'root'], ['e', b.id, '', 'reply']],
      content: 'c',
    })
    const d = signEvent({
      kind: Kind.ShortNote,
      created_at: 4,
      tags: [['e', rootId, '', 'root'], ['e', c.id, '', 'reply']],
      content: 'd',
    })
    const e = signEvent({
      kind: Kind.ShortNote,
      created_at: 5,
      tags: [['e', rootId, '', 'root'], ['e', d.id, '', 'reply']],
      content: 'e',
    })

    const tree = buildReplyTree([a, b, c, d, e])
    const rootNode = tree[0]
    expect(rootNode).toBeDefined()
    if (!rootNode) return

    const preview = getCompressedBranchPreview(rootNode, 3)
    expect(preview).toBeTruthy()
    expect(preview?.tail.event.id).toBe(e.id)
    expect(preview?.hiddenCount).toBe(3)
  })

  it('collects compressed ids for nodes with deep linear chains only', () => {
    const rootId = '1'.repeat(64)
    const a = signEvent({
      kind: Kind.ShortNote,
      created_at: 1,
      tags: [['e', rootId, '', 'root']],
      content: 'a',
    })
    const b = signEvent({
      kind: Kind.ShortNote,
      created_at: 2,
      tags: [['e', rootId, '', 'root'], ['e', a.id, '', 'reply']],
      content: 'b',
    })
    const c = signEvent({
      kind: Kind.ShortNote,
      created_at: 3,
      tags: [['e', rootId, '', 'root'], ['e', b.id, '', 'reply']],
      content: 'c',
    })
    const d = signEvent({
      kind: Kind.ShortNote,
      created_at: 4,
      tags: [['e', rootId, '', 'root'], ['e', c.id, '', 'reply']],
      content: 'd',
    })
    const shortBranch = signEvent({
      kind: Kind.ShortNote,
      created_at: 5,
      tags: [['e', rootId, '', 'root']],
      content: 'short',
    })

    const tree = buildReplyTree([a, b, c, d, shortBranch])
    const compressedIds = collectDefaultCompressedBranchIds(tree, 2)

    expect(compressedIds.has(a.id)).toBe(true)
    expect(compressedIds.has(shortBranch.id)).toBe(false)
  })
})
