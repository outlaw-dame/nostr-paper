// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useVisibilityOnce } from './useVisibilityOnce'

interface Snapshot {
  visible: boolean
}

function Harness({
  disabled,
  onSnapshot,
}: {
  disabled: boolean
  onSnapshot: (snapshot: Snapshot) => void
}) {
  const { visible } = useVisibilityOnce({ disabled })

  useEffect(() => {
    onSnapshot({ visible })
  }, [onSnapshot, visible])

  return null
}

describe('useVisibilityOnce', () => {
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

  it('re-arms visibility tracking after disabled mode is turned off', async () => {
    let latest: Snapshot = { visible: true }

    await act(async () => {
      if (!root) throw new Error('Root not initialized')
      root.render(<Harness disabled onSnapshot={(snapshot) => { latest = snapshot }} />)
      await Promise.resolve()
    })

    expect(latest.visible).toBe(true)

    await act(async () => {
      if (!root) throw new Error('Root not initialized')
      root.render(<Harness disabled={false} onSnapshot={(snapshot) => { latest = snapshot }} />)
      await Promise.resolve()
    })

    expect(latest.visible).toBe(false)
  })
})