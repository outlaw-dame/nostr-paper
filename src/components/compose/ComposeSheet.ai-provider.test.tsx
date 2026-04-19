// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComposeSheet } from './ComposeSheet'
import { AppContext, type AppContextValue } from '@/contexts/app-context'

const generateAssistTextMock = vi.fn()

vi.mock('konsta/react', () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/lib/ai/gemmaAssist', () => ({
  generateAssistText: (...args: unknown[]) => generateAssistTextMock(...args),
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
  useEvent: () => ({ event: null, loading: false }),
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
  getComposeReplyReference: () => null,
  getComposeStoryMode: () => false,
  isComposeOpen: () => true,
}))

vi.mock('@/lib/nostr/fileMetadata', () => ({ normalizeNip94Tags: () => [] }))
vi.mock('@/lib/nostr/nip21', () => ({ decodeAddressReference: () => null, decodeEventReference: () => null }))
vi.mock('@/lib/nostr/note', () => ({ publishNote: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/nostr/thread', () => ({
  parseCommentEvent: () => null,
  publishComment: vi.fn().mockResolvedValue(undefined),
  publishTextReply: vi.fn().mockResolvedValue(undefined),
  publishThread: vi.fn().mockResolvedValue(undefined),
}))

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

describe('ComposeSheet AI provider routing', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    localStorage.clear()

    generateAssistTextMock.mockResolvedValue({
      text: 'Composer guidance from test model.',
      source: 'gemini',
      enhancedByGemini: false,
    })
  })

  afterEach(async () => {
    vi.useRealTimers()
    if (root) {
      await act(async () => {
        root.unmount()
      })
    }
    if (container) container.remove()
  })

  it('uses selected provider for compose assistance generation', async () => {
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
    if (!textarea) {
      throw new Error('Expected compose textarea to be rendered')
    }

    await setTextAreaValue(
      textarea,
      'This draft should trigger composer assistance with enough context and meaningful detail.',
    )

    await act(async () => {
      vi.advanceTimersByTime(900)
      await Promise.resolve()
    })

    expect(generateAssistTextMock).toHaveBeenCalled()
    const firstCall = generateAssistTextMock.mock.calls[0]
    expect(firstCall?.[1]).toMatchObject({ provider: 'auto' })

    const providerSelect = container.querySelector('select[aria-label="AI provider"]') as HTMLSelectElement | null
    expect(providerSelect).toBeTruthy()

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
      setter?.call(providerSelect, 'gemini')
      providerSelect?.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await act(async () => {
      vi.advanceTimersByTime(900)
      await Promise.resolve()
    })

    const lastCall = generateAssistTextMock.mock.calls.at(-1)
    expect(lastCall?.[1]).toMatchObject({ provider: 'gemini' })
  })
})
