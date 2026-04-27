import { describe, expect, it } from 'vitest'
import { emptyModerationScores, evaluateModerationScores } from './policy'
import { evaluateMediaModerationScores } from './mediaPolicy'

type BinaryLabel = 'allow' | 'block'

type TextFixture = {
  id: string
  expected: BinaryLabel
  scores: ReturnType<typeof emptyModerationScores>
}

type MediaFixture = {
  id: string
  expected: BinaryLabel
  scores: { nsfw: number; violence: number }
}

function binaryMetrics(expected: BinaryLabel[], actual: BinaryLabel[]) {
  let tp = 0
  let tn = 0
  let fp = 0
  let fn = 0

  for (let i = 0; i < expected.length; i += 1) {
    const e = expected[i]
    const a = actual[i]
    if (e === 'block' && a === 'block') tp += 1
    if (e === 'allow' && a === 'allow') tn += 1
    if (e === 'allow' && a === 'block') fp += 1
    if (e === 'block' && a === 'allow') fn += 1
  }

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn)
  const accuracy = (tp + tn) / expected.length
  const falsePositiveRate = fp + tn === 0 ? 0 : fp / (fp + tn)

  return { tp, tn, fp, fn, precision, recall, accuracy, falsePositiveRate }
}

describe('moderation quality metrics', () => {
  it('text moderation policy meets high-precision gating targets', () => {
    const base = emptyModerationScores()

    const fixtures: TextFixture[] = [
      {
        id: 'allow-low-toxic',
        expected: 'allow',
        scores: { ...base, toxic: 0.24, insult: 0.18 },
      },
      {
        id: 'block-borderline-abusive',
        expected: 'block',
        scores: { ...base, toxic: 0.83, severe_toxic: 0.65, insult: 0.77 },
      },
      {
        id: 'allow-hate-without-toxic-corroboration',
        expected: 'allow',
        scores: { ...base, identity_hate: 0.88, toxic: 0.30 },
      },
      {
        id: 'block-threat',
        expected: 'block',
        scores: { ...base, threat: 0.91, toxic: 0.62 },
      },
      {
        id: 'block-identity-hate',
        expected: 'block',
        scores: { ...base, identity_hate: 0.78, toxic: 0.71 },
      },
      {
        id: 'block-severe-toxic',
        expected: 'block',
        scores: { ...base, severe_toxic: 0.86, toxic: 0.64 },
      },
      {
        id: 'block-extreme-obscene-abuse',
        expected: 'block',
        scores: { ...base, obscene: 0.99, toxic: 0.97, insult: 0.94 },
      },
      {
        id: 'block-extreme-harassment',
        expected: 'block',
        scores: { ...base, toxic: 0.98, insult: 0.96 },
      },
    ]

    const expected = fixtures.map((f) => f.expected)
    const actual = fixtures.map((f) => evaluateModerationScores(f.id, f.scores, 'quality-test-model').action)
    const m = binaryMetrics(expected, actual)

    expect(m.precision).toBeGreaterThanOrEqual(0.95)
    expect(m.recall).toBeGreaterThanOrEqual(0.95)
    expect(m.accuracy).toBeGreaterThanOrEqual(0.95)
    expect(m.falsePositiveRate).toBeLessThanOrEqual(0.10)

    console.table([{ stack: 'text', ...Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Number(v.toFixed ? v.toFixed(4) : v)])) }])
  })

  it('media moderation policy blocks only explicit harm while keeping false positives low', () => {
    const fixtures: MediaFixture[] = [
      { id: 'allow-safe', expected: 'allow', scores: { nsfw: 0.05, violence: 0.02 } },
      { id: 'block-borderline-adult', expected: 'block', scores: { nsfw: 0.82, violence: 0.01 } },
      { id: 'block-borderline-violence', expected: 'block', scores: { nsfw: 0.04, violence: 0.88 } },
      { id: 'block-explicit-adult', expected: 'block', scores: { nsfw: 0.94, violence: 0.03 } },
      { id: 'block-graphic-violence', expected: 'block', scores: { nsfw: 0.07, violence: 0.97 } },
      { id: 'block-both-high', expected: 'block', scores: { nsfw: 0.91, violence: 0.93 } },
    ]

    const expected = fixtures.map((f) => f.expected)
    const actual = fixtures.map((f) => evaluateMediaModerationScores(
      f.id,
      f.scores,
      { nsfwModel: 'nsfw-test-model', violenceModel: 'violence-test-model' },
    ).action)
    const m = binaryMetrics(expected, actual)

    expect(m.precision).toBeGreaterThanOrEqual(0.95)
    expect(m.recall).toBeGreaterThanOrEqual(0.95)
    expect(m.accuracy).toBeGreaterThanOrEqual(0.95)
    expect(m.falsePositiveRate).toBeLessThanOrEqual(0.10)

    console.table([{ stack: 'media', ...Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Number(v.toFixed ? v.toFixed(4) : v)])) }])
  })
})
