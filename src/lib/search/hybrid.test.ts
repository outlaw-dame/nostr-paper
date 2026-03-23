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
})
