// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationSection } from './ConversationSection'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

const useConversationThreadMock = vi.fn()

vi.mock('@/hooks/useConversationThread', () => ({
  useConversationThread: (...args: unknown[]) => useConversationThreadMock(...args),
}))

vi.mock('@/components/nostr/EventPreviewCard', () => ({
  EventPreviewCard: ({ event }: { event: NostrEvent }) => (
    <div data-testid={`card-${event.id}`}>{event.id.slice(0, 8)}</div>
  ),
}))

function makeHex(char: string): string {
  return char.repeat(64)
}

function makeReplyEvent(params: {
  idChar: string
  pubkeyChar: string
  createdAt: number
  rootId: string
  parentId: string
}): NostrEvent {
  return {
    id: makeHex(params.idChar),
    pubkey: makeHex(params.pubkeyChar),
    created_at: params.createdAt,
    kind: Kind.ShortNote,
    tags: [
      ['e', params.rootId, '', 'root'],
      ['e', params.parentId, '', 'reply'],
    ],
    content: `reply-${params.idChar}`,
    sig: makeHex('a') + makeHex('b'),
  }
}

function findButtonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(text)) ?? null
}

describe('ConversationSection branching behavior', () => {
  let container: HTMLDivElement | null
  let root: Root | null

  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    container?.remove()
    root = null
    container = null
  })

  it('separates other branches and avoids duplicate rendering', async () => {
    const rootId = makeHex('1')
    const currentEvent: NostrEvent = {
      id: makeHex('2'),
      pubkey: makeHex('c'),
      created_at: 10,
      kind: Kind.ShortNote,
      tags: [
        ['e', rootId, '', 'root'],
        ['e', rootId, '', 'reply'],
      ],
      content: 'current',
      sig: makeHex('a') + makeHex('b'),
    }

    const primaryRoot = makeReplyEvent({
      idChar: '3',
      pubkeyChar: 'd',
      createdAt: 11,
      rootId,
      parentId: currentEvent.id,
    })

    const primaryChild = makeReplyEvent({
      idChar: '4',
      pubkeyChar: 'e',
      createdAt: 12,
      rootId,
      parentId: primaryRoot.id,
    })

    const otherRoot = makeReplyEvent({
      idChar: '5',
      pubkeyChar: 'f',
      createdAt: 13,
      rootId,
      parentId: rootId,
    })

    useConversationThreadMock.mockReturnValue({
      rootEvent: null,
      replies: [primaryRoot, primaryChild, otherRoot],
      loading: false,
      rootLoading: false,
      error: null,
      threadingMode: 'standard',
    })

    await act(async () => {
      if (!root) throw new Error('Root not initialized')
      root.render(<ConversationSection event={currentEvent} section="replies" />)
    })

    if (!container) throw new Error('Container not initialized')
    expect(container.textContent).toContain('Other Branches (1)')

    const otherRootCards = container.querySelectorAll(`[data-testid="card-${otherRoot.id}"]`)
    expect(otherRootCards.length).toBe(1)
  })

  it('limits other branches by default and supports explicit expansion', async () => {
    const rootId = makeHex('1')
    const currentEvent: NostrEvent = {
      id: makeHex('2'),
      pubkey: makeHex('c'),
      created_at: 10,
      kind: Kind.ShortNote,
      tags: [
        ['e', rootId, '', 'root'],
        ['e', rootId, '', 'reply'],
      ],
      content: 'current',
      sig: makeHex('a') + makeHex('b'),
    }

    const primaryRoot = makeReplyEvent({
      idChar: '3',
      pubkeyChar: 'd',
      createdAt: 11,
      rootId,
      parentId: currentEvent.id,
    })

    const otherRoots = [
      makeReplyEvent({ idChar: '4', pubkeyChar: '4', createdAt: 12, rootId, parentId: rootId }),
      makeReplyEvent({ idChar: '5', pubkeyChar: '5', createdAt: 13, rootId, parentId: rootId }),
      makeReplyEvent({ idChar: '6', pubkeyChar: '6', createdAt: 14, rootId, parentId: rootId }),
      makeReplyEvent({ idChar: '7', pubkeyChar: '7', createdAt: 15, rootId, parentId: rootId }),
      makeReplyEvent({ idChar: '8', pubkeyChar: '8', createdAt: 16, rootId, parentId: rootId }),
    ]

    useConversationThreadMock.mockReturnValue({
      rootEvent: null,
      replies: [primaryRoot, ...otherRoots],
      loading: false,
      rootLoading: false,
      error: null,
      threadingMode: 'standard',
    })

    await act(async () => {
      if (!root) throw new Error('Root not initialized')
      root.render(<ConversationSection event={currentEvent} section="replies" />)
    })

    if (!container) throw new Error('Container not initialized')
    const showMoreButton = findButtonByText(container, 'Show 2 more branches')
    expect(showMoreButton).toBeTruthy()

    if (!showMoreButton) {
      throw new Error('Expected show more branches button')
    }

    await act(async () => {
      showMoreButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const showFewerButton = findButtonByText(container, 'Show fewer branches')
    expect(showFewerButton).toBeTruthy()

    for (const event of otherRoots) {
      expect(container.querySelectorAll(`[data-testid="card-${event.id}"]`).length).toBe(1)
    }
  })

  it('keeps detached malformed branches out of primary branch rendering', async () => {
    const rootId = makeHex('1')
    const currentEvent: NostrEvent = {
      id: makeHex('2'),
      pubkey: makeHex('c'),
      created_at: 10,
      kind: Kind.ShortNote,
      tags: [
        ['e', rootId, '', 'root'],
        ['e', rootId, '', 'reply'],
      ],
      content: 'current',
      sig: makeHex('a') + makeHex('b'),
    }

    const primaryRoot = makeReplyEvent({
      idChar: '3',
      pubkeyChar: 'd',
      createdAt: 11,
      rootId,
      parentId: currentEvent.id,
    })

    const malformedDetached = makeReplyEvent({
      idChar: '9',
      pubkeyChar: '9',
      createdAt: 12,
      rootId,
      parentId: makeHex('f'),
    })

    useConversationThreadMock.mockReturnValue({
      rootEvent: null,
      replies: [primaryRoot, malformedDetached],
      loading: false,
      rootLoading: false,
      error: null,
      threadingMode: 'standard',
    })

    await act(async () => {
      if (!root) throw new Error('Root not initialized')
      root.render(<ConversationSection event={currentEvent} section="replies" />)
    })

    expect(container?.textContent).toContain('Other Branches (1)')
    expect(container?.querySelectorAll(`[data-testid="card-${primaryRoot.id}"]`).length).toBe(1)
    expect(container?.querySelectorAll(`[data-testid="card-${malformedDetached.id}"]`).length).toBe(1)
  })
})
