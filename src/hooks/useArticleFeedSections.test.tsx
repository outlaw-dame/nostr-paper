// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useArticleFeedSections } from './useArticleFeedSections'
import { getFollows } from '@/lib/db/nostr'

vi.mock('@/lib/db/nostr', () => ({
  getFollows: vi.fn(),
}))

interface Snapshot {
  followingCount: number
  loading: boolean
  sectionIds: string[]
}

function Harness({
  pubkey,
  onSnapshot,
}: {
  pubkey: string | null
  onSnapshot: (snapshot: Snapshot) => void
}) {
  const { sections, followingCount, loading } = useArticleFeedSections(pubkey, [])

  useEffect(() => {
    onSnapshot({
      followingCount,
      loading,
      sectionIds: sections.map((section) => section.id),
    })
  }, [followingCount, loading, onSnapshot, sections])

  return null
}

const getFollowsMock = vi.mocked(getFollows)

describe('useArticleFeedSections', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    getFollowsMock.mockReset()
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

  it('refreshes followed profiles when the window regains focus', async () => {
    getFollowsMock
      .mockResolvedValueOnce(['a'.repeat(64)])
      .mockResolvedValueOnce(['a'.repeat(64), 'b'.repeat(64)])

    let latest: Snapshot = {
      followingCount: 0,
      loading: true,
      sectionIds: [],
    }

    await act(async () => {
      if (!root) throw new Error('Root not initialized')
      root.render(
        <Harness
          pubkey={'c'.repeat(64)}
          onSnapshot={(snapshot) => { latest = snapshot }}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(latest.followingCount).toBe(1)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getFollowsMock).toHaveBeenCalledTimes(2)
    expect(latest.followingCount).toBe(2)
  })
})