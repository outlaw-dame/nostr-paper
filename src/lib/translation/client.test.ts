import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TranslationServiceError } from '@/lib/translation/errors'

const listSmall100Languages = vi.fn(async () => [])
const translateWithSmall100 = vi.fn()
const checkSmall100Health = vi.fn(async () => false)

const listOpusMtLanguages = vi.fn(async () => [])
const translateWithOpusMt = vi.fn()

const listTranslangLanguages = vi.fn(async () => [])
const translateWithTranslang = vi.fn()

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

const {
  inspectTranslationWithConfiguration,
  translateTextWithConfiguration,
} = await import('@/lib/translation/client')

describe('translateTextWithConfiguration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dispatches to the TransLang provider with detected language support', async () => {
    translateWithTranslang.mockResolvedValue({
      translation: 'Hello world',
      detectedSourceLang: 'ja',
    })

    const result = await translateTextWithConfiguration({
      provider: 'translang',
      deeplPlan: 'free',
      deeplTargetLanguage: 'EN-US',
      deeplSourceLanguage: 'auto',
      deeplAuthKey: '',
      libreBaseUrl: '',
      libreTargetLanguage: 'en',
      libreSourceLanguage: 'auto',
      libreApiKey: '',
      translangBaseUrl: 'https://translang.example.com',
      translangTargetLanguage: 'en',
      translangSourceLanguage: 'auto',
      lingvaBaseUrl: 'https://lingva.example.com',
      lingvaTargetLanguage: 'en',
      lingvaSourceLanguage: 'auto',
      small100BaseUrl: 'http://localhost:7080',
      small100TargetLanguage: 'en',
      small100SourceLanguage: 'auto',
      opusMtTargetLanguage: 'en',
      opusMtSourceLanguage: 'auto',
    }, 'こんにちは世界')

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

    await expect(translateTextWithConfiguration({
      provider: 'opusmt',
      deeplPlan: 'free',
      deeplTargetLanguage: 'EN-US',
      deeplSourceLanguage: 'auto',
      deeplAuthKey: '',
      libreBaseUrl: '',
      libreTargetLanguage: 'en',
      libreSourceLanguage: 'auto',
      libreApiKey: '',
      translangBaseUrl: 'https://translang.example.com',
      translangTargetLanguage: 'en',
      translangSourceLanguage: 'auto',
      lingvaBaseUrl: 'https://lingva.example.com',
      lingvaTargetLanguage: 'en',
      lingvaSourceLanguage: 'auto',
      small100BaseUrl: 'http://localhost:7080',
      small100TargetLanguage: 'en',
      small100SourceLanguage: 'auto',
      opusMtTargetLanguage: 'en',
      opusMtSourceLanguage: 'hi',
    }, 'नमस्ते दुनिया')).rejects.toThrow('Opus-MT has no model for hi→en')
  })

  it('skips translation when the text already appears to match the target language', async () => {
    await expect(translateTextWithConfiguration({
      provider: 'translang',
      deeplPlan: 'free',
      deeplTargetLanguage: 'EN-US',
      deeplSourceLanguage: 'auto',
      deeplAuthKey: '',
      libreBaseUrl: '',
      libreTargetLanguage: 'en',
      libreSourceLanguage: 'auto',
      libreApiKey: '',
      translangBaseUrl: 'https://translang.example.com',
      translangTargetLanguage: 'en',
      translangSourceLanguage: 'auto',
      lingvaBaseUrl: 'https://lingva.example.com',
      lingvaTargetLanguage: 'en',
      lingvaSourceLanguage: 'auto',
      small100BaseUrl: 'http://localhost:7080',
      small100TargetLanguage: 'en',
      small100SourceLanguage: 'auto',
      opusMtTargetLanguage: 'en',
      opusMtSourceLanguage: 'auto',
    }, 'This release note is already written in English for the current audience.')).rejects.toThrow('Text already matches your target language.')

    expect(translateWithTranslang).not.toHaveBeenCalled()
  })

  it('inspects auto-translate safety for Opus-MT latin text', () => {
    expect(inspectTranslationWithConfiguration({
      provider: 'opusmt',
      deeplPlan: 'free',
      deeplTargetLanguage: 'EN-US',
      deeplSourceLanguage: 'auto',
      deeplAuthKey: '',
      libreBaseUrl: '',
      libreTargetLanguage: 'en',
      libreSourceLanguage: 'auto',
      libreApiKey: '',
      translangBaseUrl: 'https://translang.example.com',
      translangTargetLanguage: 'en',
      translangSourceLanguage: 'auto',
      lingvaBaseUrl: 'https://lingva.example.com',
      lingvaTargetLanguage: 'en',
      lingvaSourceLanguage: 'auto',
      small100BaseUrl: 'http://localhost:7080',
      small100TargetLanguage: 'en',
      small100SourceLanguage: 'auto',
      opusMtTargetLanguage: 'es',
      opusMtSourceLanguage: 'auto',
    }, 'Release notes and product details for a broad audience')).toMatchObject({
      likelySourceLanguage: 'en',
      sameLanguage: false,
      canAutoTranslate: true,
    })
  })
})
