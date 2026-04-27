// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTagTimelineSemanticFeed } from './useTagTimelineSemanticFeed'
import { listSemanticEventCandidates } from '@/lib/db/nostr'
import { rankSemanticDocuments } from '@/lib/semantic/client'
import type { TagTimelineSpec } from '@/lib/feed/tagTimeline'
import { Kind } from '@/types'

vi.mock('@/lib/db/nostr', () => ({
  listSemanticEventCandidates: vi.fn(),
}))

vi.mock('@/lib/semantic/client', () => ({
  rankSemanticDocuments: vi.fn(),
}))

const spec: TagTimelineSpec = {
  includeTags: ['nostr'],
  excludeTags: [],
  mode: 'any',
}

function makeEvent(id: string) {
  return {
    id,
    pubkey: 'a'.repeat(64),
    created_at: 100,
    kind: Kind.ShortNote,
    tags: [['t', 'nostr']],
    content: 'nostr semantic content',
    sig: 'b'.repeat(128),
  }
}

function Harness({ kinds }: { kinds: number[] }) {
  useTagTimelineSemanticFeed(spec, kinds)
  return null
}

const listSemanticEventCandidatesMock = vi.mocked(listSemanticEventCandidates)
const rankSemanticDocumentsMock = vi.mocked(rankSemanticDocuments)

describe('useTagTimelineSemanticFeed', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    listSemanticEventCandidatesMock.mockReset()
    rankSemanticDocumentsMock.mockReset()
    listSemanticEventCandidatesMock.mockResolvedValue([makeEvent('semantic-1')])
    rankSemanticDocumentsMock.mockResolvedValue([{ id: 'semantic-1', score: 0.9 }])
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

  it('does not rerun semantic loading when kinds identity changes but values do not', async () => {
    await act(async () => {
      if (!root) throw new Error('Root not initialized')
      root.render(<Harness kinds={[Kind.ShortNote, Kind.Thread]} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      if (!root) throw new Error('Root not initialized')
      root.render(<Harness kinds={[Kind.ShortNote, Kind.Thread]} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(listSemanticEventCandidatesMock).toHaveBeenCalledTimes(1)
    expect(rankSemanticDocumentsMock).toHaveBeenCalledTimes(1)
  })
})