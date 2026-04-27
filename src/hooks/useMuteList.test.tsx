// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMuteList, type UseMuteListResult } from './useMuteList'

const userPubkey = 'a'.repeat(64)

let currentUser: { pubkey: string } | null = { pubkey: userPubkey }
let remoteTags: string[][] = []
const fetchEventMock = vi.fn<() => Promise<{ tags: string[][] } | null>>()
const publishedSnapshots: string[][][] = []

vi.mock('@/contexts/app-context', () => ({
  useApp: () => ({ currentUser }),
}))

vi.mock('@/lib/nostr/ndk', () => ({
  getNDK: () => ({ fetchEvent: fetchEventMock }),
}))

vi.mock('@/lib/retry', () => ({
  withRetry: async <T,>(fn: () => Promise<T>) => fn(),
}))

vi.mock('@nostr-dev-kit/ndk', () => {
  class MockNDKUser {
    pubkey: string

    constructor(input: { pubkey: string }) {
      this.pubkey = input.pubkey
    }
  }

  class MockNDKEvent {
    kind = 0
    author: MockNDKUser | null = null
    tags: string[][] = []

    async publish() {
      remoteTags = this.tags.map((tag) => [...tag])
      publishedSnapshots.push(remoteTags.map((tag) => [...tag]))
    }
  }

  return {
    NDKEvent: MockNDKEvent,
    NDKUser: MockNDKUser,
  }
})

function Harness({ onSnapshot }: { onSnapshot: (result: UseMuteListResult) => void }) {
  const result = useMuteList()

  useEffect(() => {
    onSnapshot(result)
  }, [result, onSnapshot])

  return null
}

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('useMuteList', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  let latest: UseMuteListResult | null = null

  beforeEach(() => {
    currentUser = { pubkey: userPubkey }
    remoteTags = []
    publishedSnapshots.length = 0
    window.localStorage.clear()

    fetchEventMock.mockReset()
    fetchEventMock.mockImplementation(async () => ({
      tags: remoteTags.map((tag) => [...tag]),
    }))

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

  it('loads pubkeys, words, and hashtags from kind 10000 tags', async () => {
    remoteTags = [
      ['p', userPubkey],
      ['word', '  Spam  '],
      ['word', 'spam'],
      ['t', '#Nostr'],
      ['t', 'nostr'],
    ]

    await act(async () => {
      root?.render(
        <Harness
          onSnapshot={(result) => {
            latest = result
          }}
        />,
      )
      await flush()
    })

    expect(latest).not.toBeNull()
    expect(latest?.mutedPubkeys.has(userPubkey)).toBe(true)
    expect(latest?.mutedWords.has('spam')).toBe(true)
    expect(latest?.mutedHashtags.has('nostr')).toBe(true)
  })

  it('publishes word/hashtag updates while preserving unmanaged tags', async () => {
    remoteTags = [
      ['p', userPubkey],
      ['e', 'event-ref-to-preserve'],
    ]

    await act(async () => {
      root?.render(
        <Harness
          onSnapshot={(result) => {
            latest = result
          }}
        />,
      )
      await flush()
    })

    await act(async () => {
      await latest?.muteWord('SCAM')
      await latest?.muteHashtag('#Bitcoin')
      await flush()
    })

    const lastPublished = publishedSnapshots[publishedSnapshots.length - 1]
    expect(lastPublished).toEqual(expect.arrayContaining([
      ['p', userPubkey],
      ['word', 'scam'],
      ['t', 'bitcoin'],
      ['e', 'event-ref-to-preserve'],
    ]))
  })

  it('serializes concurrent updates to avoid write clobbering', async () => {
    remoteTags = [['p', userPubkey]]

    await act(async () => {
      root?.render(
        <Harness
          onSnapshot={(result) => {
            latest = result
          }}
        />,
      )
      await flush()
    })

    await act(async () => {
      await Promise.all([
        latest?.muteWord('alpha'),
        latest?.muteHashtag('news'),
      ])
      await flush()
    })

    expect(remoteTags).toEqual(expect.arrayContaining([
      ['p', userPubkey],
      ['word', 'alpha'],
      ['t', 'news'],
    ]))
  })

  it('fails fast on invalid mute pubkeys', async () => {
    await act(async () => {
      root?.render(
        <Harness
          onSnapshot={(result) => {
            latest = result
          }}
        />,
      )
      await flush()
    })

    await expect(latest?.mute('not-a-hex-pubkey')).rejects.toThrow('Invalid pubkey')
  })

  it('returns empty state when no current user is available', async () => {
    currentUser = null

    await act(async () => {
      root?.render(
        <Harness
          onSnapshot={(result) => {
            latest = result
          }}
        />,
      )
      await flush()
    })

    expect(latest?.loading).toBe(false)
    expect(latest?.mutedPubkeys.size).toBe(0)
    expect(latest?.mutedWords.size).toBe(0)
    expect(latest?.mutedHashtags.size).toBe(0)
  })

  it('clears state when mute-list event is not found', async () => {
    remoteTags = [
      ['p', userPubkey],
      ['word', 'spam'],
      ['t', 'nostr'],
    ]

    fetchEventMock
      .mockResolvedValueOnce({ tags: remoteTags.map((tag) => [...tag]) })
      .mockResolvedValueOnce(null)

    await act(async () => {
      root?.render(
        <Harness
          onSnapshot={(result) => {
            latest = result
          }}
        />,
      )
      await flush()
    })

    expect(latest?.mutedPubkeys.has(userPubkey)).toBe(true)

    await act(async () => {
      await latest?.refresh()
      await flush()
    })

    expect(latest?.mutedPubkeys.size).toBe(0)
    expect(latest?.mutedWords.size).toBe(0)
    expect(latest?.mutedHashtags.size).toBe(0)
  })

  it('exposes fetch errors via error state and supports word/hashtag helper methods', async () => {
    fetchEventMock.mockRejectedValue(new Error('relay down'))

    await act(async () => {
      root?.render(
        <Harness
          onSnapshot={(result) => {
            latest = result
          }}
        />,
      )
      await flush()
    })

    expect(latest?.error).toBe('relay down')

    // Recover with a successful refresh and verify helper methods.
    remoteTags = [
      ['word', 'scam'],
      ['t', 'nostr'],
    ]
    fetchEventMock.mockImplementation(async () => ({
      tags: remoteTags.map((tag) => [...tag]),
    }))

    await act(async () => {
      await latest?.refresh()
      await flush()
    })

    expect(latest?.isWordMuted('SCAM')).toBe(true)
    expect(latest?.isHashtagMuted('#Nostr')).toBe(true)

    await act(async () => {
      await latest?.unmuteWord('scam')
      await latest?.unmuteHashtag('#nostr')
      await flush()
    })

    expect(remoteTags.some((tag) => tag[0] === 'word' && tag[1] === 'scam')).toBe(false)
    expect(remoteTags.some((tag) => tag[0] === 't' && tag[1] === 'nostr')).toBe(false)

    await act(async () => {
      await latest?.refresh()
      await flush()
    })

    expect(latest?.isWordMuted('scam')).toBe(false)
    expect(latest?.isHashtagMuted('nostr')).toBe(false)

    await expect(latest?.muteWord('   ')).rejects.toThrow('Invalid word')
    await expect(latest?.muteHashtag('   ')).rejects.toThrow('Invalid hashtag')
    await expect(latest?.unmuteHashtag('   ')).rejects.toThrow('Invalid hashtag')
  })
})
