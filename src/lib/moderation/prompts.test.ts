import { describe, expect, it } from 'vitest'
import {
  EXTREME_HARM_MODERATION_EVAL_CASES,
  EXTREME_HARM_MODERATION_SYSTEM_PROMPT,
  buildExtremeHarmModerationPrompt,
} from './prompts'

describe('EXTREME_HARM_MODERATION_SYSTEM_PROMPT', () => {
  it('uses tagged sections and strict JSON output requirements', () => {
    expect(EXTREME_HARM_MODERATION_SYSTEM_PROMPT).toContain('<role>')
    expect(EXTREME_HARM_MODERATION_SYSTEM_PROMPT).toContain('<block_categories>')
    expect(EXTREME_HARM_MODERATION_SYSTEM_PROMPT).toContain('<required_output>')
    expect(EXTREME_HARM_MODERATION_SYSTEM_PROMPT).toContain('"action": "allow" | "block"')
  })
})

describe('EXTREME_HARM_MODERATION_EVAL_CASES', () => {
  it('covers both allow and block outcomes', () => {
    expect(new Set(EXTREME_HARM_MODERATION_EVAL_CASES.map((entry) => entry.expected.action))).toEqual(
      new Set(['allow', 'block']),
    )
  })

  it('uses unique content fixtures', () => {
    const contents = EXTREME_HARM_MODERATION_EVAL_CASES.map((entry) => entry.content)
    expect(new Set(contents).size).toBe(contents.length)
  })
})

describe('buildExtremeHarmModerationPrompt', () => {
  it('renders examples and the content-to-review inside tagged sections', () => {
    const prompt = buildExtremeHarmModerationPrompt('I disagree with your politics. You are an idiot.')

    expect(prompt).toContain('<examples>')
    expect(prompt).toContain('<content_to_review>')
    expect(prompt).toContain('<required_output>Return strict JSON only.</required_output>')
  })
})