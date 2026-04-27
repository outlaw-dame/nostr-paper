import { describe, expect, it } from 'vitest'
import { mergeHybridRankings, classifyQueryIntent } from './hybrid'

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

  it('exposes per-item score breakdown via RankedHybridMatch fields', () => {
    // Single lexical + single semantic match for the same item so normalization
    // maps that item to score=1 on both axes (min===max path in normalizeRelativeScores).
    const lexicalItems = [{ id: 'a', created_at: 100 }]
    const semanticItems = [{ id: 'a', created_at: 100 }]
    const semanticMatches = [{ id: 'a', score: 0.8 }]

    const ranked = mergeHybridRankings(lexicalItems, semanticItems, semanticMatches, 1)

    const aMatch = ranked.find(m => m.item.id === 'a')
    expect(aMatch).toBeDefined()
    // Only item in each list → both normalize to 1
    expect(aMatch!.lexicalScore).toBe(1)
    expect(aMatch!.semanticScore).toBe(1)
    expect(aMatch!.hybridScore).toBeGreaterThan(0)
  })

  it('preserves strong BM25 gaps when relative lexical scores are available', () => {
    const lexicalItems = [
      { id: 'exact-hit', created_at: 100 },
      { id: 'semantic-favorite', created_at: 90 },
    ]
    const semanticItems = [...lexicalItems]
    const semanticMatches = [
      { id: 'semantic-favorite', score: 0.9 },
      { id: 'exact-hit', score: 0.7 },
    ]

    const ranked = mergeHybridRankings(
      lexicalItems,
      semanticItems,
      semanticMatches,
      2,
      {
        lexicalRawScores: new Map([
          ['exact-hit', 10],
          ['semantic-favorite', 1],
        ]),
      },
    )

    expect(ranked.map(match => match.item.id)).toEqual([
      'exact-hit',
      'semantic-favorite',
    ])
  })

  it('applies keyword weights so a strong lexical match beats a stronger semantic match', () => {
    const lexicalItems = [{ id: 'lexical-win', created_at: 100 }]
    const semanticItems = [
      { id: 'lexical-win', created_at: 100 },
      { id: 'semantic-win', created_at: 90 },
    ]
    const semanticMatches = [
      { id: 'semantic-win', score: 0.95 },
      { id: 'lexical-win', score: 0.3 },
    ]

    // keyword weights (0.85/0.15) — lexical dominates
    const ranked = mergeHybridRankings(
      lexicalItems,
      semanticItems,
      semanticMatches,
      2,
      { lexicalWeight: 0.85, semanticWeight: 0.15 },
    )

    expect(ranked[0]?.item.id).toBe('lexical-win')
  })
})

describe('classifyQueryIntent', () => {
  it('classifies single hashtag as keyword', () => {
    expect(classifyQueryIntent('#bitcoin')).toBe('keyword')
  })

  it('classifies multiple hashtags as keyword', () => {
    expect(classifyQueryIntent('#nostr #bitcoin')).toBe('keyword')
  })

  it('classifies @handle as keyword', () => {
    expect(classifyQueryIntent('@alice')).toBe('keyword')
  })

  it('classifies npub as keyword', () => {
    expect(classifyQueryIntent('npub1aaaaaaaaaaaaaaaaaaaaaaaaa')).toBe('keyword')
  })

  it('classifies quoted phrase as keyword', () => {
    expect(classifyQueryIntent('"exact phrase search"')).toBe('keyword')
  })

  it('classifies 2-token plain query as keyword', () => {
    expect(classifyQueryIntent('bitcoin lightning')).toBe('keyword')
  })

  it('classifies 3–5 token plain query as balanced', () => {
    expect(classifyQueryIntent('bitcoin lightning network')).toBe('balanced')
    expect(classifyQueryIntent('posts about nostr development')).toBe('balanced')
  })

  it('classifies 6+ token sentence as semantic', () => {
    expect(classifyQueryIntent('what is happening with bitcoin adoption today')).toBe('semantic')
  })

  it('ignores domain: extension keys when counting tokens', () => {
    // "domain:foo.com" is an extension key — stripped before counting
    // leaving just "bitcoin" (1 token) → keyword
    expect(classifyQueryIntent('domain:foo.com bitcoin')).toBe('keyword')
  })
})

describe('autocut behavior via mergeHybridRankings', () => {
  it('tail items absent from semanticMatches are excluded from results (simulates autocut)', () => {
    // Simulates the state after autocutSemanticMatches removes the tail:
    // tail-1 and tail-2 are in semanticItems (candidate pool) but NOT in
    // semanticMatches, so they get semanticScore=0. With no lexical score either,
    // their hybridScore=0 and they are filtered out of results.
    const lexicalItems = [{ id: 'lex-hit', created_at: 100 }]
    const semanticItems = [
      { id: 'lex-hit', created_at: 100 },
      { id: 'sem-top', created_at: 90 },
      { id: 'tail-1', created_at: 70 },
      { id: 'tail-2', created_at: 60 },
    ]
    // tail-1 and tail-2 removed by autocut — not present in semanticMatches
    const semanticMatches = [
      { id: 'sem-top', score: 0.9 },
      { id: 'lex-hit', score: 0.5 },
    ]

    const ranked = mergeHybridRankings(lexicalItems, semanticItems, semanticMatches, 4)
    const ids = ranked.map(m => m.item.id)

    expect(ids).toContain('lex-hit')
    // sem-top: normalized semantic score = 1 (max), passes MIN_SEMANTIC_ONLY_SCORE
    expect(ids).toContain('sem-top')
    // tail items: no lexical score, not in semanticMatches → hybridScore=0 → excluded
    expect(ids).not.toContain('tail-1')
    expect(ids).not.toContain('tail-2')
  })
})
