import { describe, expect, it } from 'vitest'
import { mergeHybridRankings } from './hybrid'

describe('mergeHybridRankings', () => {
  it('prefers exact lexical hits while still admitting semantic-only matches', () => {
    const lexicalItems = [
      { id: 'exact', created_at: 100 },
      { id: 'partial', created_at: 90 },
    ]
    const semanticItems = [
      { id: 'exact', created_at: 100 },
      { id: 'semantic-only', created_at: 110 },
    ]
    const semanticMatches = [
      { id: 'exact', score: 0.7 },
      { id: 'semantic-only', score: 0.95 },
    ]

    const ranked = mergeHybridRankings(lexicalItems, semanticItems, semanticMatches, 3)

    expect(ranked.map(match => match.item.id)).toEqual([
      'exact',
      'semantic-only',
      'partial',
    ])
  })

  it('uses recency as a tie-breaker when hybrid scores match', () => {
    const semanticItems = [
      { id: 'older', created_at: 100 },
      { id: 'newer', created_at: 200 },
    ]
    const semanticMatches = [
      { id: 'older', score: 0.9 },
      { id: 'newer', score: 0.9 },
    ]

    const ranked = mergeHybridRankings([], semanticItems, semanticMatches, 2)

    expect(ranked.map(match => match.item.id)).toEqual(['newer', 'older'])
  })

  it('preserves lexical matches for hashtag-style keyword intent', () => {
    const lexicalItems = [
      { id: 'apple-post', created_at: 10 },
    ]
    const semanticItems = [
      { id: 'apple-post', created_at: 10 },
      { id: 'iphone-semantic', created_at: 120 },
      { id: 'cupertino-semantic', created_at: 110 },
      { id: 'macbook-semantic', created_at: 100 },
    ]
    const semanticMatches = [
      { id: 'iphone-semantic', score: 0.99 },
      { id: 'cupertino-semantic', score: 0.98 },
      { id: 'macbook-semantic', score: 0.97 },
      { id: 'apple-post', score: 0.2 },
    ]

    const ranked = mergeHybridRankings(lexicalItems, semanticItems, semanticMatches, 3)
    const ids = ranked.map(match => match.item.id)

    expect(ids).toContain('apple-post')
    expect(ids).toContain('iphone-semantic')
  })
})
