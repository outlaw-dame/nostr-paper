// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ActivityPage from './ActivityPage'
import { AppContext, type AppContextValue } from '@/contexts/app-context'

const generateAssistTextMock = vi.fn()

vi.mock('@/lib/ai/gemmaAssist', () => ({
  generateAssistText: (...args: unknown[]) => generateAssistTextMock(...args),
}))

vi.mock('@/hooks/useNostrFeed', () => ({
  useNostrFeed: () => ({
    loading: false,
    error: null,
    refresh: vi.fn(),
    events: [
      {
        id: 'mention-1',
        kind: 1,
        pubkey: 'b'.repeat(64),
        created_at: Math.floor(Date.now() / 1000) - 30,
        content: 'Nice point, thanks for sharing.',
        tags: [['p', 'a'.repeat(64)]],
        sig: '0',
      },
    ],
  }),
}))

vi.mock('@/hooks/useActivitySeen', () => ({
  useActivitySeen: () => ({
    seenAt: 0,
    markAllSeen: vi.fn(),
  }),
}))

vi.mock('@/hooks/useEvent', () => ({
  useEvent: () => ({ event: null, loading: false }),
}))

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ profile: null, loading: false }),
}))

vi.mock('@/components/nostr/EventPreviewCard', () => ({
  EventPreviewCard: () => null,
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

describe('ActivityPage AI provider routing', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    localStorage.clear()

    generateAssistTextMock.mockResolvedValue({
      text: 'Activity recap from test model.',
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

  it('uses selected provider for recap generation', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root.render(
        <AppContext.Provider value={createAppContextValue()}>
          <MemoryRouter>
            <ActivityPage />
          </MemoryRouter>
        </AppContext.Provider>,
      )
    })

    await act(async () => {
      vi.advanceTimersByTime(800)
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
      vi.advanceTimersByTime(800)
      await Promise.resolve()
    })

    const lastCall = generateAssistTextMock.mock.calls.at(-1)
    expect(lastCall?.[1]).toMatchObject({ provider: 'gemini' })
  })
})
