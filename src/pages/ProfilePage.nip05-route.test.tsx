import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProfilePage from './ProfilePage'
import { AppContext, type AppContextValue } from '@/contexts/app-context'

const resolveNip05IdentifierMock = vi.fn()
let mockProfileAbout = ''

vi.mock('@/components/nostr/ReportSheet', () => ({ ReportSheet: () => null }))
vi.mock('@/components/nostr/ZapSheet', () => ({ ZapSheet: () => null }))
vi.mock('@/components/nostr/UserStatusBody', () => ({ UserStatusBody: () => null }))
vi.mock('@/components/profile/ProfileMetadataEditor', () => ({ ProfileMetadataEditor: () => null }))
vi.mock('@/components/translation/TranslateTextPanel', () => ({ TranslateTextPanel: () => null }))
vi.mock('@/components/ui/TwemojiText', () => ({ TwemojiText: ({ text }: { text: string }) => <>{text}</> }))
vi.mock('@/components/ui/ImageLightbox', () => ({ ImageLightbox: () => null }))

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

vi.mock('@/hooks/useProfile', () => ({
  useProfile: (pubkey: string | null | undefined) => ({
    profile: pubkey
      ? {
          pubkey,
          name: 'Resolved User',
          display_name: 'Resolved User',
          about: mockProfileAbout,
          updatedAt: 0,
          nip05Verified: true,
          nip05: 'alice@example.com',
        }
      : null,
    loading: false,
    error: null,
  }),
}))

vi.mock('@/hooks/useUserStatus', () => ({ useUserStatus: () => ({ status: null, loading: false }) }))
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

vi.mock('@/lib/nostr/nip21', () => ({
  decodeProfileReference: () => null,
}))

vi.mock('@/lib/nostr/nip05', () => ({
  formatNip05Identifier: (value: string) => value,
  parseNip05Identifier: (value: string) => value.includes('@') ? ({ identifier: value.toLowerCase(), localPart: 'alice', domain: 'example.com' }) : null,
  resolveNip05Identifier: (...args: unknown[]) => resolveNip05IdentifierMock(...args),
}))

vi.mock('@/lib/nostr/nip39', () => ({
  getIdentityUrl: () => null,
  getPlatformDisplayName: () => 'Platform',
}))

function createAppContextValue(): AppContextValue {
  return {
    status: 'ready',
    bootstrap: null,
    currentUser: null,
    errors: [],
    isOnline: true,
    dispatch: vi.fn(),
    logout: vi.fn(),
  }
}

describe('ProfilePage NIP-05 route resolution', () => {
  let container: HTMLDivElement
  let root: Root

  afterEach(async () => {
    vi.clearAllMocks()
    mockProfileAbout = ''
    if (root) {
      await act(async () => {
        root.unmount()
      })
    }
    if (container) container.remove()
  })

  it('resolves /profile/name@domain.com to a profile pubkey', async () => {
    const resolvedPubkey = 'b'.repeat(64)
    resolveNip05IdentifierMock.mockResolvedValue({
      identifier: 'alice@example.com',
      pubkey: resolvedPubkey,
      relays: [],
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root.render(
        <AppContext.Provider value={createAppContextValue()}>
          <MemoryRouter initialEntries={['/profile/alice@example.com']}>
            <Routes>
              <Route path="/profile/:pubkey" element={<ProfilePage />} />
            </Routes>
          </MemoryRouter>
        </AppContext.Provider>,
      )
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(resolveNip05IdentifierMock).toHaveBeenCalledWith('alice@example.com', expect.any(AbortSignal))
    expect(container.textContent).toContain(`author:${resolvedPubkey}`)
    expect(container.textContent).not.toContain('Invalid profile identifier in the route.')
  })

  it('shows an error when NIP-05 route cannot be resolved', async () => {
    resolveNip05IdentifierMock.mockResolvedValue(null)

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root.render(
        <AppContext.Provider value={createAppContextValue()}>
          <MemoryRouter initialEntries={['/profile/missing@example.com']}>
            <Routes>
              <Route path="/profile/:pubkey" element={<ProfilePage />} />
            </Routes>
          </MemoryRouter>
        </AppContext.Provider>,
      )
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(resolveNip05IdentifierMock).toHaveBeenCalledWith('missing@example.com', expect.any(AbortSignal))
    expect(container.textContent).toContain('Could not resolve that NIP-05 identifier.')
  })

  it('renders bio emoji and linkifies hashtags and URLs', async () => {
    const resolvedPubkey = 'b'.repeat(64)
    mockProfileAbout = 'Building with Nostr 🚀 #nostr https://example.com'

    resolveNip05IdentifierMock.mockResolvedValue({
      identifier: 'alice@example.com',
      pubkey: resolvedPubkey,
      relays: [],
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root.render(
        <AppContext.Provider value={createAppContextValue()}>
          <MemoryRouter initialEntries={['/profile/alice@example.com']}>
            <Routes>
              <Route path="/profile/:pubkey" element={<ProfilePage />} />
            </Routes>
          </MemoryRouter>
        </AppContext.Provider>,
      )
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('🚀')

    const hashtagLink = container.querySelector('a[href="/t/nostr"]')
    expect(hashtagLink).toBeTruthy()

    const externalLink = Array.from(container.querySelectorAll('a')).find((anchor) => (
      anchor.getAttribute('href')?.startsWith('https://example.com')
    ))
    expect(externalLink).toBeTruthy()
  })
})
