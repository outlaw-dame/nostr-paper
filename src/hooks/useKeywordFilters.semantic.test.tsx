import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NostrEvent } from '@/types'
import type { FilterCheckResult, KeywordFilter } from '@/lib/filters/types'
import { useSemanticFiltering } from './useKeywordFilters'

const mockRefs = vi.hoisted(() => {
  const refs = {
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

  refs.loadFilters.mockImplementation(async () => refs.currentFilters)
  return refs
})

vi.mock('@/lib/filters/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/filters/storage')>('@/lib/filters/storage')
  return {
    ...actual,
    loadFilters: mockRefs.loadFilters,
    createFilter: vi.fn(),
    updateFilter: vi.fn(),
    deleteFilter: vi.fn(),
  }
})

vi.mock('@/lib/semantic/client', () => ({
  rankSemanticDocuments: mockRefs.rankSemanticDocuments,
}))

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

    expect(mockRefs.rankSemanticDocuments).toHaveBeenCalled()
    expect(latest.get('event-1')?.action).toBe('hide')
    expect(latest.get('event-1')?.matches[0]?.semantic).toBe(true)
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
})
