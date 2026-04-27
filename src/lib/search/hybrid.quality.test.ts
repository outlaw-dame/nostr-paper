import { describe, expect, it } from 'vitest'
import { mergeHybridRankings } from './hybrid'

type Candidate = { id: string; created_at: number }

type QueryFixture = {
  name: string
  lexicalItems: Candidate[]
  semanticItems: Candidate[]
  semanticMatches: Array<{ id: string; score: number }>
  relevantIds: string[]
  expectedTop1: string
  limit: number
}

function dcgAtK(ids: string[], relevant: Set<string>, k: number): number {
  const capped = ids.slice(0, k)
  return capped.reduce((sum, id, index) => {
    const rel = relevant.has(id) ? 1 : 0
    if (rel === 0) return sum
    return sum + (1 / Math.log2(index + 2))
  }, 0)
}

function ndcgAtK(ids: string[], relevant: Set<string>, k: number): number {
  const ideal = new Array(Math.min(k, relevant.size)).fill('rel')
  const idcg = ideal.reduce((sum, _, index) => sum + (1 / Math.log2(index + 2)), 0)
  if (idcg === 0) return 0
  return dcgAtK(ids, relevant, k) / idcg
}

function recallAtK(ids: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0
  const hits = ids.slice(0, k).filter((id) => relevant.has(id)).length
  return hits / relevant.size
}

describe('hybrid search quality metrics', () => {
  const fixtures: QueryFixture[] = [
    {
      name: 'keyword intent preserves exact lexical hit while admitting semantic neighbor',
      lexicalItems: [
        { id: 'apple_exact', created_at: 100 },
        { id: 'apple_partial', created_at: 90 },
      ],
      semanticItems: [
        { id: 'apple_exact', created_at: 100 },
        { id: 'iphone_related', created_at: 120 },
        { id: 'apple_partial', created_at: 90 },
      ],
      semanticMatches: [
        { id: 'iphone_related', score: 0.97 },
        { id: 'apple_exact', score: 0.75 },
        { id: 'apple_partial', score: 0.40 },
      ],
      relevantIds: ['apple_exact', 'iphone_related'],
      expectedTop1: 'apple_exact',
      limit: 3,
    },
    {
      name: 'semantic-heavy query lifts conceptually strong document into top results',
      lexicalItems: [
        { id: 'keyword_only', created_at: 110 },
      ],
      semanticItems: [
        { id: 'keyword_only', created_at: 110 },
        { id: 'concept_match', created_at: 115 },
        { id: 'weak_neighbor', created_at: 105 },
      ],
      semanticMatches: [
        { id: 'concept_match', score: 0.99 },
        { id: 'keyword_only', score: 0.55 },
        { id: 'weak_neighbor', score: 0.52 },
      ],
      relevantIds: ['concept_match', 'keyword_only'],
      expectedTop1: 'keyword_only',
      limit: 3,
    },
    {
      name: 'recall scenario keeps both lexical and semantic relevant hits in top-k',
      lexicalItems: [
        { id: 'nostr_note', created_at: 150 },
        { id: 'nostr_thread', created_at: 140 },
      ],
      semanticItems: [
        { id: 'nostr_note', created_at: 150 },
        { id: 'nostr_thread', created_at: 140 },
        { id: 'relay_scaling', created_at: 160 },
        { id: 'irrelevant_tail', created_at: 130 },
      ],
      semanticMatches: [
        { id: 'relay_scaling', score: 0.96 },
        { id: 'nostr_note', score: 0.72 },
        { id: 'nostr_thread', score: 0.70 },
        { id: 'irrelevant_tail', score: 0.25 },
      ],
      relevantIds: ['nostr_note', 'relay_scaling', 'nostr_thread'],
      expectedTop1: 'nostr_note',
      limit: 4,
    },
  ]

  it('meets ranking quality thresholds (nDCG and recall) across representative fixtures', () => {
    const rows = fixtures.map((fixture) => {
      const ranked = mergeHybridRankings(
        fixture.lexicalItems,
        fixture.semanticItems,
        fixture.semanticMatches,
        fixture.limit,
      )

      const ids = ranked.map((match) => match.item.id)
      const relevant = new Set(fixture.relevantIds)
      const ndcg = ndcgAtK(ids, relevant, fixture.limit)
      const recall = recallAtK(ids, relevant, fixture.limit)

      expect(ids[0]).toBe(fixture.expectedTop1)
      expect(ndcg).toBeGreaterThanOrEqual(0.90)
      expect(recall).toBeGreaterThanOrEqual(0.90)

      return {
        fixture: fixture.name,
        top1: ids[0],
        ndcg: Number(ndcg.toFixed(4)),
        recall: Number(recall.toFixed(4)),
      }
    })

    console.table(rows)
  })

  /**
   * Rewrite-override quality fixture
   *
   * Simulates the LLM query-rewrite path: a conversational query ("what do
   * people think about nostr scaling") rewrites to tighter keywords
   * ("nostr scaling relays throughput"). The fixture uses `semanticQueryOverride`
   * indirectly by modelling the expected semantic score distribution that a
   * tighter query would produce — i.e. more focused high scores on genuinely
   * relevant items.
   *
   * Without the override the vague query would still find the right docs
   * (our baseline is already 1.0), so this fixture instead validates that a
   * rewrite that sharpens scores does NOT hurt ranking — nDCG must stay ≥ 0.90.
   */
  it('rewritten query override does not degrade ranking quality', () => {
    // Scenario: user typed "what do people think about nostr scaling"
    // LLM rewrote it to: "nostr scaling relay throughput performance"
    // Simulated effect: scores for on-topic items are tighter/higher
    const rewriteFixtures: QueryFixture[] = [
      {
        name: 'rewritten semantic query — nostr scaling topic',
        lexicalItems: [
          { id: 'relay_perf', created_at: 200 },
          { id: 'nostr_scaling', created_at: 190 },
        ],
        semanticItems: [
          { id: 'relay_perf', created_at: 200 },
          { id: 'nostr_scaling', created_at: 190 },
          { id: 'relay_limits', created_at: 185 },
          { id: 'unrelated_meme', created_at: 180 },
        ],
        // Tighter rewrite → sharper discrimination between relevant and irrelevant
        semanticMatches: [
          { id: 'relay_perf', score: 0.98 },
          { id: 'nostr_scaling', score: 0.96 },
          { id: 'relay_limits', score: 0.91 },
          { id: 'unrelated_meme', score: 0.18 },
        ],
        relevantIds: ['relay_perf', 'nostr_scaling', 'relay_limits'],
        expectedTop1: 'relay_perf',
        limit: 4,
      },
      {
        name: 'rewritten semantic query — identity and keys topic',
        lexicalItems: [
          { id: 'pubkey_intro', created_at: 300 },
        ],
        semanticItems: [
          { id: 'pubkey_intro', created_at: 300 },
          { id: 'key_management', created_at: 295 },
          { id: 'nsec_bunker', created_at: 290 },
          { id: 'off_topic_price', created_at: 285 },
        ],
        semanticMatches: [
          { id: 'pubkey_intro', score: 0.97 },
          { id: 'key_management', score: 0.95 },
          { id: 'nsec_bunker', score: 0.92 },
          { id: 'off_topic_price', score: 0.15 },
        ],
        relevantIds: ['pubkey_intro', 'key_management', 'nsec_bunker'],
        expectedTop1: 'pubkey_intro',
        limit: 4,
      },
    ]

    const rows = rewriteFixtures.map((fixture) => {
      const ranked = mergeHybridRankings(
        fixture.lexicalItems,
        fixture.semanticItems,
        fixture.semanticMatches,
        fixture.limit,
      )

      const ids = ranked.map((match) => match.item.id)
      const relevant = new Set(fixture.relevantIds)
      const ndcg = ndcgAtK(ids, relevant, fixture.limit)
      const recall = recallAtK(ids, relevant, fixture.limit)

      expect(ids[0]).toBe(fixture.expectedTop1)
      expect(ndcg).toBeGreaterThanOrEqual(0.90)
      expect(recall).toBeGreaterThanOrEqual(0.90)

      return {
        fixture: fixture.name,
        top1: ids[0],
        ndcg: Number(ndcg.toFixed(4)),
        recall: Number(recall.toFixed(4)),
      }
    })

    console.table(rows)
  })
})
