// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { usePublishEvent, type PublishStatus } from './usePublishEvent'

interface Snapshot {
  status: PublishStatus
  publishedId: string | null
  error: string | null
  isPublishing: boolean
}

interface HookApi {
  publish: ReturnType<typeof usePublishEvent>['publish']
  reset: ReturnType<typeof usePublishEvent>['reset']
}

function Harness({
  onSnapshot,
  onApi,
}: {
  onSnapshot: (snapshot: Snapshot) => void
  onApi: (api: HookApi) => void
}) {
  const { status, publishedId, error, isPublishing, publish, reset } = usePublishEvent()

  useEffect(() => {
    onSnapshot({ status, publishedId, error, isPublishing })
  }, [error, isPublishing, onSnapshot, publishedId, status])

  useEffect(() => {
    onApi({ publish, reset })
  }, [onApi, publish, reset])

  return null
}

describe('usePublishEvent', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
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
  })

  it('starts in idle state', async () => {
    let latest: Snapshot = { status: 'idle', publishedId: null, error: null, isPublishing: false }

    await act(async () => {
      if (!root) throw new Error('Root not initialized')
      root.render(
        <Harness
          onSnapshot={(snapshot) => { latest = snapshot }}
          onApi={() => {}}
        />,
      )
      await Promise.resolve()
    })

    expect(latest).toEqual({
      status: 'idle',
      publishedId: null,
      error: null,
      isPublishing: false,
    })
  })

  it('publishes successfully and stores event id', async () => {
    let latest: Snapshot = { status: 'idle', publishedId: null, error: null, isPublishing: false }
    let api: HookApi | null = null

    await act(async () => {
      if (!root) throw new Error('Root not initialized')
      root.render(
        <Harness
          onSnapshot={(snapshot) => { latest = snapshot }}
          onApi={(nextApi) => { api = nextApi }}
        />,
      )
      await Promise.resolve()
    })

    let id: string | null = null
    await act(async () => {
      if (!api) throw new Error('Hook API missing')
      id = await api.publish(async () => ({ id: 'evt-123' }))
    })

    expect(id).toBe('evt-123')
    expect(latest).toEqual({
      status: 'done',
      publishedId: 'evt-123',
      error: null,
      isPublishing: false,
    })
  })

  it('captures action errors and exposes a user-facing error message', async () => {
    let latest: Snapshot = { status: 'idle', publishedId: null, error: null, isPublishing: false }
    let api: HookApi | null = null

    await act(async () => {
      if (!root) throw new Error('Root not initialized')
      root.render(
        <Harness
          onSnapshot={(snapshot) => { latest = snapshot }}
          onApi={(nextApi) => { api = nextApi }}
        />,
      )
      await Promise.resolve()
    })

    let id: string | null = 'unexpected'
    await act(async () => {
      if (!api) throw new Error('Hook API missing')
      id = await api.publish(async () => {
        throw new Error('relay timeout')
      })
    })

    expect(id).toBeNull()
    expect(latest.status).toBe('error')
    expect(latest.error).toBe('relay timeout')
    expect(latest.isPublishing).toBe(false)
  })

  it('aborts in-flight publish on reset and returns to idle', async () => {
    let latest: Snapshot = { status: 'idle', publishedId: null, error: null, isPublishing: false }
    let api: HookApi | null = null
    let observedSignal: AbortSignal | null = null

    await act(async () => {
      if (!root) throw new Error('Root not initialized')
      root.render(
        <Harness
          onSnapshot={(snapshot) => { latest = snapshot }}
          onApi={(nextApi) => { api = nextApi }}
        />,
      )
      await Promise.resolve()
    })

    let publishPromise: Promise<string | null> | null = null
    await act(async () => {
      if (!api) throw new Error('Hook API missing')
      publishPromise = api.publish((signal) => {
        observedSignal = signal
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          }, { once: true })
        })
      })
      await Promise.resolve()
    })

    expect(latest.status).toBe('publishing')
    if (observedSignal === null) throw new Error('Expected publish signal to be set')

    await act(async () => {
      if (!api) throw new Error('Hook API missing')
      api.reset()
      await Promise.resolve()
    })

    expect(latest).toEqual({
      status: 'idle',
      publishedId: null,
      error: null,
      isPublishing: false,
    })

    expect(await publishPromise).toBeNull()
  })

  it('aborts prior publish when a new publish starts', async () => {
    let api: HookApi | null = null

    await act(async () => {
      if (!root) throw new Error('Root not initialized')
      root.render(
        <Harness
          onSnapshot={() => {}}
          onApi={(nextApi) => { api = nextApi }}
        />,
      )
      await Promise.resolve()
    })

    const getApi = (): HookApi => {
      if (!api) throw new Error('Hook API missing')
      return api
    }

    const firstPublish = getApi().publish((signal: AbortSignal) => {
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      })
    })

    let secondId: string | null = null
    await act(async () => {
      secondId = await getApi().publish(async () => ({ id: 'evt-456' }))
    })

    expect(await firstPublish).toBeNull()
    expect(secondId).toBe('evt-456')
  })
})
