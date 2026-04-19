import { normalizeTranslationPreferences } from '@/lib/translation/storage'
import { afterEach, describe, expect, it } from 'vitest'

const originalNavigator = globalThis.navigator

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    value: originalNavigator,
    configurable: true,
  })
})

describe('normalizeTranslationPreferences', () => {
  it('normalizes DeepL settings and rejects invalid language codes', () => {
    expect(normalizeTranslationPreferences({}).provider).toBe('deepl')

    expect(normalizeTranslationPreferences({
      provider: 'deepl',
      deeplPlan: 'pro',
      deeplTargetLanguage: 'de',
      deeplSourceLanguage: 'en',
    })).toMatchObject({
      provider: 'deepl',
      deeplPlan: 'pro',
      deeplTargetLanguage: 'DE',
      deeplSourceLanguage: 'EN',
    })

    expect(normalizeTranslationPreferences({
      provider: 'deepl',
      deeplTargetLanguage: 'not-a-language',
      deeplSourceLanguage: '???',
    })).toMatchObject({
      deeplTargetLanguage: 'EN-US',
      deeplSourceLanguage: 'auto',
    })
  })

  it('normalizes LibreTranslate settings and strips unsafe base URLs', () => {
    expect(normalizeTranslationPreferences({
      provider: 'libretranslate',
      libreBaseUrl: 'https://translate.example.com/',
      libreTargetLanguage: 'ES',
      libreSourceLanguage: 'AUTO',
    })).toMatchObject({
      provider: 'libretranslate',
      libreBaseUrl: 'https://translate.example.com',
      libreTargetLanguage: 'es',
      libreSourceLanguage: 'auto',
    })

    expect(normalizeTranslationPreferences({
      provider: 'libretranslate',
      libreBaseUrl: 'http://example.com',
    }).libreBaseUrl).toBe('')
  })

  it('normalizes TransLang settings with canonical language casing', () => {
    expect(normalizeTranslationPreferences({
      provider: 'translang',
      translangBaseUrl: 'https://translang.example.com/',
      translangTargetLanguage: 'zh-cn',
      translangSourceLanguage: 'AUTO',
    })).toMatchObject({
      provider: 'translang',
      translangBaseUrl: 'https://translang.example.com',
      translangTargetLanguage: 'zh-CN',
      translangSourceLanguage: 'auto',
    })
  })

  it('normalizes Lingva settings like other remote providers', () => {
    expect(normalizeTranslationPreferences({
      provider: 'lingva',
      lingvaBaseUrl: 'https://lingva.example.com/',
      lingvaTargetLanguage: 'ES',
      lingvaSourceLanguage: 'AUTO',
    })).toMatchObject({
      provider: 'lingva',
      lingvaBaseUrl: 'https://lingva.example.com',
      lingvaTargetLanguage: 'es',
      lingvaSourceLanguage: 'auto',
    })
  })

  it('falls back to the browser language for target defaults when unset', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        language: 'fr-CA',
        languages: ['fr-CA', 'en-US'],
      },
      configurable: true,
    })

    expect(normalizeTranslationPreferences({
      provider: 'opusmt',
    })).toMatchObject({
      opusMtTargetLanguage: 'fr',
      gemmaTargetLanguage: 'fr',
      geminiTargetLanguage: 'fr',
      libreTargetLanguage: 'fr',
      lingvaTargetLanguage: 'fr',
      translangTargetLanguage: 'fr-CA',
      deeplTargetLanguage: 'FR-CA',
    })
  })

  it('normalizes Gemini settings and model names', () => {
    expect(normalizeTranslationPreferences({
      provider: 'gemini',
      geminiModel: 'gemini-2.5-flash',
      geminiTargetLanguage: 'ES',
      geminiSourceLanguage: 'AUTO',
    })).toMatchObject({
      provider: 'gemini',
      geminiModel: 'gemini-2.5-flash',
      geminiTargetLanguage: 'es',
      geminiSourceLanguage: 'auto',
    })

    expect(normalizeTranslationPreferences({
      provider: 'gemini',
      geminiModel: 'bad model !',
    }).geminiModel).toBe('gemini-2.5-flash')
  })
})
