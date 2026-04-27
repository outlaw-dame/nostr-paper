// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NostrEvent } from '@/types'
import type { FilterCheckResult } from '@/lib/filters/types'
import { useEventCombinedModeration, type EventCombinedModerationResult } from './useEventCombinedModeration'

let moderationState: {
  blocked: boolean
  loading: boolean
  decision: unknown | null
  error: string | null
}

let muteState: {
  isMuted: (pubkey: string) => boolean
  mutedWords: Set<string>
  mutedHashtags: Set<string>
  loading: boolean
}

const checkEventMock = vi.fn<(event: NostrEvent) => FilterCheckResult>()
let semanticResults = new Map<string, FilterCheckResult>()

vi.mock('@/hooks/useModeration', () => ({
  useEventModeration: () => moderationState,
}))

vi.mock('@/hooks/useMuteList', () => ({
  useMuteList: () => muteState,
}))

vi.mock('@/hooks/useKeywordFilters', () => ({
  useEventFilterCheck: () => checkEventMock,
  useSemanticFiltering: () => semanticResults,
  mergeResults: (text: FilterCheckResult, semantic: FilterCheckResult): FilterCheckResult => {
    const matches = [...text.matches, ...semantic.matches]
    if (matches.some((m) => m.action === 'block')) return { action: 'block', matches }
    if (matches.some((m) => m.action === 'hide')) return { action: 'hide', matches }
    if (matches.some((m) => m.action === 'warn')) return { action: 'warn', matches }
    return { action: null, matches: [] }
  },
}))

function makeEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'event-1',
    pubkey: 'a'.repeat(64),
    created_at: 1_710_000_000,
    kind: 1,
    tags: [['t', 'nostr']],
    content: 'Hello world',
    sig: 'b'.repeat(128),
    ...overrides,
  }
}

function Harness({
  event,
  onSnapshot,
}: {
  event: NostrEvent | null
  onSnapshot: (result: EventCombinedModerationResult) => void
}) {
  const result = useEventCombinedModeration(event)

  useEffect(() => {
    onSnapshot(result)
  }, [result, onSnapshot])

  return null
}

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('useEventCombinedModeration', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  let latest: EventCombinedModerationResult | null = null

  beforeEach(() => {
    moderationState = {
      blocked: false,
      loading: false,
      decision: null,
      error: null,
    }

    muteState = {
      isMuted: () => false,
      mutedWords: new Set(),
      mutedHashtags: new Set(),
      loading: false,
    }

    checkEventMock.mockReset()
    checkEventMock.mockReturnValue({ action: null, matches: [] })
    semanticResults = new Map()

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    latest = null
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
    vi.clearAllMocks()
  })

  it('marks blocked when ML moderation blocks the event', async () => {
    moderationState.blocked = true

    await act(async () => {
      root?.render(
        <Harness
          event={makeEvent()}
          onSnapshot={(result) => {
            latest = result
          }}
        />,
      )
      await flush()
    })

    expect(latest?.mlBlocked).toBe(true)
    expect(latest?.blocked).toBe(true)
  })

  it('marks blocked for author mutes, muted words, and muted hashtags', async () => {
    muteState.isMuted = () => true
    muteState.mutedWords = new Set(['danger'])
    muteState.mutedHashtags = new Set(['nostr'])

    await act(async () => {
      root?.render(
        <Harness
          event={makeEvent({ content: 'Danger content here', tags: [['t', 'nostr']] })}
          onSnapshot={(result) => {
            latest = result
          }}
        />,
      )
      await flush()
    })

    expect(latest?.isMutedAuthor).toBe(true)
    expect(latest?.blocked).toBe(true)
  })

  it('merges lexical and semantic keyword results with severity precedence', async () => {
    checkEventMock.mockReturnValue({
      action: 'hide',
      matches: [{
        filterId: 'text-hide',
        term: 'violent',
        action: 'hide',
        field: 'content',
        excerpt: 'violent',
        semantic: false,
      }],
    })

    semanticResults = new Map([
      ['event-1', {
        action: 'block',
        matches: [{
          filterId: 'sem-block',
          term: 'abuse',
          action: 'block',
          field: 'content',
          excerpt: '',
          semantic: true,
        }],
      }],
    ])

    await act(async () => {
      root?.render(
        <Harness
          event={makeEvent({ id: 'event-1' })}
          onSnapshot={(result) => {
            latest = result
          }}
        />,
      )
      await flush()
    })

    expect(latest?.keywordResult.action).toBe('block')
    expect(latest?.keywordResult.matches).toHaveLength(2)
  })

  it('reports loading when either ML or mute list is still loading', async () => {
    moderationState.loading = true
    muteState.loading = false

    await act(async () => {
      root?.render(
        <Harness
          event={makeEvent()}
          onSnapshot={(result) => {
            latest = result
          }}
        />,
      )
      await flush()
    })

    expect(latest?.loading).toBe(true)

    moderationState.loading = false
    muteState.loading = true

    await act(async () => {
      root?.render(
        <Harness
          event={makeEvent()}
          onSnapshot={(result) => {
            latest = result
          }}
        />,
      )
      await flush()
    })

    expect(latest?.loading).toBe(true)
  })

  it('returns unblocked when no subsystem flags the event', async () => {
    await act(async () => {
      root?.render(
        <Harness
          event={makeEvent({ content: 'normal content', tags: [['t', 'safe']] })}
          onSnapshot={(result) => {
            latest = result
          }}
        />,
      )
      await flush()
    })

    expect(latest?.blocked).toBe(false)
    expect(latest?.keywordResult.action).toBeNull()
  })
})
