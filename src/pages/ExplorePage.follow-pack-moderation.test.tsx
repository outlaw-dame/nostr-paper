// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExplorePage from './ExplorePage'
import { AppContext, type AppContextValue } from '@/contexts/app-context'
import type { ExploreFollowPackCandidate } from '@/lib/explore/followPacks'
import { Kind, type NostrEvent, type Profile } from '@/types'

const getProfilesMock = vi.fn()
const recordStarterPackModerationStatsMock = vi.fn()
const BLOCKED_PROFILE_PUBKEY = 'b'.repeat(64)
const PACK_CURATOR_PUBKEY = 'a'.repeat(64)

const packCandidate: ExploreFollowPackCandidate = {
  event: {
    id: '1'.repeat(64),
    pubkey: PACK_CURATOR_PUBKEY,
    created_at: 1_700_000_000,
    kind: Kind.StarterPack,
    tags: [
      ['d', 'blocked-pack'],
      ['p', BLOCKED_PROFILE_PUBKEY],
    ],
    content: '',
    sig: '2'.repeat(128),
  } satisfies NostrEvent,
  parsed: {
    id: '1'.repeat(64),
    pubkey: PACK_CURATOR_PUBKEY,
    createdAt: 1_700_000_000,
    kind: Kind.StarterPack,
    definition: {
      kind: Kind.StarterPack,
      name: 'Starter Pack',
      description: 'Starter pack',
      addressable: true,
      expectedTagNames: ['p'],
    },
    identifier: 'blocked-pack',
    title: 'Blocked Pack',
    route: '/list/naddr1blocked',
    publicItems: [{ tagName: 'p', values: [BLOCKED_PROFILE_PUBKEY] }],
    hasPrivateItems: false,
  },
  profiles: [{ pubkey: BLOCKED_PROFILE_PUBKEY }],
}

const blockedProfile: Profile = {
  pubkey: BLOCKED_PROFILE_PUBKEY,
  name: 'Blocked Profile',
  updatedAt: 0,
}

vi.mock('motion/react', async () => {
  const React = await import('react')

  const passthroughTag = (tag: string) => React.forwardRef(
    ({ children, ...props }: Record<string, unknown>, ref) => React.createElement(tag, { ...props, ref }, children as never),
  )

  return {
    motion: new Proxy({}, {
      get: (_target, property) => passthroughTag(String(property)),
    }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  }
})

vi.mock('@/hooks/useRuntimeFeatureFlags', () => ({
  useRuntimeFeatureFlags: () => ({
    phase2BlindspotPanel: false,
    phase4MediaDietTracking: false,
  }),
}))

vi.mock('@/hooks/useExploreFollowPacks', async () => {
  const React = await import('react')

  return {
    useExploreFollowPacks: () => {
      const [stage, setStage] = React.useState(0)

      React.useEffect(() => {
        const failureTick = window.setTimeout(() => setStage(1), 15)
        const recoveryTick = window.setTimeout(() => setStage(2), 30)
        return () => {
          window.clearTimeout(failureTick)
          window.clearTimeout(recoveryTick)
        }
      }, [])

      return {
        packs: [[packCandidate], [packCandidate], [packCandidate]][stage] ?? [packCandidate],
        loading: false,
      }
    },
  }
})

vi.mock('@/hooks/useModeration', () => ({
  useModerationDocuments: () => ({ allowedIds: new Set<string>() }),
}))

vi.mock('@/hooks/useKeywordFilters', () => ({
  useEventFilterCheck: () => () => ({ action: null, matches: [] }),
  useProfileFilterCheck: () => (profile: Profile) => (
    profile.pubkey === BLOCKED_PROFILE_PUBKEY
      ? { action: 'block', matches: [{ ruleId: 'blocked', type: 'text', match: 'blocked-profile' }] }
      : { action: null, matches: [] }
  ),
  useSemanticFiltering: () => new Map<string, { action: null; matches: never[] }>(),
  mergeResults: (left: { action: string | null; matches: unknown[] }, right: { action: string | null; matches: unknown[] }) => {
    if (left.action === 'block' || right.action === 'block') return { action: 'block', matches: [...left.matches, ...right.matches] }
    if (left.action === 'hide' || right.action === 'hide') return { action: 'hide', matches: [...left.matches, ...right.matches] }
    return { action: null, matches: [...left.matches, ...right.matches] }
  },
}))

vi.mock('@/hooks/useSemanticFollowPacks', () => ({
  useSemanticFollowPacks: (packs: unknown[]) => ({ packs, semanticApplied: false }),
}))

vi.mock('@/hooks/useSearch', () => ({
  useSearch: () => ({
    input: '',
    query: '',
    setInput: vi.fn(),
    commitNow: vi.fn(),
    clear: vi.fn(),
    events: [],
    profiles: [],
    localLoading: false,
    relayLoading: false,
    relayError: null,
    semanticError: null,
  }),
}))

vi.mock('@/hooks/useMuteList', () => ({
  useMuteList: () => ({
    isMuted: () => false,
    mutedWords: new Set<string>(),
    mutedHashtags: new Set<string>(),
    loading: false,
  }),
}))

vi.mock('@/hooks/useHideNsfwTaggedPosts', () => ({
  useHideNsfwTaggedPosts: () => false,
}))

vi.mock('@/hooks/useTrendingTopics', () => ({
  useTrendingTopics: () => ({ topics: [], loading: false }),
}))

vi.mock('@/hooks/useTrendingLinks', () => ({
  useTrendingLinks: () => ({ links: [], loading: false }),
}))

vi.mock('@/hooks/useTrendingContent', () => ({
  useTrendingContent: () => ({ items: [], loading: false }),
}))

vi.mock('@/hooks/useSuggestedProfiles', () => ({
  useSuggestedProfiles: () => ({ profiles: [], loading: false }),
}))

vi.mock('@/hooks/usePopularProfiles', () => ({
  usePopularProfiles: () => ({ profiles: [], loading: false }),
}))

vi.mock('@/hooks/useFollowStatus', () => ({
  useFollowStatus: () => false,
}))

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ profile: null, loading: false }),
}))

vi.mock('@/hooks/useSelfThreadIndex', () => ({
  useSelfThreadIndex: () => null,
}))

vi.mock('@/lib/db/nostr', () => ({
  getProfiles: (...args: unknown[]) => getProfilesMock(...args),
}))

vi.mock('@/lib/nostr/contacts', () => ({
  getFreshContactList: vi.fn().mockResolvedValue(null),
  saveCurrentUserContactEntries: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/moderation/content', () => ({
  buildEventModerationDocument: vi.fn(() => null),
  buildProfileModerationDocument: vi.fn(() => null),
}))

vi.mock('@/lib/moderation/monthlyReport', () => ({
  recordStarterPackModerationStats: (...args: unknown[]) => recordStarterPackModerationStatsMock(...args),
}))

vi.mock('@/components/search/SearchBar', () => ({
  SearchBar: () => null,
}))

vi.mock('@/components/feed/FeedSkeleton', () => ({
  FeedSkeleton: () => null,
}))

vi.mock('@/components/profile/AuthorRow', () => ({
  AuthorRow: ({ pubkey }: { pubkey: string }) => <div>{pubkey}</div>,
}))

vi.mock('@/components/cards/NoteContent', () => ({
  NoteContent: ({ content }: { content: string }) => <>{content}</>,
}))

vi.mock('@/components/nostr/NoteMediaAttachments', () => ({
  NoteMediaAttachments: () => null,
}))

vi.mock('@/components/nostr/PollPreview', () => ({
  PollPreview: () => null,
}))

vi.mock('@/components/nostr/ThreadIndexBadge', () => ({
  ThreadIndexBadge: () => null,
}))

vi.mock('@/components/nostr/EventMetricsRow', () => ({
  EventMetricsRow: () => null,
}))

vi.mock('@/components/ui/TwemojiText', () => ({
  TwemojiText: ({ text }: { text: string }) => <>{text}</>,
}))

vi.mock('@/components/links/TrendingLinkCard', () => ({
  TrendingLinkCard: () => null,
}))

vi.mock('@/components/explore/NewsBlindspotPanel', () => ({
  NewsBlindspotPanel: () => null,
}))

vi.mock('@/components/filters/FilteredGate', () => ({
  FilteredGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

function createAppContextValue(): AppContextValue {
  return {
    status: 'ready',
    bootstrap: null,
    currentUser: { pubkey: 'f'.repeat(64) },
    errors: [],
    isOnline: true,
    dispatch: vi.fn(),
    logout: vi.fn(),
  }
}

describe('ExplorePage follow-pack moderation hardening', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    getProfilesMock
      .mockResolvedValueOnce(new Map([[BLOCKED_PROFILE_PUBKEY, blockedProfile]]))
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValue(new Map([[BLOCKED_PROFILE_PUBKEY, blockedProfile]]))
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

  it('does not temporarily re-show blocked pack during profile fetch failure and recovery', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root.render(
        <AppContext.Provider value={createAppContextValue()}>
          <MemoryRouter initialEntries={['/explore']}>
            <Routes>
              <Route path="/explore" element={<ExplorePage />} />
            </Routes>
          </MemoryRouter>
        </AppContext.Provider>,
      )
    })

    await act(async () => {
      await Promise.resolve()
    })
    const initialCalls = getProfilesMock.mock.calls.length
    expect(initialCalls).toBeGreaterThanOrEqual(1)
    expect(container.textContent).not.toContain('Blocked Pack')

    await act(async () => {
      vi.advanceTimersByTime(16)
      await Promise.resolve()
    })
    const failureStageCalls = getProfilesMock.mock.calls.length
    expect(failureStageCalls).toBeGreaterThan(initialCalls)
    expect(container.textContent).not.toContain('Blocked Pack')

    await act(async () => {
      vi.advanceTimersByTime(16)
      await Promise.resolve()
    })
    const recoveryStageCalls = getProfilesMock.mock.calls.length
    expect(recoveryStageCalls).toBeGreaterThan(failureStageCalls)
    expect(container.textContent).not.toContain('Blocked Pack')
  })
})
