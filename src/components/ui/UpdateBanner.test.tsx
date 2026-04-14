import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { UpdateBanner, OfflineBanner } from './UpdateBanner'

describe('UpdateBanner and OfflineBanner UI', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  async function renderMarkup(element: JSX.Element): Promise<string> {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(element)
    })

    return container.innerHTML
  }

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

  it('renders UpdateBanner with safe area and controls', () => {
    return renderMarkup(<UpdateBanner />).then((html) => {
      expect(html).toContain('top-safe')
      expect(html).toContain('Update available')
      expect(html).toContain('Later')
      expect(html).toContain('Update')
      expect(html).toContain('type="button"')
    })

  })

  it('renders OfflineBanner with safe area and status text', () => {
    return renderMarkup(<OfflineBanner />).then((html) => {
      expect(html).toContain('top-safe')
      expect(html).toContain('Offline — showing cached content')
    })
  })
})
