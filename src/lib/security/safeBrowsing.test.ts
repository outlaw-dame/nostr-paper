import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkSafeBrowsingURL, peekSafeBrowsingDecision } from './safeBrowsing'

describe('safeBrowsing', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects unsafe URL schemes before contacting the proxy', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(checkSafeBrowsingURL('javascript:alert(1)')).resolves.toBe(false)
    expect(peekSafeBrowsingDecision('javascript:alert(1)')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails open by default for compatibility when the proxy is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network offline')))

    await expect(checkSafeBrowsingURL('https://example.com/default-open')).resolves.toBe(true)
  })

  it('can fail closed for passive preview fetches when the proxy is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network offline')))

    await expect(checkSafeBrowsingURL('https://example.com/fail-closed', { failOpen: false })).resolves.toBe(false)
  })

  it('keeps fail-open and fail-closed cache entries separate', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('first outage'))
      .mockRejectedValueOnce(new TypeError('second outage'))
    vi.stubGlobal('fetch', fetchMock)

    const url = 'https://example.com/cache-mode-boundary'
    await expect(checkSafeBrowsingURL(url)).resolves.toBe(true)
    await expect(checkSafeBrowsingURL(url, { failOpen: false })).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
