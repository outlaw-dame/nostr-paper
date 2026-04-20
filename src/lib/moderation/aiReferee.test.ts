import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModerationDecision, ModerationDocument, ModerationScores } from '@/types'
import { refineModerationDecisionsWithAi } from './aiReferee'

const generateAssistTextMock = vi.fn()

vi.mock('@/lib/ai/gemmaAssist', () => ({
  generateAssistText: (...args: unknown[]) => generateAssistTextMock(...args),
}))

function makeScores(overrides: Partial<ModerationScores> = {}): ModerationScores {
  return {
    toxic: 0,
    severe_toxic: 0,
    obscene: 0,
    threat: 0,
    insult: 0,
    identity_hate: 0,
    ...overrides,
  }
}

function makeDecision(overrides: Partial<ModerationDecision> = {}): ModerationDecision {
  return {
    id: 'doc-1',
    action: 'allow',
    reason: null,
    scores: makeScores({ toxic: 0.82, insult: 0.74 }),
    model: 'test-model',
    policyVersion: 'extreme-harm-v1',
    ...overrides,
  }
}

function makeDoc(overrides: Partial<ModerationDocument> = {}): ModerationDocument {
  return {
    id: 'doc-1',
    kind: 'event',
    text: 'sample text',
    updatedAt: 1,
    ...overrides,
  }
}

describe('refineModerationDecisionsWithAi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateAssistTextMock.mockResolvedValue({
      text: JSON.stringify({ action: 'block', reason: 'severe_harassment', confidence: 0.91 }),
      source: 'gemma',
      enhancedByGemini: false,
    })
    ;(import.meta.env as Record<string, unknown>).VITE_AI_MODERATION_ENABLED = 'true'
  })

  it('upgrades borderline allow decision to block when AI returns confident block vote', async () => {
    const decisions = await refineModerationDecisionsWithAi([makeDoc()], [makeDecision()])

    expect(generateAssistTextMock).toHaveBeenCalledTimes(1)
    expect(decisions[0]?.action).toBe('block')
    expect(decisions[0]?.reason).toBe('ai_severe_harassment')
    expect(decisions[0]?.model).toContain('+gemma')
  })

  it('keeps base decision when AI confidence is low', async () => {
    generateAssistTextMock.mockResolvedValue({
      text: JSON.stringify({ action: 'block', reason: 'possible_abuse', confidence: 0.22 }),
      source: 'gemma',
      enhancedByGemini: false,
    })

    const base = makeDecision()
    const decisions = await refineModerationDecisionsWithAi([makeDoc()], [base])

    expect(decisions[0]).toEqual(base)
  })

  it('keeps base decisions when AI moderation is disabled', async () => {
    ;(import.meta.env as Record<string, unknown>).VITE_AI_MODERATION_ENABLED = 'false'

    const base = makeDecision()
    const decisions = await refineModerationDecisionsWithAi([makeDoc()], [base])

    expect(generateAssistTextMock).not.toHaveBeenCalled()
    expect(decisions[0]).toEqual(base)
  })
})
