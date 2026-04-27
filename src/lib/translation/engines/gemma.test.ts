import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranslationServiceError } from '@/lib/translation/errors'

const generateText = vi.fn()
const isGemmaAvailable = vi.fn()

vi.mock('@/lib/gemma/client', () => ({
  generateText,
  isGemmaAvailable,
}))

const { translateWithGemma } = await import('@/lib/translation/engines/gemma')

describe('translateWithGemma', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isGemmaAvailable.mockReturnValue(true)
  })

  it('fails closed when the local Gemma runtime is unavailable', async () => {
    isGemmaAvailable.mockReturnValue(false)

    await expect(translateWithGemma('Hola mundo', 'auto', 'en')).rejects.toMatchObject({
      code: 'unavailable',
    } satisfies Partial<TranslationServiceError>)

    expect(generateText).not.toHaveBeenCalled()
  })

  it('keeps ambiguous latin-script source text on auto-detect instead of forcing english', async () => {
    generateText.mockResolvedValue('Hello world')

    await translateWithGemma('Hola mundo desde Barcelona', 'auto', 'en')

    expect(generateText).toHaveBeenCalledTimes(1)
    const [prompt] = generateText.mock.calls[0] ?? []
    expect(prompt).toContain('Source language: detect automatically from the text')
    expect(prompt).not.toContain('Source language: English (en)')
  })

  it('sanitizes wrapped translation boilerplate from the model response', async () => {
    generateText.mockResolvedValue('```text\nTranslation: Bonjour le monde\n```')

    const result = await translateWithGemma('Hello world', 'en', 'fr')

    expect(result).toEqual({ translation: 'Bonjour le monde' })
  })
})
