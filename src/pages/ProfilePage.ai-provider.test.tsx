// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProfilePage from './ProfilePage'
import { AppContext, type AppContextValue } from '@/contexts/app-context'

const generateAssistTextMock = vi.fn()
const queryEventsMock = vi.fn()

vi.mock('@/lib/ai/gemmaAssist', () => ({
  generateAssistText: (...args: unknown[]) => generateAssistTextMock(...args),
}))

vi.mock('@/lib/db/nostr', () => ({
  queryEvents: (...args: unknown[]) => queryEventsMock(...args),
}))

vi.mock('@/components/nostr/ReportSheet', () => ({ ReportSheet: () => null }))
vi.mock('@/components/nostr/UserStatusBody', () => ({ UserStatusBody: () => null }))
vi.mock('@/components/profile/ProfileMetadataEditor', () => ({ ProfileMetadataEditor: () => null }))
vi.mock('@/components/ui/TwemojiText', () => ({ TwemojiText: ({ text }: { text: string }) => <>{text}</> }))
vi.mock('@/components/ui/ImageLightbox', () => ({ ImageLightbox: () => null }))
vi.mock('@/components/cards/NoteContent', () => ({ NoteContent: ({ value }: { value: string }) => <>{value}</> }))

vi.mock('@/components/profile/AuthorRow', () => ({
  AuthorRow: ({ pubkey }: { pubkey: string }) => <div>{`author:${pubkey}`}</div>,
}))

vi.mock('@/hooks/useMediaModeration', () => ({
  useMediaModerationDocuments: () => ({ blockedIds: new Set<string>(), loading: false }),
}))

vi.mock('@/hooks/useModeration', () => ({
  useProfileModeration: () => ({ blocked: false, loading: false, decision: null }),
}))

vi.mock('@/hooks/useMuteList', () => ({
  useMuteList: () => ({ isMuted: () => false, mute: vi.fn(), unmute: vi.fn(), loading: false }),
}))

vi.mock('@/hooks/usePageHead', () => ({ usePageHead: vi.fn() }))
vi.mock('@/hooks/useLivePresence', () => ({ useLivePresence: () => ({ status: null, entries: [] }) }))
vi.mock('@/hooks/useUserStatus', () => ({ useUserStatus: () => ({ status: null, loading: false }) }))

vi.mock('@/hooks/useProfile', () => ({
  useProfile: (pubkey: string | null | undefined) => ({
    profile: pubkey
      ? {
          pubkey,
          name: 'Profile Subject',
          display_name: 'Profile Subject',
          about: 'Builder focusing on nostr discovery and long-form writing.',
          updatedAt: 0,
          nip05Verified: true,
          nip05: 'alice@example.com',
        }
      : null,
    loading: false,
    error: null,
  }),
}))

vi.mock('@/lib/moderation/mediaContent', () => ({ buildMediaModerationDocument: vi.fn(() => null) }))
vi.mock('@/lib/nostr/meta', () => ({ buildProfileMetaTags: () => [], buildProfileTitle: () => 'Profile' }))

vi.mock('@/lib/nostr/contacts', () => ({
  getFreshContactList: vi.fn().mockResolvedValue(null),
  saveCurrentUserContactEntry: vi.fn().mockResolvedValue(null),
  unfollowCurrentUserContact: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/nostr/badges', () => ({
  getFreshProfileBadges: vi.fn().mockResolvedValue([]),
  pickBadgeAsset: () => null,
}))

vi.mock('@/lib/nostr/appHandlers', () => ({
  getFreshHandlerInformationEvents: vi.fn().mockResolvedValue([]),
  getFreshHandlerRecommendationEvents: vi.fn().mockResolvedValue([]),
  getHandlerDisplayName: () => 'Handler',
  getHandlerRecommendationSummary: () => '',
  getHandlerSummary: () => '',
}))

vi.mock('@/lib/nostr/lists', () => ({
  getFreshNip51ListEvents: vi.fn().mockResolvedValue([]),
  getNip51ListLabel: () => 'List',
}))

vi.mock('@/lib/nostr/nip21', () => ({ decodeProfileReference: () => null }))
vi.mock('@/lib/nostr/nip05', () => ({
  formatNip05Identifier: (value: string) => value,
  parseNip05Identifier: () => null,
  resolveNip05Identifier: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/nostr/nip39', () => ({ getIdentityUrl: () => null, getPlatformDisplayName: () => 'Platform' }))

function createAppContextValue(): AppContextValue {
  return {
    status: 'ready',
    bootstrap: null,
    currentUser: { pubkey: 'c'.repeat(64) },
    errors: [],
    isOnline: true,
    dispatch: vi.fn(),
    logout: vi.fn(),
  }
}

describe('ProfilePage AI provider routing', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    localStorage.clear()

    queryEventsMock.mockResolvedValue([
      {
        id: 'post-1',
        pubkey: 'b'.repeat(64),
        created_at: Math.floor(Date.now() / 1000) - 120,
        content: 'Exploring #nostr quality signals and profile summaries.',
      },
    ])

    generateAssistTextMock.mockResolvedValue({
      text: 'Consistent builder voice\nFocuses on discovery workflows\nUses hashtags intentionally',
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

  it('uses selected provider for profile insights generation', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root.render(
        <AppContext.Provider value={createAppContextValue()}>
          <MemoryRouter initialEntries={['/profile']}>
            <Routes>
              <Route path="/profile" element={<ProfilePage />} />
            </Routes>
          </MemoryRouter>
        </AppContext.Provider>,
      )
    })

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
