import { describe, expect, it } from 'vitest'

import {
  normalizeNewsDomain,
  orientationLabel,
  resolveSourceLens,
} from '@/lib/media/sourceOrientation'

describe('sourceOrientation', () => {
  it('normalizes domains from full URLs and subdomains', () => {
    expect(normalizeNewsDomain('https://www.nytimes.com/2026/05/01/news.html')).toBe('nytimes.com')
    expect(normalizeNewsDomain('m.bbc.co.uk')).toBe('bbc.co.uk')
  })

  it('resolves known sources and falls back to unknown', () => {
    expect(resolveSourceLens('foxnews.com').orientation).toBe('right')
    expect(resolveSourceLens('https://www.reuters.com/world').orientation).toBe('center')
    expect(resolveSourceLens('example.invalid').orientation).toBe('unknown')
  })

  it('returns human-readable labels', () => {
    expect(orientationLabel('lean-left')).toBe('Leans left')
    expect(orientationLabel('unknown')).toBe('Unknown')
  })
})
