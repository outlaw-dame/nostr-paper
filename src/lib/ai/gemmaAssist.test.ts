import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const generateText = vi.fn()
const isGemmaAvailable = vi.fn()
const loadTranslationSecrets = vi.fn()

vi.mock('@/lib/gemma/client', () => ({
  generateText,
  isGemmaAvailable,
}))

vi.mock('@/lib/translation/storage', () => ({
  loadTranslationSecrets,
}))

const {
  canUseGeminiAssist,
  evaluateAssistQuality,
  generateAssistText,
  generateGeminiAssistText,
  generateGemmaAssistText,
} = await import('@/lib/ai/gemmaAssist')

const originalFetch = globalThis.fetch

function setFetchMock(impl: () => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>): void {
  ;(globalThis as { fetch?: typeof fetch }).fetch = vi.fn(impl) as unknown as typeof fetch
}

describe('gemmaAssist quality routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isGemmaAvailable.mockReturnValue(true)
    loadTranslationSecrets.mockResolvedValue({
      deeplAuthKey: '',
      libreApiKey: '',
      geminiApiKey: 'AIza-test-key',
    })

    setFetchMock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: 'Enhanced quality response from Gemini.' }],
            },
          },
        ],
      }),
    }))
  })

  it('uses Gemma output directly when quality is good', async () => {
    generateText.mockResolvedValue('This is a complete and context-rich response. It includes clear reasoning and practical detail.')

    const result = await generateAssistText('improve draft', { provider: 'gemma' })

    expect(result.source).toBe('gemma')
    expect(result.enhancedByGemini).toBe(false)
    expect(result.text).toContain('context-rich response')
  })

  it('enhances low-quality Gemma output with Gemini when available', async () => {
    generateText.mockResolvedValue('ok ok ok')

    const result = await generateAssistText('improve draft', { provider: 'gemma' })

    expect(result.source).toBe('gemini')
    expect(result.enhancedByGemini).toBe(true)
    expect(result.text).toContain('Enhanced quality response from Gemini')
  })

  it('falls back to Gemma output when Gemini enhancement fails', async () => {
    generateText.mockResolvedValue('ok ok ok')
    setFetchMock(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }))

    const result = await generateAssistText('improve draft', { provider: 'gemma' })

    expect(result.source).toBe('gemma')
    expect(result.enhancedByGemini).toBe(false)
    expect(result.text).toBe('ok ok ok')
  })

  it('uses Gemini directly when provider is gemini', async () => {
    const result = await generateAssistText('improve draft', { provider: 'gemini' })

    expect(result.source).toBe('gemini')
    expect(result.enhancedByGemini).toBe(false)
    expect(result.text).toContain('Enhanced quality response from Gemini')
    expect(generateText).not.toHaveBeenCalled()
  })

  it('supports auto mode fallback to Gemini when Gemma is unavailable', async () => {
    isGemmaAvailable.mockReturnValue(false)

    const result = await generateAssistText('improve draft', { provider: 'auto' })

    expect(result.source).toBe('gemini')
    expect(result.text).toContain('Enhanced quality response from Gemini')
  })

  it('reports Gemini availability from stored key', async () => {
    loadTranslationSecrets.mockResolvedValue({ deeplAuthKey: '', libreApiKey: '', geminiApiKey: '' })
    await expect(canUseGeminiAssist()).resolves.toBe(false)

    loadTranslationSecrets.mockResolvedValue({ deeplAuthKey: '', libreApiKey: '', geminiApiKey: 'AIza-yes' })
    await expect(canUseGeminiAssist()).resolves.toBe(true)
  })

  it('sanitizes gemma/gemini direct helper outputs', async () => {
    generateText.mockResolvedValue('```text\nshort answer\n```')
    await expect(generateGemmaAssistText('prompt')).resolves.toBe('short answer')

    setFetchMock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '```text\nGemini answer\n```' }] } }],
      }),
    }))

    await expect(generateGeminiAssistText('prompt')).resolves.toBe('Gemini answer')
  })

  it('scores high-quality composer guidance above enhancement threshold', () => {
    const highQualityComposerOutput = [
      'Lead with your key point in one sentence, then add one concrete example from your draft to keep it credible.',
      'Tighten the ending by replacing generic language with a specific takeaway readers can react to.',
      'Keep hashtags to one relevant tag so the post reads focused rather than overloaded.',
    ].join(' ')

    const score = evaluateAssistQuality(highQualityComposerOutput)
    expect(score).toBeGreaterThanOrEqual(0.52)
  })

  it('scores weak repetitive summaries below enhancement threshold', () => {
    const lowQualitySummaryOutput = 'ok ok ok summary summary ok ok'
    const score = evaluateAssistQuality(lowQualitySummaryOutput)

    expect(score).toBeLessThan(0.52)
  })

  it('scores concise multi-signal recap summaries as acceptable quality', () => {
    const recapSummary = [
      'This evening you had a strong engagement burst with reactions and reposts concentrated in two threads.',
      'Mentions were lower volume but came from distinct accounts, suggesting broad but lighter discovery.',
      'Prioritize replying to the highest-zap thread first to preserve momentum in the next hour.',
    ].join(' ')

    const score = evaluateAssistQuality(recapSummary)
    expect(score).toBeGreaterThanOrEqual(0.52)
  })
})

afterEach(() => {
  if (originalFetch) {
    ;(globalThis as { fetch?: typeof fetch }).fetch = originalFetch
    return
  }
  delete (globalThis as { fetch?: typeof fetch }).fetch
})
