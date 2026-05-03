import { describe, expect, it } from 'vitest'

import {
  recordSourceExposure,
  summarizeSourceExposure,
} from '@/lib/media/sourceExposure'

function ensureMockStorage() {
  if (globalThis.localStorage) return
  const store = new Map<string, string>()
  const storage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size },
  } as Storage
  ;(globalThis as { localStorage?: Storage }).localStorage = storage
}

function clearExposureStorage() {
  ensureMockStorage()
  globalThis.localStorage?.removeItem('nostr-paper:source-exposure:v1')
}

describe('sourceExposure', () => {
  it('records exposure and summarizes orientation buckets', () => {
    clearExposureStorage()

    recordSourceExposure('https://www.foxnews.com/politics/story', 'trending-link')
    recordSourceExposure('https://www.reuters.com/world/', 'link-preview')

    const summary = summarizeSourceExposure(30)
    expect(summary.total).toBe(2)
    expect(summary.byOrientation.right).toBe(1)
    expect(summary.byOrientation.center).toBe(1)
  })

  it('deduplicates rapid duplicate exposures', () => {
    clearExposureStorage()

    recordSourceExposure('https://www.foxnews.com/politics/story', 'trending-link')
    recordSourceExposure('https://www.foxnews.com/politics/story', 'trending-link')

    const summary = summarizeSourceExposure(30)
    expect(summary.total).toBe(1)
  })
})
