import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NostrEvent } from '@/types'
import type { FilterCheckResult, KeywordFilter } from '@/lib/filters/types'
import { useSemanticFiltering } from './useKeywordFilters'

interface MockRefs {
  currentFilters: KeywordFilter[]
  loadFilters: ReturnType<typeof vi.fn>
  rankSemanticDocuments: ReturnType<typeof vi.fn>
}

let mockRefs: MockRefs

vi.mock('@/lib/filters/systemFilters', () => ({
  SYSTEM_KEYWORD_FILTERS: [],
  getEffectiveKeywordFilters: (filters: KeywordFilter[]) => filters,
}))

vi.mock('@/lib/filters/storage', () => ({
  FILTERS_UPDATED_EVENT: 'nostr-paper:keyword-filters-updated',
  loadFilters: (...args: unknown[]) => mockRefs.loadFilters(...args),
  createFilter: vi.fn(),
  updateFilter: vi.fn(),
  deleteFilter: vi.fn(),
}))

vi.mock('@/lib/semantic/client', () => ({
  rankSemanticDocuments: (...args: unknown[]) => mockRefs.rankSemanticDocuments(...args),
}))

vi.mock('@/lib/filters/semanticSettings', () => ({
  getSemanticFilterSettings: () => ({ threshold: 0.42 }),
  SEMANTIC_FILTER_SETTINGS_UPDATED_EVENT: 'nostr-paper:semantic-filter-settings-updated',
}))

mockRefs = {
  currentFilters: [
    {
      id: 'filter-1',
      term: 'violence',
      action: 'hide',
      scope: 'content',
      wholeWord: false,
      semantic: true,
      enabled: true,
      createdAt: 1,
      expiresAt: null,
    },
  ] as KeywordFilter[],
  loadFilters: vi.fn<() => Promise<KeywordFilter[]>>(),
  rankSemanticDocuments: vi.fn(),
}

mockRefs.loadFilters.mockImplementation(async () => mockRefs.currentFilters)

interface HarnessProps {
  events: NostrEvent[]
  onResult: (result: Map<string, FilterCheckResult>) => void
}

function Harness({ events, onResult }: HarnessProps) {
  const result = useSemanticFiltering(events)

  useEffect(() => {
    onResult(result)
  }, [onResult, result])

  return null
}

function makeEvent(id: string, content: string): NostrEvent {
  return {
    id,
    pubkey: 'a'.repeat(64),
    created_at: 1_710_000_000,
    kind: 1,
    tags: [],
    content,
    sig: 'b'.repeat(128),
  }
}

function semanticFilter(overrides: Partial<KeywordFilter> = {}): KeywordFilter {
  return {
    id: 'filter-1',
    term: 'violence',
    action: 'hide',
    scope: 'content',
    wholeWord: false,
    semantic: true,
    enabled: true,
    createdAt: Date.now(),
    expiresAt: null,
    ...overrides,
  }
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

const syncSemanticSettings = async (scopeId = 'anon') => {
  await act(async () => {
    window.dispatchEvent(new CustomEvent('nostr-paper:semantic-filter-settings-updated', { detail: { scopeId } }))
    await flush()
  })
}

describe('useSemanticFiltering', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockRefs.loadFilters.mockReset()
    mockRefs.rankSemanticDocuments.mockReset()
    mockRefs.currentFilters = [semanticFilter({ action: 'hide' })]
    mockRefs.loadFilters.mockImplementation(async () => mockRefs.currentFilters)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.clearAllMocks()
  })

  it('applies semantic hide when score meets threshold', async () => {
    mockRefs.rankSemanticDocuments.mockResolvedValue([{ id: 'event-1', score: 0.55 }])

    let latest = new Map<string, FilterCheckResult>()

    await act(async () => {
      root.render(
        <Harness
          events={[makeEvent('event-1', 'some text')]}
          onResult={(result) => {
            latest = result
          }}
        />,
      )
      await flush()
    })

    await syncFilters()

    expect(mockRefs.rankSemanticDocuments).toHaveBeenCalled()
    expect(latest.get('event-1')?.action).toBe('hide')
    expect(latest.get('event-1')?.matches[0]?.semantic).toBe(true)
  })

  it('applies semantic block when a block rule meets threshold', async () => {
    mockRefs.currentFilters = [semanticFilter({ action: 'block' })]
    mockRefs.rankSemanticDocuments.mockResolvedValue([{ id: 'event-1', score: 0.67 }])

    let latest = new Map<string, FilterCheckResult>()

    await act(async () => {
      root.render(
        <Harness
          events={[makeEvent('event-1', 'some text')]} 
          onResult={(result) => {
            latest = result
          }}
        />,
      )
      await flush()
    })

    await syncFilters()

    expect(latest.get('event-1')?.action).toBe('block')
    expect(latest.get('event-1')?.matches[0]?.action).toBe('block')
  })

  it('ignores semantic matches below threshold', async () => {
    mockRefs.currentFilters = [semanticFilter({ action: 'warn' })]
    mockRefs.rankSemanticDocuments.mockResolvedValue([{ id: 'event-1', score: 0.30 }])

    let latest = new Map<string, FilterCheckResult>()

    await act(async () => {
      root.render(
        <Harness
          events={[makeEvent('event-1', 'some text')]}
          onResult={(result) => {
            latest = result
          }}
        />,
      )
      await flush()
    })

    await syncFilters()

    expect(mockRefs.rankSemanticDocuments).toHaveBeenCalled()
    expect(latest.size).toBe(0)
  })

  it('clears stale semantic results when next event set has no semantic text', async () => {
    mockRefs.currentFilters = [semanticFilter()]
    mockRefs.rankSemanticDocuments.mockResolvedValue([{ id: 'event-1', score: 0.9 }])

    let latest = new Map<string, FilterCheckResult>()

    await act(async () => {
      root.render(
        <Harness
          events={[makeEvent('event-1', 'violence related content')]}
          onResult={(result) => {
            latest = result
          }}
        />,
      )
      await flush()
    })

    await syncFilters()

    expect(latest.get('event-1')?.action).toBe('hide')

    await act(async () => {
      root.render(
        <Harness
          events={[makeEvent('event-2', '   ')]}
          onResult={(result) => {
            latest = result
          }}
        />,
      )
      await flush()
    })

    expect(latest.size).toBe(0)
  })

  it('applies warn action when semantic-only warn rule meets threshold', async () => {
    mockRefs.currentFilters = [semanticFilter({ action: 'warn' })]
    mockRefs.rankSemanticDocuments.mockResolvedValue([{ id: 'event-1', score: 0.77 }])

    let latest = new Map<string, FilterCheckResult>()

    await act(async () => {
      root.render(
        <Harness
          events={[makeEvent('event-1', 'some text')]}
          onResult={(result) => {
            latest = result
          }}
        />,
      )
      await flush()
    })

    await syncFilters()

    expect(latest.get('event-1')?.action).toBe('warn')
    expect(latest.get('event-1')?.matches[0]?.action).toBe('warn')
  })

  it('re-runs ranking when semantic settings update for the same scope', async () => {
    mockRefs.rankSemanticDocuments.mockResolvedValue([{ id: 'event-1', score: 0.55 }])

    await act(async () => {
      root.render(
        <Harness
          events={[makeEvent('event-1', 'some text')]}
          onResult={() => {}}
        />,
      )
      await flush()
    })

    await syncFilters()
    const before = mockRefs.rankSemanticDocuments.mock.calls.length

    await syncSemanticSettings('anon')

    expect(mockRefs.rankSemanticDocuments.mock.calls.length).toBeGreaterThan(before)
  })

  it('fails open when semantic ranking throws', async () => {
    mockRefs.rankSemanticDocuments.mockRejectedValue(new Error('model unavailable'))

    let latest = new Map<string, FilterCheckResult>()

    await act(async () => {
      root.render(
        <Harness
          events={[makeEvent('event-1', 'some text')]}
          onResult={(result) => {
            latest = result
          }}
        />,
      )
      await flush()
    })

    await syncFilters()

    expect(mockRefs.rankSemanticDocuments).toHaveBeenCalled()
    expect(latest.size).toBe(0)
  })
})
