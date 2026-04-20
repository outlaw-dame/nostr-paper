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

function setGeminiTextResponse(text: string): void {
  setFetchMock(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [{ text }],
          },
        },
      ],
    }),
  }))
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

  describe('quality parity across providers by task', () => {
    const taskCases = [
      {
        name: 'compose assistance',
        prompt: [
          'Write 2 to 3 sentences of specific, actionable guidance to improve this social post.',
          'Draft: "Just had a great time at the conference. Learned so much about nostr. Really enjoyed the talks."',
        ].join('\n'),
        gemmaStrong: [
          'Lead with one specific insight from a talk instead of generic praise so readers see immediate value.',
          'Replace the final sentence with a concrete takeaway or question to invite replies.',
          'Keep one focused hashtag tied to your strongest point so discovery stays relevant.',
        ].join(' '),
        gemmaWeak: 'great post great post good good',
        geminiStrong: [
          'Replace general statements with one concrete lesson from a specific talk to increase credibility and reader interest.',
          'Restructure the post so your strongest takeaway appears first, then follow with a concise example that supports it.',
          'Close with a direct question to drive engagement and keep hashtags limited to one highly relevant tag.',
        ].join(' '),
      },
      {
        name: 'activity recap',
        prompt: [
          'Write 2 to 4 sentences summarising this social media activity.',
          'Signals: reactions 23, reposts 5, mentions 4, zaps 2.',
        ].join('\n'),
        gemmaStrong: [
          'Reactions were the dominant signal, with reposts and mentions trailing at lower but steady levels.',
          'Most engagement clustered in two related threads, suggesting the topic has sustained interest.',
          'Replying first to the highest-zap thread should convert passive engagement into deeper conversation.',
        ].join(' '),
        gemmaWeak: 'activity happened and was good good good',
        geminiStrong: [
          'Your strongest engagement came from reactions, while reposts, mentions, and zaps indicate lighter but diverse follow-through.',
          'The signal distribution suggests a passive-first response pattern centered around a small number of threads.',
          'Prioritize a targeted reply on the top-zap thread to capture high-intent participants and extend momentum.',
        ].join(' '),
      },
      {
        name: 'profile insights',
        prompt: [
          'Write 3 informative sentences about this profile.',
          'Bio: "Building open protocols. Cypherpunk at heart."',
        ].join('\n'),
        gemmaStrong: [
          'This profile focuses on open protocols and privacy with a concise, technically grounded voice.',
          'Their posts appeal to builders and users who care about decentralization and digital rights.',
          'A practical way to engage is to ask for their view on specific UX tradeoffs in protocol design.',
        ].join(' '),
        gemmaWeak: 'profile looks nice and cool cool cool',
        geminiStrong: [
          'The profile emphasizes open-protocol development and privacy values in a direct, principle-driven writing style.',
          'Its content is most relevant to technical communities working on decentralized systems and user sovereignty.',
          'Engage with a concrete question about implementation tradeoffs to trigger a higher-signal response.',
        ].join(' '),
      },
    ] as const

    it.each(taskCases)('keeps quality high for $name with Gemini option and enhancement path', async (taskCase) => {
      generateText.mockResolvedValue(taskCase.gemmaStrong)
      setGeminiTextResponse(taskCase.geminiStrong)

      const gemmaOnlyResult = await generateAssistText(taskCase.prompt, { provider: 'gemma' })
      const gemmaOnlyScore = evaluateAssistQuality(gemmaOnlyResult.text)
      expect(gemmaOnlyResult.source).toBe('gemma')
      expect(gemmaOnlyResult.enhancedByGemini).toBe(false)
      expect(gemmaOnlyScore).toBeGreaterThanOrEqual(0.52)

      setGeminiTextResponse(taskCase.geminiStrong)
      const geminiOnlyResult = await generateAssistText(taskCase.prompt, { provider: 'gemini' })
      const geminiOnlyScore = evaluateAssistQuality(geminiOnlyResult.text)
      expect(geminiOnlyResult.source).toBe('gemini')
      expect(geminiOnlyResult.enhancedByGemini).toBe(false)
      expect(geminiOnlyScore).toBeGreaterThanOrEqual(0.52)

      generateText.mockResolvedValue(taskCase.gemmaWeak)
      setGeminiTextResponse(taskCase.geminiStrong)

      const weakGemmaScore = evaluateAssistQuality(taskCase.gemmaWeak)
      const enhancedResult = await generateAssistText(taskCase.prompt, { provider: 'gemma' })
      const enhancedScore = evaluateAssistQuality(enhancedResult.text)

      expect(weakGemmaScore).toBeLessThan(0.52)
      expect(enhancedResult.source).toBe('gemini')
      expect(enhancedResult.enhancedByGemini).toBe(true)
      expect(enhancedScore).toBeGreaterThanOrEqual(0.52)
      expect(enhancedScore).toBeGreaterThan(weakGemmaScore)
    })

    it('prints per-task quality delta summary for Gemma and Gemini paths', () => {
      const summaryRows = taskCases.map((taskCase) => {
        const weakGemmaScore = evaluateAssistQuality(taskCase.gemmaWeak)
        const strongGemmaScore = evaluateAssistQuality(taskCase.gemmaStrong)
        const geminiScore = evaluateAssistQuality(taskCase.geminiStrong)

        return {
          task: taskCase.name,
          weakGemma: Number(weakGemmaScore.toFixed(4)),
          strongGemma: Number(strongGemmaScore.toFixed(4)),
          gemini: Number(geminiScore.toFixed(4)),
          enhancedDelta: Number((geminiScore - weakGemmaScore).toFixed(4)),
          gemmaStrongDelta: Number((strongGemmaScore - weakGemmaScore).toFixed(4)),
        }
      })

      console.table(summaryRows)

      for (const row of summaryRows) {
        expect(row.weakGemma).toBeLessThan(0.52)
        expect(row.gemini).toBeGreaterThanOrEqual(0.52)
        expect(row.enhancedDelta).toBeGreaterThan(0)
      }
    })
  })
})

afterEach(() => {
  if (originalFetch) {
    ;(globalThis as { fetch?: typeof fetch }).fetch = originalFetch
    return
  }
  delete (globalThis as { fetch?: typeof fetch }).fetch
})
