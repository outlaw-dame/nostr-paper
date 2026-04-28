/**
 * Hybrid Search — Relevance Benchmark
 *
 * Measures ranking quality (NDCG@K, Precision@K) of mergeHybridRankings
 * against synthetic test cases with explicit ground-truth relevance labels.
 *
 * Run:  npx vitest run src/lib/search/benchmark.test.ts
 *       npx vitest run src/lib/search/benchmark.test.ts --reporter verbose
 *
 * Score interpretation:
 *   NDCG@K — 1.0 is perfect, 0.0 is worst. >0.8 is excellent.
 *   P@K    — fraction of top-K results that are relevant.
 */

import { describe, it, expect } from 'vitest'
import { mergeHybridRankings, type RankedHybridMatch } from './hybrid'

// ── Helpers ─────────────────────────────────────────────────

/**
 * Discounted Cumulative Gain @ K.
 * relevanceById maps id → relevance score (0 = irrelevant, 1 = relevant, 2 = highly relevant).
 */
function dcgAtK(ranked: RankedHybridMatch<{ id: string }>[], relevanceById: Map<string, number>, k: number): number {
  let dcg = 0
  const limit = Math.min(k, ranked.length)
  for (let i = 0; i < limit; i++) {
    const rel = relevanceById.get(ranked[i]!.item.id) ?? 0
    dcg += (Math.pow(2, rel) - 1) / Math.log2(i + 2)
  }
  return dcg
}

/**
 * Ideal DCG @ K — computed from ground-truth sorted by relevance descending.
 */
function idcgAtK(relevanceById: Map<string, number>, k: number): number {
  const sorted = [...relevanceById.values()].sort((a, b) => b - a)
  let idcg = 0
  const limit = Math.min(k, sorted.length)
  for (let i = 0; i < limit; i++) {
    idcg += (Math.pow(2, sorted[i]!) - 1) / Math.log2(i + 2)
  }
  return idcg
}

function ndcgAtK(ranked: RankedHybridMatch<{ id: string }>[], relevanceById: Map<string, number>, k: number): number {
  const ideal = idcgAtK(relevanceById, k)
  if (ideal === 0) return 1
  return dcgAtK(ranked, relevanceById, k) / ideal
}

function precisionAtK(ranked: RankedHybridMatch<{ id: string }>[], relevanceById: Map<string, number>, k: number): number {
  const limit = Math.min(k, ranked.length)
  if (limit === 0) return 0
  let hits = 0
  for (let i = 0; i < limit; i++) {
    if ((relevanceById.get(ranked[i]!.item.id) ?? 0) > 0) hits++
  }
  return hits / limit
}

type BenchmarkItem = { id: string; created_at: number }

interface BenchmarkCase {
  name: string
  lexicalItems: BenchmarkItem[]
  semanticItems: BenchmarkItem[]
  semanticMatches: { id: string; score: number }[]
  /** id → relevance grade (0 = irrelevant, 1 = relevant, 2 = highly relevant) */
  groundTruth: Record<string, number>
  limit: number
  /** Minimum acceptable NDCG@limit */
  minNdcg: number
  /** Minimum acceptable Precision@3 */
  minP3: number
}

// ── Benchmark Cases ──────────────────────────────────────────

const CASES: BenchmarkCase[] = [
  {
    name: 'exact-match dominates with supporting semantic hits',
    lexicalItems: [
      { id: 'exact-1', created_at: 200 },
      { id: 'exact-2', created_at: 180 },
    ],
    semanticItems: [
      { id: 'exact-1', created_at: 200 },
      { id: 'exact-2', created_at: 180 },
      { id: 'semantic-a', created_at: 150 },
      { id: 'semantic-b', created_at: 130 },
      { id: 'noise-1', created_at: 100 },
    ],
    semanticMatches: [
      { id: 'exact-1', score: 0.85 },
      { id: 'exact-2', score: 0.78 },
      { id: 'semantic-a', score: 0.92 },
      { id: 'semantic-b', score: 0.88 },
      { id: 'noise-1', score: 0.20 },
    ],
    groundTruth: {
      'exact-1': 2,
      'exact-2': 2,
      'semantic-a': 1,
      'semantic-b': 1,
      'noise-1': 0,
    },
    limit: 4,
    minNdcg: 0.85,
    minP3: 0.85,
  },
  {
    name: 'semantic-only high-similarity surfaced above noise',
    lexicalItems: [],
    semanticItems: [
      { id: 'top-semantic', created_at: 300 },
      { id: 'mid-semantic', created_at: 200 },
      { id: 'low-semantic', created_at: 100 },
      { id: 'noise-only', created_at: 50 },
    ],
    semanticMatches: [
      { id: 'top-semantic', score: 0.95 },
      { id: 'mid-semantic', score: 0.80 },
      { id: 'low-semantic', score: 0.60 },
      { id: 'noise-only', score: 0.10 },
    ],
    groundTruth: {
      'top-semantic': 2,
      'mid-semantic': 1,
      'low-semantic': 1,
      'noise-only': 0,
    },
    limit: 3,
    minNdcg: 0.80,
    minP3: 0.80,
  },
  {
    name: 'lexical intent preserved — keyword hit stays in results despite low semantic score',
    lexicalItems: [
      { id: 'keyword-exact', created_at: 50 },
    ],
    semanticItems: [
      { id: 'keyword-exact', created_at: 50 },
      { id: 'sem-hi-1', created_at: 300 },
      { id: 'sem-hi-2', created_at: 290 },
      { id: 'sem-hi-3', created_at: 280 },
    ],
    semanticMatches: [
      { id: 'sem-hi-1', score: 0.98 },
      { id: 'sem-hi-2', score: 0.97 },
      { id: 'sem-hi-3', score: 0.96 },
      { id: 'keyword-exact', score: 0.25 },
    ],
    groundTruth: {
      'keyword-exact': 2,
      'sem-hi-1': 1,
      'sem-hi-2': 1,
      'sem-hi-3': 1,
    },
    limit: 3,
    minNdcg: 0.60,
    minP3: 0.70,
  },
  {
    name: 'recency tie-breaking for equal semantic scores',
    lexicalItems: [],
    semanticItems: [
      { id: 'old', created_at: 100 },
      { id: 'mid', created_at: 200 },
      { id: 'new', created_at: 300 },
    ],
    semanticMatches: [
      { id: 'old', score: 0.90 },
      { id: 'mid', score: 0.90 },
      { id: 'new', score: 0.90 },
    ],
    groundTruth: {
      'new': 2,
      'mid': 1,
      'old': 0,
    },
    limit: 3,
    minNdcg: 0.90,
    minP3: 0.60,
  },
  {
    name: 'cosine remapping — negative score items filtered before noise',
    lexicalItems: [],
    semanticItems: [
      { id: 'positive', created_at: 200 },
      { id: 'near-zero', created_at: 150 },
      { id: 'negative', created_at: 100 },
    ],
    semanticMatches: [
      { id: 'positive', score: 0.80 },
      { id: 'near-zero', score: 0.01 },
      { id: 'negative', score: -0.50 },
    ],
    groundTruth: {
      'positive': 2,
      'near-zero': 0,
      'negative': 0,
    },
    limit: 2,
    // near-zero remaps to 0.505 → above MIN_SEMANTIC_ONLY_SCORE(0.45) — still admitted.
    // negative remaps to 0.25 → below threshold → filtered.
    // We just require positive is first.
    minNdcg: 0.80,
    minP3: 0.50,
  },
  {
    name: 'hybrid blending — combined lexical+semantic beats pure semantic ordering',
    lexicalItems: [
      { id: 'hybrid-star', created_at: 100 },
      { id: 'hybrid-good', created_at: 90 },
    ],
    semanticItems: [
      { id: 'hybrid-star', created_at: 100 },
      { id: 'hybrid-good', created_at: 90 },
      { id: 'sem-only-great', created_at: 500 },
    ],
    semanticMatches: [
      { id: 'sem-only-great', score: 0.99 },
      { id: 'hybrid-star', score: 0.75 },
      { id: 'hybrid-good', score: 0.65 },
    ],
    groundTruth: {
      'hybrid-star': 2,
      'hybrid-good': 2,
      'sem-only-great': 1,
    },
    limit: 3,
    minNdcg: 0.75,
    minP3: 0.85,
  },
]

// ── Benchmark Runner ─────────────────────────────────────────

describe('hybrid search relevance benchmark', () => {
  const results: Array<{
    name: string
    ndcg: number
    p3: number
    ranked: string[]
  }> = []

  for (const tc of CASES) {
    it(tc.name, () => {
      const ranked = mergeHybridRankings(
        tc.lexicalItems,
        tc.semanticItems,
        tc.semanticMatches,
        tc.limit,
      )

      const relevanceMap = new Map(Object.entries(tc.groundTruth))
      const ndcg = ndcgAtK(ranked, relevanceMap, tc.limit)
      const p3 = precisionAtK(ranked, relevanceMap, 3)
      const rankedIds = ranked.map(m => m.item.id)

      results.push({ name: tc.name, ndcg, p3, ranked: rankedIds })

      // Log for human inspection when run with --reporter verbose
      console.log(
        `  [${tc.name}]\n` +
        `    ranked: [${rankedIds.join(', ')}]\n` +
        `    NDCG@${tc.limit}: ${ndcg.toFixed(4)}  (min ${tc.minNdcg})\n` +
        `    P@3:    ${p3.toFixed(4)}  (min ${tc.minP3})`,
      )

      expect(ndcg, `NDCG@${tc.limit} below threshold`).toBeGreaterThanOrEqual(tc.minNdcg)
      expect(p3, 'P@3 below threshold').toBeGreaterThanOrEqual(tc.minP3)
    })
  }

  it('aggregate NDCG across all cases exceeds 0.78', () => {
    // This test runs after all individual cases.
    // We re-compute here rather than relying on the results array accumulation.
    let totalNdcg = 0
    let count = 0
    for (const tc of CASES) {
      const ranked = mergeHybridRankings(
        tc.lexicalItems,
        tc.semanticItems,
        tc.semanticMatches,
        tc.limit,
      )
      const relevanceMap = new Map(Object.entries(tc.groundTruth))
      totalNdcg += ndcgAtK(ranked, relevanceMap, tc.limit)
      count++
    }
    const avgNdcg = totalNdcg / count
    console.log(`  [aggregate] mean NDCG across ${count} cases: ${avgNdcg.toFixed(4)}`)
    expect(avgNdcg, 'mean NDCG across all benchmark cases').toBeGreaterThanOrEqual(0.78)
  })
})
