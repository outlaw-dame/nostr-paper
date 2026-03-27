import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSearch, type SearchOptions } from './useSearch'
import type { NostrEvent, Profile } from '@/types'
import { hybridSearchEvents, hybridSearchProfiles } from '@/lib/search/hybrid'
import { searchRelays } from '@/lib/nostr/search'

vi.mock('@/lib/search/hybrid', () => ({
  hybridSearchEvents: vi.fn(),
  hybridSearchProfiles: vi.fn(),
}))

vi.mock('@/lib/nostr/search', () => ({
  parseSearchQuery: (query: string) => ({
    relayQuery: query.trim() || null,
    localQuery: query.trim() || null,
    domains: [],
    unsupportedExtensions: [],
  }),
  searchRelays: vi.fn(),
}))

interface SearchSnapshot {
  events: NostrEvent[]
  profiles: Profile[]
  localLoading: boolean
  relayLoading: boolean
  relayError: string | null
  semanticError: string | null
}

interface HarnessProps {
  options: SearchOptions
  input: string
  onSnapshot: (snapshot: SearchSnapshot) => void
}

function Harness({ options, input, onSnapshot }: HarnessProps) {
  const state = useSearch(options)

  useEffect(() => {
    state.setInput(input)
  }, [input, state])

  useEffect(() => {
    onSnapshot({
      events: state.events,
      profiles: state.profiles,
      localLoading: state.localLoading,
      relayLoading: state.relayLoading,
      relayError: state.relayError,
      semanticError: state.semanticError,
    })
  }, [
    onSnapshot,
    state.events,
    state.profiles,
    state.localLoading,
    state.relayLoading,
    state.relayError,
    state.semanticError,
  ])

  return null
}

function makeEvent(id: string, content: string, createdAt: number): NostrEvent {
  return {
    id,
    pubkey: 'a'.repeat(64),
    created_at: createdAt,
    kind: 1,
    tags: [['t', 'apple']],
    content,
    sig: 'b'.repeat(128),
  }
}

const flushAsync = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('useSearch', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('reranks semantically even when relay search fails', async () => {
    vi.useFakeTimers()

    const lexicalEvent = makeEvent('event-1', 'Apple launches new device', 1_710_000_000)

    const hybridEventsMock = vi.mocked(hybridSearchEvents)
    const hybridProfilesMock = vi.mocked(hybridSearchProfiles)
    const searchRelaysMock = vi.mocked(searchRelays)

    hybridEventsMock.mockImplementation(async (_query, options) => {
      if (options?.lexicalOnly) {
        return {
          items: [lexicalEvent],
          semanticUsed: false,
          semanticError: null,
        }
      }

      return {
        items: [lexicalEvent],
        semanticUsed: true,
        semanticError: null,
      }
    })

    hybridProfilesMock.mockResolvedValue({
      items: [] as Profile[],
      semanticUsed: true,
      semanticError: null,
    })

    searchRelaysMock.mockRejectedValue(new Error('relay down'))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)

    let latestSnapshot: SearchSnapshot = {
      events: [],
      profiles: [],
      localLoading: false,
      relayLoading: false,
      relayError: null,
      semanticError: null,
    }

    await act(async () => {
      root.render(
        <Harness
          options={{ debounceMs: 0, localOnly: false, localLimit: 10, relayLimit: 10 }}
          input="apple"
          onSnapshot={(snapshot) => {
            latestSnapshot = snapshot
          }}
        />,
      )
    })

    await act(async () => {
      vi.runAllTimers()
      await flushAsync()
    })

    await act(async () => {
      await flushAsync()
    })

    const rerankCalls = hybridEventsMock.mock.calls.filter(([, options]) => !options?.lexicalOnly)

    expect(hybridEventsMock).toHaveBeenCalledWith(
      'apple',
      expect.objectContaining({ lexicalOnly: true }),
    )
    expect(rerankCalls.length).toBeGreaterThan(0)
    expect(searchRelaysMock).toHaveBeenCalledTimes(1)

    expect(latestSnapshot.relayError).toBe('relay down')
    expect(latestSnapshot.events.map((event: NostrEvent) => event.id)).toContain('event-1')

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })
})
