import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TranslationServiceError } from '@/lib/translation/errors'
import type { TranslationConfiguration } from '@/lib/translation/storage'

const loadTranslationConfiguration = vi.fn()

vi.mock('@/lib/translation/storage', () => ({
  loadTranslationConfiguration,
}))

const listSmall100Languages = vi.fn(async () => [])
const translateWithSmall100 = vi.fn()
const checkSmall100Health = vi.fn(async () => false)

const listOpusMtLanguages = vi.fn(async () => [])
const translateWithOpusMt = vi.fn()

const listTranslangLanguages = vi.fn(async () => [])
const translateWithTranslang = vi.fn()

const listGemmaLanguages = vi.fn(async () => [])
const translateWithGemma = vi.fn()
const listGeminiLanguages = vi.fn(async () => [])
const translateWithGemini = vi.fn()

vi.mock('@/lib/translation/engines/small100', () => ({
  checkSmall100Health,
  listSmall100Languages,
  translateWithSmall100,
}))

vi.mock('@/lib/translation/engines/opusMt', () => ({
  listOpusMtLanguages,
  translateWithOpusMt,
}))

vi.mock('@/lib/translation/engines/translang', () => ({
  listTranslangLanguages,
  translateWithTranslang,
}))

vi.mock('@/lib/translation/engines/gemma', () => ({
  getGemmaTransportSummary: () => 'Runs entirely on-device.',
  listGemmaLanguages,
  translateWithGemma,
}))

vi.mock('@/lib/translation/engines/gemini', () => ({
  getGeminiTransportSummary: () => 'Uses the Google Gemini cloud API.',
  listGeminiLanguages,
  translateWithGemini,
}))

const {
  inspectTranslationWithConfiguration,
  translateConfiguredText,
  translateTextWithConfiguration,
} = await import('@/lib/translation/client')

function buildConfiguration(overrides: Partial<TranslationConfiguration>): TranslationConfiguration {
  return {
    provider: 'deepl',
    deeplPlan: 'free',
    deeplTargetLanguage: 'EN-US',
    deeplSourceLanguage: 'auto',
    deeplAuthKey: '',
    libreBaseUrl: '',
    libreTargetLanguage: 'en',
    libreSourceLanguage: 'auto',
    libreApiKey: '',
    translangBaseUrl: '',
    translangTargetLanguage: 'en',
    translangSourceLanguage: 'auto',
    lingvaBaseUrl: '',
    lingvaTargetLanguage: 'en',
    lingvaSourceLanguage: 'auto',
    small100BaseUrl: 'http://localhost:7080',
    small100TargetLanguage: 'en',
    small100SourceLanguage: 'auto',
    opusMtTargetLanguage: 'en',
    opusMtSourceLanguage: 'auto',
    gemmaTargetLanguage: 'en',
    gemmaSourceLanguage: 'auto',
    geminiModel: 'gemini-2.5-flash',
    geminiTargetLanguage: 'en',
    geminiSourceLanguage: 'auto',
    geminiApiKey: '',
    ...overrides,
  }
}

describe('translateTextWithConfiguration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dispatches to the TransLang provider with detected language support', async () => {
    translateWithTranslang.mockResolvedValue({
      translation: 'Hello world',
      detectedSourceLang: 'ja',
    })

    const result = await translateTextWithConfiguration(buildConfiguration({
      provider: 'translang',
      translangBaseUrl: 'https://translang.example.com',
      translangTargetLanguage: 'en',
      translangSourceLanguage: 'auto',
      lingvaBaseUrl: 'https://lingva.example.com',
    }), 'こんにちは世界')

    expect(translateWithTranslang).toHaveBeenCalledWith(
      'https://translang.example.com',
      'こんにちは世界',
      'auto',
      'en',
      undefined,
    )
    expect(result).toMatchObject({
      provider: 'translang',
      translatedText: 'Hello world',
      detectedSourceLanguage: 'ja',
      targetLanguage: 'en',
      sourceLanguage: 'auto',
    })
  })

  it('still surfaces Opus-MT pair errors when the local model cannot translate', async () => {
    translateWithOpusMt.mockRejectedValue(new TranslationServiceError(
      'Opus-MT has no model for hi→en. Use TransLang or SMaLL-100 for broader language coverage.',
      { code: 'config' },
    ))

    await expect(translateTextWithConfiguration(buildConfiguration({
      provider: 'opusmt',
      translangBaseUrl: 'https://translang.example.com',
      lingvaBaseUrl: 'https://lingva.example.com',
      opusMtTargetLanguage: 'en',
      opusMtSourceLanguage: 'hi',
    }), 'नमस्ते दुनिया')).rejects.toThrow('Opus-MT has no model for hi→en')
  })

  it('skips translation when the text already appears to match the target language', async () => {
    await expect(translateTextWithConfiguration(buildConfiguration({
      provider: 'translang',
      translangBaseUrl: 'https://translang.example.com',
      translangTargetLanguage: 'en',
      lingvaBaseUrl: 'https://lingva.example.com',
    }), 'This release note is already written in English for the current audience.')).rejects.toThrow('Text already matches your target language.')

    expect(translateWithTranslang).not.toHaveBeenCalled()
  })

  it('inspects auto-translate safety for Opus-MT latin text', () => {
    expect(inspectTranslationWithConfiguration(buildConfiguration({
      provider: 'opusmt',
      translangBaseUrl: 'https://translang.example.com',
      translangTargetLanguage: 'en',
      lingvaBaseUrl: 'https://lingva.example.com',
      opusMtTargetLanguage: 'es',
      opusMtSourceLanguage: 'auto',
    }), 'Release notes and product details for a broad audience')).toMatchObject({
      likelySourceLanguage: 'en',
      sameLanguage: false,
      canAutoTranslate: true,
    })
  })

  it('treats short ASCII snippets as same-language when the target is English', () => {
    expect(inspectTranslationWithConfiguration(buildConfiguration({
      provider: 'opusmt',
      opusMtTargetLanguage: 'en',
      opusMtSourceLanguage: 'auto',
    }), 'Breaking news')).toMatchObject({
      sameLanguage: true,
      canAutoTranslate: false,
    })
  })

  it('dispatches to the Gemma provider with local language settings', async () => {
    translateWithGemma.mockResolvedValue({
      translation: 'Hello world',
      detectedSourceLang: 'ja',
    })

    const result = await translateTextWithConfiguration(buildConfiguration({
      provider: 'gemma',
      gemmaSourceLanguage: 'auto',
      gemmaTargetLanguage: 'en',
    }), 'こんにちは世界')

    expect(translateWithGemma).toHaveBeenCalledWith('こんにちは世界', 'auto', 'en', undefined)
    expect(result).toMatchObject({
      provider: 'gemma',
      translatedText: 'Hello world',
      detectedSourceLanguage: 'ja',
      targetLanguage: 'en',
    })
  })

  it('falls back to Opus-MT when the configured provider is unavailable', async () => {
    loadTranslationConfiguration.mockResolvedValue({
      ...buildConfiguration({
        provider: 'deepl',
        opusMtTargetLanguage: 'en',
        opusMtSourceLanguage: 'ru',
      }),
    })
    translateWithOpusMt.mockResolvedValue({ translation: 'Hello world' })

    const result = await translateConfiguredText('Привет, мир')

    expect(result).toMatchObject({
      provider: 'opusmt',
      translatedText: 'Hello world',
      targetLanguage: 'en',
    })
    expect(translateWithOpusMt).toHaveBeenCalled()
  })

  it('dispatches to the Gemini provider with cloud language settings', async () => {
    translateWithGemini.mockResolvedValue({
      translation: 'Hello world',
      detectedSourceLang: 'ja',
    })

    const result = await translateTextWithConfiguration(buildConfiguration({
      provider: 'gemini',
      geminiSourceLanguage: 'auto',
      geminiTargetLanguage: 'en',
      geminiModel: 'gemini-2.5-flash',
      geminiApiKey: 'AIza-test',
    }), 'こんにちは世界')

    expect(translateWithGemini).toHaveBeenCalledWith(
      'こんにちは世界',
      'auto',
      'en',
      'AIza-test',
      'gemini-2.5-flash',
      undefined,
    )
    expect(result).toMatchObject({
      provider: 'gemini',
      translatedText: 'Hello world',
      detectedSourceLanguage: 'ja',
      targetLanguage: 'en',
    })
  })
})
