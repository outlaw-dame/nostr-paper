import { renderToStaticMarkup } from 'react-dom/server'
import { UpdateBanner, OfflineBanner } from './UpdateBanner'

describe('UpdateBanner and OfflineBanner UI', () => {
  it('renders UpdateBanner with safe area and controls', () => {
    const html = renderToStaticMarkup(<UpdateBanner />)

    expect(html).toContain('top-safe')
    expect(html).toContain('Update available')
    expect(html).toContain('Later')
    expect(html).toContain('Update')
    expect(html).toContain('type="button"')
  })

  it('renders OfflineBanner with safe area and status text', () => {
    const html = renderToStaticMarkup(<OfflineBanner />)

    expect(html).toContain('top-safe')
    expect(html).toContain('Offline — showing cached content')
  })
})
