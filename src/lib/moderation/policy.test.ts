import { describe, expect, it } from 'vitest'
import {
  emptyModerationScores,
  evaluateModerationScores,
  normalizeModerationScores,
} from './policy'

describe('normalizeModerationScores', () => {
  it('keeps known labels and ignores unknown ones', () => {
    const scores = normalizeModerationScores([
      { label: 'toxic', score: 0.8 },
      { label: 'threat', score: 0.6 },
      { label: 'unknown', score: 1 },
    ])

    expect(scores).toEqual({
      toxic: 0.8,
      severe_toxic: 0,
      obscene: 0,
      threat: 0.6,
      insult: 0,
      identity_hate: 0,
    })
  })

  it('normalizes label variations', () => {
    const scores = normalizeModerationScores([
      { label: 'TOXIC', score: 0.8 },
      { label: 'severe-toxic', score: 0.7 },
      { label: 'identity_hate', score: 0.6 },
      { label: 'Identity Hate', score: 0.5 },
    ])

    expect(scores).toEqual({
      toxic: 0.8,
      severe_toxic: 0.7,
      obscene: 0,
      threat: 0,
      insult: 0,
      identity_hate: 0.5, // last one wins
    })
  })
})

describe('evaluateModerationScores', () => {
  it('allows ordinary toxicity below the extreme-harm thresholds', () => {
    const base = emptyModerationScores()
    const decision = evaluateModerationScores('event-1', {
      ...base,
      toxic: 0.82,
      insult: 0.78,
    }, 'test-model')

    expect(decision.action).toBe('allow')
    expect(decision.reason).toBeNull()
  })

  it('blocks credible threats', () => {
    const base = emptyModerationScores()
    const decision = evaluateModerationScores('event-2', {
      ...base,
      threat: 0.91,
      toxic: 0.66,
    }, 'test-model')

    expect(decision.action).toBe('block')
    expect(decision.reason).toBe('threat')
  })

  it('blocks identity attacks only when hate is high and toxicity corroborates it', () => {
    const base = emptyModerationScores()
    const blocked = evaluateModerationScores('event-3', {
      ...base,
      identity_hate: 0.88,
      toxic: 0.74,
    }, 'test-model')
    const allowed = evaluateModerationScores('event-4', {
      ...base,
      identity_hate: 0.88,
      toxic: 0.22,
    }, 'test-model')

    expect(blocked.action).toBe('block')
    expect(blocked.reason).toBe('identity_hate')
    expect(allowed.action).toBe('allow')
  })
})
