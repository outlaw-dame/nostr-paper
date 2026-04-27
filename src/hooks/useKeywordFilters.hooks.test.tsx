// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NostrEvent, Profile } from '@/types'
import type { CreateFilterInput, FilterCheckResult, KeywordFilter } from '@/lib/filters/types'
import { useEventFilterCheck, useKeywordFilters, useProfileFilterCheck } from './useKeywordFilters'

interface MockRefs {
  currentFilters: KeywordFilter[]
  loadFilters: ReturnType<typeof vi.fn>
  createFilter: ReturnType<typeof vi.fn>
  updateFilter: ReturnType<typeof vi.fn>
  deleteFilter: ReturnType<typeof vi.fn>
  getEffectiveKeywordFilters: ReturnType<typeof vi.fn>
  extractEventFields: ReturnType<typeof vi.fn>
  extractProfileFields: ReturnType<typeof vi.fn>
  checkEventText: ReturnType<typeof vi.fn>
  checkProfileText: ReturnType<typeof vi.fn>
}

const mockRefs: MockRefs = {
  currentFilters: [],
  loadFilters: vi.fn<() => Promise<KeywordFilter[]>>(),
  createFilter: vi.fn<() => Promise<KeywordFilter>>(),
  updateFilter: vi.fn<() => Promise<void>>(),
  deleteFilter: vi.fn<() => Promise<void>>(),
  getEffectiveKeywordFilters: vi.fn(),
  extractEventFields: vi.fn(),
  extractProfileFields: vi.fn(),
  checkEventText: vi.fn(),
  checkProfileText: vi.fn(),
}

vi.mock('@/lib/filters/storage', () => ({
  FILTERS_UPDATED_EVENT: 'nostr-paper:keyword-filters-updated',
  loadFilters: (...args: unknown[]) => mockRefs.loadFilters(...args),
  createFilter: (...args: unknown[]) => mockRefs.createFilter(...args),
  updateFilter: (...args: unknown[]) => mockRefs.updateFilter(...args),
  deleteFilter: (...args: unknown[]) => mockRefs.deleteFilter(...args),
}))

vi.mock('@/lib/filters/systemFilters', () => ({
  SYSTEM_KEYWORD_FILTERS: [],
  getEffectiveKeywordFilters: (...args: unknown[]) => mockRefs.getEffectiveKeywordFilters(...args),
}))

vi.mock('@/lib/filters/extract', () => ({
  extractEventFields: (...args: unknown[]) => mockRefs.extractEventFields(...args),
  extractProfileFields: (...args: unknown[]) => mockRefs.extractProfileFields(...args),
  buildSemanticText: (event: NostrEvent) => event.content,
}))

vi.mock('@/lib/filters/matcher', () => ({
  checkEventText: (...args: unknown[]) => mockRefs.checkEventText(...args),
  checkProfileText: (...args: unknown[]) => mockRefs.checkProfileText(...args),
  mergeResults: (a: FilterCheckResult, b: FilterCheckResult) => ({
    action: b.action ?? a.action,
    matches: [...a.matches, ...b.matches],
  }),
}))

vi.mock('@/lib/filters/semanticSettings', () => ({
  getSemanticFilterSettings: () => ({ threshold: 0.42 }),
  SEMANTIC_FILTER_SETTINGS_UPDATED_EVENT: 'nostr-paper:semantic-filter-settings-updated',
}))

vi.mock('@/lib/semantic/client', () => ({
  rankSemanticDocuments: vi.fn(),
}))

function makeFilter(overrides: Partial<KeywordFilter> = {}): KeywordFilter {
  return {
    id: 'f1',
    term: 'spam',
    action: 'hide',
    scope: 'content',
    wholeWord: false,
    semantic: false,
    enabled: true,
    createdAt: Date.now(),
    expiresAt: null,
    ...overrides,
  }
}

function makeEvent(): NostrEvent {
  return {
    id: 'event-1',
    pubkey: 'a'.repeat(64),
    created_at: 1_710_000_000,
    kind: 1,
    tags: [],
    content: 'content',
    sig: 'b'.repeat(128),
  }
}

function makeProfile(): Profile {
  return {
    pubkey: 'a'.repeat(64),
    name: 'alice',
    display_name: 'Alice',
    about: 'about',
    updatedAt: Date.now(),
  }
}

function CrudHarness({
  onSnapshot,
}: {
  onSnapshot: (state: KeywordFiltersState) => void
}) {
  const state = useKeywordFilters()

  useEffect(() => {
    onSnapshot(state)
  }, [state, onSnapshot])

  return null
}

type KeywordFiltersState = {
  filters: KeywordFilter[]
  loading: boolean
  add: (input: CreateFilterInput) => Promise<KeywordFilter>
  update: (id: string, patch: Partial<Omit<KeywordFilter, 'id' | 'createdAt'>>) => Promise<void>
  remove: (id: string) => Promise<void>
  toggle: (id: string) => Promise<void>
}

function CheckHarness({
  event,
  profile,
  onResult,
}: {
  event: NostrEvent
  profile?: Profile
  onResult: (result: FilterCheckResult) => void
}) {
  const check = useEventFilterCheck()

  useEffect(() => {
    onResult(check(event, profile))
  }, [check, event, profile, onResult])

  return null
}

function ProfileCheckHarness({
  profile,
  onResult,
}: {
  profile: Profile
  onResult: (result: FilterCheckResult) => void
}) {
  const check = useProfileFilterCheck()

  useEffect(() => {
    onResult(check(profile))
  }, [check, profile, onResult])

  return null
}

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

const syncFilters = async () => {
  await act(async () => {
    window.dispatchEvent(new CustomEvent('nostr-paper:keyword-filters-updated'))
    await flush()
  })
}

describe('useKeywordFilters hooks', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    mockRefs.currentFilters = [makeFilter()]
    mockRefs.loadFilters.mockReset()
    mockRefs.createFilter.mockReset()
    mockRefs.updateFilter.mockReset()
    mockRefs.deleteFilter.mockReset()
    mockRefs.getEffectiveKeywordFilters.mockReset()
    mockRefs.extractEventFields.mockReset()
    mockRefs.extractProfileFields.mockReset()
    mockRefs.checkEventText.mockReset()
    mockRefs.checkProfileText.mockReset()

    mockRefs.loadFilters.mockImplementation(async () => mockRefs.currentFilters)

    mockRefs.createFilter.mockImplementation(async (input: CreateFilterInput) => {
      const next = {
        id: 'f2',
        createdAt: Date.now(),
        ...input,
      } as KeywordFilter
      mockRefs.currentFilters = [...mockRefs.currentFilters, next]
      return next
    })

    mockRefs.updateFilter.mockImplementation(async (id: string, patch: Partial<KeywordFilter>) => {
      mockRefs.currentFilters = mockRefs.currentFilters.map((f) => (f.id === id ? { ...f, ...patch } : f))
    })

    mockRefs.deleteFilter.mockImplementation(async (id: string) => {
      mockRefs.currentFilters = mockRefs.currentFilters.filter((f) => f.id !== id)
    })

    mockRefs.getEffectiveKeywordFilters.mockImplementation((filters: KeywordFilter[]) => filters)
    mockRefs.extractEventFields.mockReturnValue({ content: 'x' })
    mockRefs.extractProfileFields.mockReturnValue({ displayName: 'alice', name: 'alice', about: 'about', nip05: '' })
    mockRefs.checkEventText.mockReturnValue({ action: 'hide', matches: [] })
    mockRefs.checkProfileText.mockReturnValue({ action: 'hide', matches: [] })
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.clearAllMocks()
  })

  it('supports CRUD and toggle with singleton refresh updates', async () => {
    let latest: unknown = null

    await act(async () => {
      root.render(
        <CrudHarness
          onSnapshot={(state) => {
            latest = state
          }}
        />,
      )
      await flush()
    })

    await syncFilters()

    expect(latest).not.toBeNull()
    if (!latest || typeof latest !== 'object' || !('filters' in latest)) {
      throw new Error('expected hook state to be available')
    }
    expect((latest as KeywordFiltersState).filters).toHaveLength(1)

    await act(async () => {
      await (latest as KeywordFiltersState | null)?.toggle('f1')
      await flush()
    })

    expect(mockRefs.updateFilter).toHaveBeenCalledWith('f1', { enabled: false })

    await act(async () => {
      await (latest as KeywordFiltersState | null)?.toggle('missing-id')
      await flush()
    })

    expect(mockRefs.updateFilter).toHaveBeenCalledTimes(1)

    await act(async () => {
      await (latest as KeywordFiltersState | null)?.add({
        term: 'abuse',
        action: 'warn',
        scope: 'content',
        wholeWord: true,
        semantic: false,
        enabled: true,
        expiresAt: null,
      })
      await (latest as KeywordFiltersState | null)?.update('f2', { action: 'block' })
      await (latest as KeywordFiltersState | null)?.remove('f2')
      await flush()
    })

    expect(mockRefs.createFilter).toHaveBeenCalledTimes(1)
    expect(mockRefs.updateFilter).toHaveBeenCalledWith('f2', { action: 'block' })
    expect(mockRefs.deleteFilter).toHaveBeenCalledWith('f2')

    // External storage event should trigger refresh for all subscribers.
    mockRefs.currentFilters = [makeFilter({ id: 'f3' }), makeFilter({ id: 'f4' })]
    await syncFilters()

    expect(latest).not.toBeNull()
    if (!latest || typeof latest !== 'object' || !('filters' in latest)) {
      throw new Error('expected hook state to be available after refresh')
    }
    expect((latest as KeywordFiltersState).filters).toHaveLength(2)
  })

  it('returns null result while loading/empty and delegates to matcher when filters exist', async () => {
    let result: FilterCheckResult = { action: null, matches: [] }

    // Empty/initial pass should short-circuit.
    mockRefs.currentFilters = []
    mockRefs.getEffectiveKeywordFilters.mockReturnValueOnce([])

    await act(async () => {
      root.render(
        <CheckHarness
          event={makeEvent()}
          profile={makeProfile()}
          onResult={(next) => {
            result = next
          }}
        />,
      )
      await flush()
    })

    expect(result.action).toBeNull()

    // Update filters and trigger refresh.
    mockRefs.currentFilters = [makeFilter()]
    mockRefs.checkEventText.mockReturnValue({ action: 'block', matches: [] })

    await syncFilters()

    expect(mockRefs.getEffectiveKeywordFilters).toHaveBeenCalled()
    expect(mockRefs.extractEventFields).toHaveBeenCalled()
    expect(mockRefs.checkEventText).toHaveBeenCalled()
    expect(result.action).toBe('block')
  })

  it('delegates profile filtering through extractProfileFields/checkProfileText', async () => {
    let result: FilterCheckResult = { action: null, matches: [] }

    mockRefs.currentFilters = [makeFilter({ scope: 'author' })]
    mockRefs.checkProfileText.mockReturnValue({ action: 'block', matches: [] })

    await act(async () => {
      root.render(
        <ProfileCheckHarness
          profile={makeProfile()}
          onResult={(next) => {
            result = next
          }}
        />,
      )
      await flush()
    })

    await syncFilters()

    expect(mockRefs.getEffectiveKeywordFilters).toHaveBeenCalled()
    expect(mockRefs.extractProfileFields).toHaveBeenCalled()
    expect(mockRefs.checkProfileText).toHaveBeenCalled()
    expect(result.action).toBe('block')
  })
})
