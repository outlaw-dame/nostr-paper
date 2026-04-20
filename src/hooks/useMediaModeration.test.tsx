// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaModerationDecision, MediaModerationDocument } from '@/types'
import { useMediaModerationDocument, useMediaModerationDocuments } from './useMediaModeration'

const moderateMediaDocumentsMock = vi.fn<
  (documents: MediaModerationDocument[], signal?: AbortSignal) => Promise<MediaModerationDecision[]>
>()

vi.mock('@/lib/moderation/mediaClient', () => ({
  moderateMediaDocuments: (...args: unknown[]) => moderateMediaDocumentsMock(...args as Parameters<typeof moderateMediaDocumentsMock>),
}))

function makeDoc(id: string, url = 'https://cdn.example.com/a.jpg', updatedAt = 1): MediaModerationDocument {
  return {
    id,
    kind: 'image',
    url,
    updatedAt,
  }
}

function makeDecision(id: string, action: 'allow' | 'block'): MediaModerationDecision {
  return {
    id,
    action,
    reason: action === 'block' ? 'nsfw' : null,
    scores: { nsfw: action === 'block' ? 0.99 : 0.01, violence: 0.02 },
    nsfwModel: 'nsfw-test',
    violenceModel: 'violence-test',
    policyVersion: 'v1',
  }
}

type DocsSnapshot = ReturnType<typeof useMediaModerationDocuments>

function DocsHarness({
  docs,
  enabled,
  failClosed,
  onSnapshot,
}: {
  docs: MediaModerationDocument[]
  enabled?: boolean
  failClosed?: boolean
  onSnapshot: (value: DocsSnapshot) => void
}) {
  const options: { enabled?: boolean; failClosed?: boolean } = {}
  if (enabled !== undefined) options.enabled = enabled
  if (failClosed !== undefined) options.failClosed = failClosed
  const state = useMediaModerationDocuments(docs, options)

  useEffect(() => {
    onSnapshot(state)
  }, [state, onSnapshot])

  return null
}

type SingleSnapshot = ReturnType<typeof useMediaModerationDocument>

function SingleHarness({
  doc,
  enabled,
  failClosed,
  onSnapshot,
}: {
  doc: MediaModerationDocument | null
  enabled?: boolean
  failClosed?: boolean
  onSnapshot: (value: SingleSnapshot) => void
}) {
  const options: { enabled?: boolean; failClosed?: boolean } = {}
  if (enabled !== undefined) options.enabled = enabled
  if (failClosed !== undefined) options.failClosed = failClosed
  const state = useMediaModerationDocument(doc, options)

  useEffect(() => {
    onSnapshot(state)
  }, [state, onSnapshot])

  return null
}

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('useMediaModeration hooks', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    moderateMediaDocumentsMock.mockReset()
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.clearAllMocks()
  })

  it('returns empty state when disabled or no documents are provided', async () => {
    let latest: DocsSnapshot | null = null

    await act(async () => {
      root.render(
        <DocsHarness
          docs={[]}
          enabled={false}
          onSnapshot={(value) => {
            latest = value
          }}
        />,
      )
      await flush()
    })

    expect(moderateMediaDocumentsMock).not.toHaveBeenCalled()
    expect(latest).not.toBeNull()
    expect(latest!.loading).toBe(false)
    expect(latest!.allowedIds.size).toBe(0)
    expect(latest!.blockedIds.size).toBe(0)
  })

  it('computes blocked/allowed ids from moderation results', async () => {
    moderateMediaDocumentsMock.mockResolvedValue([
      makeDecision('a', 'allow'),
      makeDecision('b', 'block'),
    ])

    let latest: DocsSnapshot | null = null

    await act(async () => {
      root.render(
        <DocsHarness
          docs={[makeDoc('a'), makeDoc('b', 'https://cdn.example.com/b.jpg')]}
          onSnapshot={(value) => {
            latest = value
          }}
        />,
      )
      await flush()
    })

    expect(moderateMediaDocumentsMock).toHaveBeenCalledTimes(1)
    expect(latest).not.toBeNull()
    expect(latest!.loading).toBe(false)
    expect(latest!.allowedIds.has('a')).toBe(true)
    expect(latest!.blockedIds.has('b')).toBe(true)
  })

  it('uses fail-open on moderation error by default, and fail-closed when requested', async () => {
    moderateMediaDocumentsMock.mockRejectedValue(new Error('moderation worker unavailable'))

    let latest: DocsSnapshot | null = null

    await act(async () => {
      root.render(
        <DocsHarness
          docs={[makeDoc('a', 'https://cdn.example.com/error-a.jpg', 101)]}
          onSnapshot={(value) => {
            latest = value
          }}
        />,
      )
      await flush()
    })

    expect(latest).not.toBeNull()
    expect(latest!.error).toBe('moderation worker unavailable')
    expect(latest!.allowedIds.has('a')).toBe(true)
    expect(latest!.blockedIds.has('a')).toBe(false)

    await act(async () => {
      root.render(
        <DocsHarness
          docs={[makeDoc('a', 'https://cdn.example.com/error-b.jpg', 102)]}
          failClosed
          onSnapshot={(value) => {
            latest = value
          }}
        />,
      )
      await flush()
    })

    expect(latest).not.toBeNull()
    expect(latest!.blockedIds.has('a')).toBe(true)
    expect(latest!.allowedIds.has('a')).toBe(false)
  })

  it('reuses cache for same media key and avoids duplicate moderation requests', async () => {
    moderateMediaDocumentsMock.mockResolvedValue([makeDecision('a', 'allow')])

    let latest: DocsSnapshot | null = null

    await act(async () => {
      root.render(
        <DocsHarness
          docs={[makeDoc('a', 'https://cdn.example.com/shared.jpg', 99)]}
          onSnapshot={(value) => {
            latest = value
          }}
        />,
      )
      await flush()
    })

    expect(moderateMediaDocumentsMock).toHaveBeenCalledTimes(1)
    expect(latest).not.toBeNull()
    expect(latest!.allowedIds.has('a')).toBe(true)

    await act(async () => {
      root.render(
        <DocsHarness
          docs={[makeDoc('b', 'https://cdn.example.com/shared.jpg', 99)]}
          onSnapshot={(value) => {
            latest = value
          }}
        />,
      )
      await flush()
    })

    expect(moderateMediaDocumentsMock).toHaveBeenCalledTimes(1)
    expect(latest).not.toBeNull()
    expect(latest!.allowedIds.has('b')).toBe(true)
  })

  it('maps single-document wrapper state correctly', async () => {
    moderateMediaDocumentsMock.mockResolvedValue([makeDecision('single', 'block')])

    let latest: SingleSnapshot | null = null

    await act(async () => {
      root.render(
        <SingleHarness
          doc={makeDoc('single', 'https://cdn.example.com/single-block.jpg', 777)}
          onSnapshot={(value) => {
            latest = value
          }}
        />,
      )
      await flush()
    })

    expect(latest).not.toBeNull()
    expect(latest!.loading).toBe(false)
    expect(latest!.blocked).toBe(true)
    expect(latest!.decision?.action).toBe('block')

    await act(async () => {
      root.render(
        <SingleHarness
          doc={null}
          onSnapshot={(value) => {
            latest = value
          }}
        />,
      )
      await flush()
    })

    expect(latest).not.toBeNull()
    expect(latest!.blocked).toBe(false)
    expect(latest!.decision).toBeNull()
  })
})
