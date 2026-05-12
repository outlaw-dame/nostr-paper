// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComposeSheet } from './ComposeSheet'
import { AppContext, type AppContextValue } from '@/contexts/app-context'
import * as threadModule from '@/lib/nostr/thread'
import { Kind } from '@/types'

const publishCommentMock = vi.fn()
const publishTextReplyMock = vi.fn()

vi.mock('konsta/react', () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/blossom/BlossomUpload', () => ({
  BlossomUpload: () => null,
}))

vi.mock('@/components/compose/GifPicker', () => ({
  GifPicker: () => null,
}))

vi.mock('@/components/cards/NoteContent', () => ({
  NoteContent: ({ value }: { value: string }) => <>{value}</>,
}))

vi.mock('@/components/links/LinkPreviewCard', () => ({
  LinkPreviewCard: () => null,
}))

vi.mock('@/components/nostr/EventPreviewCard', () => ({
  EventPreviewCard: () => null,
}))

vi.mock('@/hooks/useAddressableEvent', () => ({
  useAddressableEvent: () => ({ event: null, loading: false }),
}))

vi.mock('@/hooks/useConversationThread', () => ({
  useConversationThread: () => ({ rootEvent: null, replies: [], loading: false }),
}))

vi.mock('@/hooks/useEvent', () => ({
  useEvent: () => ({
    event: {
      id: 'f'.repeat(64),
      pubkey: 'b'.repeat(64),
      created_at: 1,
      kind: Kind.LongFormContent,
      tags: [['d', 'article-test']],
      content: 'Article body',
      sig: 'a'.repeat(128),
    },
    loading: false,
  }),
}))

vi.mock('@/hooks/useHideNsfwTaggedPosts', () => ({
  useHideNsfwTaggedPosts: () => false,
}))

vi.mock('@/hooks/useHashtagSuggestions', () => ({
  useHashtagSuggestions: () => ({ suggestions: [], loading: false }),
}))

vi.mock('@/hooks/useKeywordFilters', () => ({
  useKeywordFilters: () => ({ filters: [], loading: false }),
}))

vi.mock('@/hooks/useMuteList', () => ({
  useMuteList: () => ({ mutedPubkeys: new Set<string>(), mutedWords: [], mutedHashtags: new Set<string>(), loading: false }),
}))

vi.mock('@/hooks/useTrendingTopics', () => ({
  useTrendingTopics: () => ({ topics: [], loading: false }),
}))

vi.mock('@/lib/compose', () => ({
  clearComposeSearch: vi.fn(),
  getComposeQuoteReference: () => null,
  getComposeReplyReference: () => 'nostr:nevent1qqtest',
  getComposeStoryMode: () => false,
  isComposeOpen: () => true,
}))

vi.mock('@/lib/nostr/fileMetadata', () => ({ normalizeNip94Tags: () => [] }))

vi.mock('@/lib/nostr/nip21', () => ({
  decodeAddressReference: () => null,
  decodeEventReference: () => ({ eventId: 'f'.repeat(64) }),
}))

vi.mock('@/lib/nostr/note', () => ({ publishNote: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/lib/tenor/client', () => ({
  isTenorConfigured: () => false,
}))

function createAppContextValue(): AppContextValue {
  return {
    status: 'ready',
    bootstrap: null,
    currentUser: { pubkey: 'a'.repeat(64) },
    errors: [],
    isOnline: true,
    dispatch: vi.fn(),
    logout: vi.fn(),
  }
}

async function setTextAreaValue(textarea: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('ComposeSheet reply publish routing', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.localStorage?.clear()
    vi.spyOn(threadModule, 'publishComment').mockImplementation((...args) => publishCommentMock(...args))
    vi.spyOn(threadModule, 'publishTextReply').mockImplementation((...args) => publishTextReplyMock(...args))
    vi.spyOn(threadModule, 'publishThread').mockResolvedValue({
      id: '3'.repeat(64),
      pubkey: 'a'.repeat(64),
      created_at: 2,
      kind: Kind.Thread,
      tags: [],
      content: 'thread',
      sig: 'd'.repeat(128),
    })

    publishCommentMock.mockResolvedValue({
      id: '1'.repeat(64),
      pubkey: 'a'.repeat(64),
      created_at: 2,
      kind: Kind.Comment,
      tags: [],
      content: 'Reply as comment',
      sig: 'f'.repeat(128),
    })

    publishTextReplyMock.mockResolvedValue({
      id: '2'.repeat(64),
      pubkey: 'a'.repeat(64),
      created_at: 2,
      kind: Kind.ShortNote,
      tags: [],
      content: 'Reply as note',
      sig: 'e'.repeat(128),
    })
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount()
      })
    }
    if (container) container.remove()
  })

  it('publishes kind-1111 comment when replying to non-text root content', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root.render(
        <AppContext.Provider value={createAppContextValue()}>
          <MemoryRouter>
            <ComposeSheet />
          </MemoryRouter>
        </AppContext.Provider>,
      )
    })

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement | null
    expect(textarea).toBeTruthy()
    if (!textarea) throw new Error('Expected compose textarea to be rendered')

    await setTextAreaValue(textarea, 'This is a NIP-22 article reply from test.')

    const publishButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Publish'))
    expect(publishButton).toBeTruthy()

    await act(async () => {
      publishButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(publishCommentMock).toHaveBeenCalledTimes(1)
    expect(publishTextReplyMock).not.toHaveBeenCalled()
  })
})
