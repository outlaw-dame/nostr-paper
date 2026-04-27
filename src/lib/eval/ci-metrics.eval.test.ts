/**
 * CI Metrics Evaluator
 *
 * Consolidated quality test that collects hybrid search and moderation metrics
 * and writes a single JSON artifact to `ci-metrics.json` for trend dashboards.
 *
 * Run:
 *   npx vitest run src/lib/eval/ci-metrics.eval.test.ts
 *
 * Output artifact:
 *   ci-metrics.json (in repo root)
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { mergeHybridRankings } from '../search/hybrid'
import { emptyModerationScores, evaluateModerationScores } from '../moderation/policy'
import { evaluateMediaModerationScores } from '../moderation/mediaPolicy'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type BinaryLabel = 'allow' | 'block'

function binaryMetrics(expected: BinaryLabel[], actual: BinaryLabel[]) {
  let tp = 0; let tn = 0; let fp = 0; let fn = 0
  for (let i = 0; i < expected.length; i += 1) {
    const e = expected[i]; const a = actual[i]
    if (e === 'block' && a === 'block') tp += 1
    if (e === 'allow' && a === 'allow') tn += 1
    if (e === 'allow' && a === 'block') fp += 1
    if (e === 'block' && a === 'allow') fn += 1
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp)
  const recall    = tp + fn === 0 ? 0 : tp / (tp + fn)
  const accuracy  = (tp + tn) / expected.length
  const falsePositiveRate = fp + tn === 0 ? 0 : fp / (fp + tn)
  return { tp, tn, fp, fn, precision, recall, accuracy, falsePositiveRate }
}

function dcgAtK(ids: string[], relevant: Set<string>, k: number): number {
  return ids.slice(0, k).reduce((sum, id, index) => {
    const rel = relevant.has(id) ? 1 : 0
    return rel === 0 ? sum : sum + (1 / Math.log2(index + 2))
  }, 0)
}

function ndcgAtK(ids: string[], relevant: Set<string>, k: number): number {
  const idcg = new Array(Math.min(k, relevant.size)).fill(0)
    .reduce((sum, _, i) => sum + (1 / Math.log2(i + 2)), 0)
  return idcg === 0 ? 0 : dcgAtK(ids, relevant, k) / idcg
}

function recallAtK(ids: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0
  return ids.slice(0, k).filter((id) => relevant.has(id)).length / relevant.size
}

function fmt(n: number) { return Number(n.toFixed(4)) }

// ---------------------------------------------------------------------------
// Accumulated results (filled in per describe block, written in afterAll)
// ---------------------------------------------------------------------------

type MetricsSnapshot = {
  timestamp: string
  commit: string
  hybrid: {
    fixtures: Array<{ fixture: string; ndcg: number; recall: number; top1Correct: boolean }>
    summary: { ndcgMean: number; recallMean: number; top1AccuracyPct: number }
  }
  moderation: {
    text: ReturnType<typeof binaryMetrics>
    media: ReturnType<typeof binaryMetrics>
  }
}

const snapshot: MetricsSnapshot = {
  timestamp: new Date().toISOString(),
  commit: process.env.GITHUB_SHA ?? process.env.GIT_COMMIT ?? 'local',
  hybrid: { fixtures: [], summary: { ndcgMean: 0, recallMean: 0, top1AccuracyPct: 0 } },
  moderation: {
    text: { tp: 0, tn: 0, fp: 0, fn: 0, precision: 0, recall: 0, accuracy: 0, falsePositiveRate: 0 },
    media: { tp: 0, tn: 0, fp: 0, fn: 0, precision: 0, recall: 0, accuracy: 0, falsePositiveRate: 0 },
  },
}

afterAll(() => {
  const outPath = path.resolve(process.cwd(), 'ci-metrics.json')

  // Append to a history array if the file already exists, otherwise start fresh
  let history: MetricsSnapshot[] = []
  try {
    const raw = fs.readFileSync(outPath, 'utf8')
    const parsed = JSON.parse(raw)
    history = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    // file doesn't exist yet — start fresh
  }

  history.push(snapshot)
  fs.writeFileSync(outPath, JSON.stringify(history, null, 2))

  // Print summary table to stdout so it's visible in CI logs
  console.log('\n── CI Quality Metrics Snapshot ──')
  console.table([
    {
      stack: 'hybrid (mean)',
      ndcg: snapshot.hybrid.summary.ndcgMean,
      recall: snapshot.hybrid.summary.recallMean,
      top1Pct: snapshot.hybrid.summary.top1AccuracyPct,
    },
    {
      stack: 'text-moderation',
      precision: snapshot.moderation.text.precision,
      recall: snapshot.moderation.text.recall,
      accuracy: snapshot.moderation.text.accuracy,
      FPR: snapshot.moderation.text.falsePositiveRate,
    },
    {
      stack: 'media-moderation',
      precision: snapshot.moderation.media.precision,
      recall: snapshot.moderation.media.recall,
      accuracy: snapshot.moderation.media.accuracy,
      FPR: snapshot.moderation.media.falsePositiveRate,
    },
  ])
  console.log(`Metrics written → ${outPath}\n`)
})

// ---------------------------------------------------------------------------
// Hybrid search
// ---------------------------------------------------------------------------

describe('CI: hybrid search quality', () => {
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

  const fixtures: QueryFixture[] = [
    {
      name: 'keyword-intent: exact lexical hit preserved',
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
      name: 'semantic-heavy: conceptual doc lifted into top results',
      lexicalItems: [{ id: 'keyword_only', created_at: 110 }],
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
      name: 'recall scenario: both lexical and semantic hits in top-k',
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

  it('meets nDCG and recall thresholds across all fixtures', () => {
    const rows = fixtures.map((fixture) => {
      const ranked = mergeHybridRankings(
        fixture.lexicalItems,
        fixture.semanticItems,
        fixture.semanticMatches,
        fixture.limit,
      )
      const ids = ranked.map((m) => m.item.id)
      const relevant = new Set(fixture.relevantIds)
      const ndcg   = ndcgAtK(ids, relevant, fixture.limit)
      const recall = recallAtK(ids, relevant, fixture.limit)
      const top1Correct = ids[0] === fixture.expectedTop1

      expect(top1Correct, `top-1 for "${fixture.name}"`).toBe(true)
      expect(ndcg).toBeGreaterThanOrEqual(0.90)
      expect(recall).toBeGreaterThanOrEqual(0.90)

      return { fixture: fixture.name, ndcg: fmt(ndcg), recall: fmt(recall), top1Correct }
    })

    const ndcgMean   = fmt(rows.reduce((s, r) => s + r.ndcg, 0) / rows.length)
    const recallMean = fmt(rows.reduce((s, r) => s + r.recall, 0) / rows.length)
    const top1AccuracyPct = fmt(rows.filter((r) => r.top1Correct).length / rows.length)

    // Persist into snapshot
    snapshot.hybrid.fixtures = rows
    snapshot.hybrid.summary  = { ndcgMean, recallMean, top1AccuracyPct }
  })
})

// ---------------------------------------------------------------------------
// Text moderation
// ---------------------------------------------------------------------------

describe('CI: text moderation quality', () => {
  type TextFixture = {
    id: string
    expected: BinaryLabel
    scores: ReturnType<typeof emptyModerationScores>
  }

  it('meets high-precision gating targets', () => {
    const base = emptyModerationScores()

    const fixtures: TextFixture[] = [
      // Safe content — well below all thresholds
      { id: 'allow-low-toxic',                         expected: 'allow', scores: { ...base, toxic: 0.24, insult: 0.18 } },
      // Below threat threshold (0.60) — should allow
      { id: 'allow-borderline-threat',                 expected: 'allow', scores: { ...base, threat: 0.45, toxic: 0.30 } },
      // High identity_hate but toxic below 0.45 gate — should allow
      { id: 'allow-hate-without-toxic-corroboration',  expected: 'allow', scores: { ...base, identity_hate: 0.88, toxic: 0.30 } },
      // Credible threat — blocks at threat >= 0.60
      { id: 'block-threat',                            expected: 'block', scores: { ...base, threat: 0.91, toxic: 0.62 } },
      // Borderline threat over threshold
      { id: 'block-borderline-threat',                 expected: 'block', scores: { ...base, threat: 0.62, toxic: 0.40 } },
      // Identity attack with toxic corroboration
      { id: 'block-identity-hate',                     expected: 'block', scores: { ...base, identity_hate: 0.78, toxic: 0.71 } },
      // Severe abuse at new threshold (0.62)
      { id: 'block-severe-toxic',                      expected: 'block', scores: { ...base, severe_toxic: 0.65, toxic: 0.40 } },
      // Strong standalone obscene signal (>= 0.88)
      { id: 'block-high-obscene',                      expected: 'block', scores: { ...base, obscene: 0.92, toxic: 0.20 } },
      // Obscene abuse combo
      { id: 'block-obscene-abuse',                     expected: 'block', scores: { ...base, obscene: 0.82, toxic: 0.65 } },
      // Heavy harassment combo
      { id: 'block-heavy-harassment',                  expected: 'block', scores: { ...base, toxic: 0.88, insult: 0.80 } },
    ]

    const expected = fixtures.map((f) => f.expected)
    const actual   = fixtures.map((f) => evaluateModerationScores(f.id, f.scores, 'ci-eval-model').action)
    const m        = binaryMetrics(expected, actual)

    expect(m.precision).toBeGreaterThanOrEqual(0.95)
    expect(m.recall).toBeGreaterThanOrEqual(0.95)
    expect(m.accuracy).toBeGreaterThanOrEqual(0.95)
    expect(m.falsePositiveRate).toBeLessThanOrEqual(0.10)

    snapshot.moderation.text = Object.fromEntries(
      Object.entries(m).map(([k, v]) => [k, fmt(v)])
    ) as typeof m
  })
})

// ---------------------------------------------------------------------------
// Media moderation
// ---------------------------------------------------------------------------

describe('CI: media moderation quality', () => {
  type MediaFixture = {
    id: string
    expected: BinaryLabel
    scores: { nsfw: number; violence: number }
  }

  it('blocks only explicit harm with low false positives', () => {
    const fixtures: MediaFixture[] = [
      // Safe — well below thresholds (nsfw >= 0.70, violence >= 0.75)
      { id: 'allow-safe',               expected: 'allow', scores: { nsfw: 0.05, violence: 0.02 } },
      { id: 'allow-low-suggestive',     expected: 'allow', scores: { nsfw: 0.55, violence: 0.01 } },
      { id: 'allow-low-violence',       expected: 'allow', scores: { nsfw: 0.04, violence: 0.60 } },
      // At-threshold blocks
      { id: 'block-borderline-adult',   expected: 'block', scores: { nsfw: 0.72, violence: 0.01 } },
      { id: 'block-borderline-violence',expected: 'block', scores: { nsfw: 0.04, violence: 0.77 } },
      { id: 'block-explicit-adult',     expected: 'block', scores: { nsfw: 0.94, violence: 0.03 } },
      { id: 'block-graphic-violence',   expected: 'block', scores: { nsfw: 0.07, violence: 0.97 } },
      { id: 'block-both-high',          expected: 'block', scores: { nsfw: 0.91, violence: 0.93 } },
    ]

    const expected = fixtures.map((f) => f.expected)
    const actual   = fixtures.map((f) => evaluateMediaModerationScores(
      f.id,
      f.scores,
      { nsfwModel: 'ci-nsfw-model', violenceModel: 'ci-violence-model' },
    ).action)
    const m = binaryMetrics(expected, actual)

    expect(m.precision).toBeGreaterThanOrEqual(0.95)
    expect(m.recall).toBeGreaterThanOrEqual(0.95)
    expect(m.accuracy).toBeGreaterThanOrEqual(0.95)
    expect(m.falsePositiveRate).toBeLessThanOrEqual(0.10)

    snapshot.moderation.media = Object.fromEntries(
      Object.entries(m).map(([k, v]) => [k, fmt(v)])
    ) as typeof m
  })
})
