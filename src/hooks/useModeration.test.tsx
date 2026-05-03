// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModerationDecision, ModerationDocument } from '@/types'
import { useModerationDocuments } from './useModeration'

const moderateContentDocumentsMock = vi.fn<
  (documents: ModerationDocument[], signal?: AbortSignal) => Promise<ModerationDecision[]>
>()
const resolveTagrModerationDecisionsMock = vi.fn<
  (documents: ModerationDocument[], signal?: AbortSignal) => Promise<Map<string, ModerationDecision>>
>()

vi.mock('@/lib/moderation/client', () => ({
  moderateContentDocuments: (...args: unknown[]) => moderateContentDocumentsMock(...args as Parameters<typeof moderateContentDocumentsMock>),
}))

vi.mock('@/lib/moderation/tagr', () => ({
  resolveTagrModerationDecisions: (...args: unknown[]) => resolveTagrModerationDecisionsMock(...args as Parameters<typeof resolveTagrModerationDecisionsMock>),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, resolve, reject }
}

function makeDoc(id: string): ModerationDocument {
  return {
    id,
    kind: 'event',
    text: `moderation test document ${id}`,
    updatedAt: 1,
  }
}

function makeDecision(id: string, action: 'allow' | 'block'): ModerationDecision {
  return {
    id,
    action,
    reason: action === 'block' ? 'threat' : null,
    scores: {
      toxic: action === 'block' ? 0.9 : 0,
      severe_toxic: 0,
      obscene: 0,
      threat: action === 'block' ? 0.9 : 0,
      insult: 0,
      identity_hate: 0,
    },
    model: 'moderation-test',
    policyVersion: 'test-v1',
  }
}

type DocsSnapshot = ReturnType<typeof useModerationDocuments>

function DocsHarness({
  docs,
  failClosed,
  onSnapshot,
}: {
  docs: ModerationDocument[]
  failClosed?: boolean
  onSnapshot: (value: DocsSnapshot) => void
}) {
  const options: { failClosed?: boolean } = {}
  if (failClosed !== undefined) options.failClosed = failClosed
  const state = useModerationDocuments(docs, options)

  useEffect(() => {
    onSnapshot(state)
  }, [state, onSnapshot])

  return null
}

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('useModerationDocuments', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    moderateContentDocumentsMock.mockReset()
    resolveTagrModerationDecisionsMock.mockReset()
    resolveTagrModerationDecisionsMock.mockResolvedValue(new Map())
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.clearAllMocks()
  })

  it('keeps fail-closed lists hidden while moderation is pending', async () => {
    const pending = deferred<ModerationDecision[]>()
    moderateContentDocumentsMock.mockReturnValue(pending.promise)

    let latest: DocsSnapshot | null = null

    await act(async () => {
      root.render(
        <DocsHarness
          docs={[makeDoc('pending-a')]}
          failClosed
          onSnapshot={(value) => {
            latest = value
          }}
        />,
      )
      await flush()
    })

    expect(latest).not.toBeNull()
    expect(latest!.loading).toBe(true)
    expect(latest!.allowedIds.has('pending-a')).toBe(false)

    await act(async () => {
      pending.resolve([makeDecision('pending-a', 'allow')])
      await flush()
    })

    expect(latest!.loading).toBe(false)
    expect(latest!.allowedIds.has('pending-a')).toBe(true)
  })

  it('treats missing successful decisions as allow decisions', async () => {
    moderateContentDocumentsMock.mockResolvedValue([makeDecision('partial-a', 'allow')])

    let latest: DocsSnapshot | null = null

    await act(async () => {
      root.render(
        <DocsHarness
          docs={[makeDoc('partial-a'), makeDoc('partial-b')]}
          failClosed
          onSnapshot={(value) => {
            latest = value
          }}
        />,
      )
      await flush()
    })

    expect(latest).not.toBeNull()
    expect(latest!.loading).toBe(false)
    expect(latest!.allowedIds.has('partial-a')).toBe(true)
    expect(latest!.allowedIds.has('partial-b')).toBe(true)
    expect(latest!.decisions.get('partial-b')?.action).toBe('allow')
  })

  it('fails open on moderation worker errors even when loading is fail-closed', async () => {
    moderateContentDocumentsMock.mockRejectedValue(new Error('moderation unavailable'))

    let latest: DocsSnapshot | null = null

    await act(async () => {
      root.render(
        <DocsHarness
          docs={[makeDoc('error-a')]}
          failClosed
          onSnapshot={(value) => {
            latest = value
          }}
        />,
      )
      await flush()
    })

    expect(latest).not.toBeNull()
    expect(latest!.error).toBe('moderation unavailable')
    expect(latest!.allowedIds.has('error-a')).toBe(true)
    expect(latest!.blockedIds.has('error-a')).toBe(false)
  })
})
