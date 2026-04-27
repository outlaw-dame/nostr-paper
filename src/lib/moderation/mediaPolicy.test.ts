import { describe, expect, it } from 'vitest'
import {
  evaluateMediaModerationScores,
  mergeMediaModerationScores,
  normalizeNsfwScores,
  normalizeViolenceScores,
} from '@/lib/moderation/mediaPolicy'

describe('media moderation policy', () => {
  it('normalizes nsfw labels conservatively', () => {
    const scores = normalizeNsfwScores([
      { label: 'neutral', score: 0.96 },
      { label: 'nsfw', score: 0.82 },
      { label: 'porn', score: 0.91 },
    ])

    expect(scores.nsfw).toBe(0.91)
    expect(scores.violence).toBe(0)
  })

  it('normalizes violence labels conservatively', () => {
    const scores = normalizeViolenceScores([
      { label: 'non-violence', score: 0.99 },
      { label: 'violence', score: 0.94 },
      { label: 'graphic violence', score: 0.97 },
    ])

    expect(scores.violence).toBe(0.97)
    expect(scores.nsfw).toBe(0)
  })

  it('allows clearly safe media below thresholds', () => {
    const decision = evaluateMediaModerationScores(
      'media-1',
      mergeMediaModerationScores(
        { nsfw: 0.55, violence: 0 },
        { nsfw: 0, violence: 0.60 },
      ),
      { nsfwModel: 'nsfw-model', violenceModel: 'violence-model' },
    )

    expect(decision.action).toBe('allow')
    expect(decision.reason).toBeNull()
  })

  it('blocks at nsfw >= 0.70 threshold', () => {
    const borderlineBlock = evaluateMediaModerationScores(
      'media-border',
      { nsfw: 0.72, violence: 0 },
      { nsfwModel: 'nsfw-model', violenceModel: 'violence-model' },
    )
    expect(borderlineBlock.action).toBe('block')
    expect(borderlineBlock.reason).toBe('nsfw')
  })

  it('blocks at violence >= 0.75 threshold', () => {
    const violenceBorder = evaluateMediaModerationScores(
      'media-vborder',
      { nsfw: 0, violence: 0.76 },
      { nsfwModel: 'nsfw-model', violenceModel: 'violence-model' },
    )
    expect(violenceBorder.action).toBe('block')
    expect(violenceBorder.reason).toBe('violence')
  })

  it('blocks explicit adult or graphic violence content', () => {
    const adultDecision = evaluateMediaModerationScores(
      'media-2',
      { nsfw: 0.98, violence: 0 },
      { nsfwModel: 'nsfw-model', violenceModel: 'violence-model' },
    )
    const violenceDecision = evaluateMediaModerationScores(
      'media-3',
      { nsfw: 0, violence: 0.99 },
      { nsfwModel: 'nsfw-model', violenceModel: 'violence-model' },
    )

    expect(adultDecision.action).toBe('block')
    expect(adultDecision.reason).toBe('nsfw')
    expect(violenceDecision.action).toBe('block')
    expect(violenceDecision.reason).toBe('violence')
  })
})
