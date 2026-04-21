import { describe, expect, it } from 'vitest'
import {
  PROMPT_PRESETS,
  SEARCH_INTENT_EVAL_CASES,
  buildGroundedAnswerPrompt,
  buildSearchIntentSinglePrompt,
  buildSearchIntentSystemPrompt,
  buildSearchIntentUserPrompt,
} from './promptPlaybook'

describe('SEARCH_INTENT_EVAL_CASES', () => {
  it('covers lexical, semantic, and hybrid labels', () => {
    expect(new Set(SEARCH_INTENT_EVAL_CASES.map((entry) => entry.expectedIntent))).toEqual(
      new Set(['lexical', 'semantic', 'hybrid']),
    )
  })

  it('uses unique queries to avoid ambiguous eval fixtures', () => {
    const queries = SEARCH_INTENT_EVAL_CASES.map((entry) => entry.query)
    expect(new Set(queries).size).toBe(queries.length)
  })
})

describe('buildSearchIntentSystemPrompt', () => {
  it('uses tagged sections and explicit output constraints', () => {
    const prompt = buildSearchIntentSystemPrompt()

    expect(prompt).toContain('<role>')
    expect(prompt).toContain('<definitions>')
    expect(prompt).toContain('<examples>')
    expect(prompt).toContain('Return exactly one word: lexical, semantic, or hybrid.')
  })
})

describe('buildSearchIntentUserPrompt', () => {
  it('wraps the query and repeats the exact output requirement', () => {
    const prompt = buildSearchIntentUserPrompt('#nostr wallets')

    expect(prompt).toContain('<query>#nostr wallets</query>')
    expect(prompt).toContain('<required_output>')
  })
})

describe('buildSearchIntentSinglePrompt', () => {
  it('combines the system and user prompts for single-string runtimes', () => {
    const prompt = buildSearchIntentSinglePrompt('what is zapping in nostr')

    expect(prompt).toContain('<role>You are a search intent classifier')
    expect(prompt).toContain('<query>what is zapping in nostr</query>')
  })
})

describe('buildGroundedAnswerPrompt', () => {
  it('requires quote-first grounded answering with explicit insufficiency behavior', () => {
    const prompt = buildGroundedAnswerPrompt('What is zapping?', [
      { source: 'note-1', content: 'A zap is a Lightning payment.' },
    ])

    expect(prompt).toContain('First extract 1 to 3 short verbatim quotes')
    expect(prompt).toContain('insufficient context')
    expect(prompt).toContain('<documents>')
    expect(prompt).toContain('<question>What is zapping?</question>')
  })
})

describe('PROMPT_PRESETS', () => {
  it('contains the router, moderation, and grounded-answer presets', () => {
    expect(PROMPT_PRESETS.map((preset) => preset.id)).toEqual([
      'router-intent',
      'extreme-harm-moderation',
      'grounded-answer',
    ])
  })

  it('builds non-empty prompt inputs for each preset', () => {
    for (const preset of PROMPT_PRESETS) {
      expect(preset.buildInput().trim().length).toBeGreaterThan(0)
    }
  })
})