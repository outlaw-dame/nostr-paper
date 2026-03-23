import { normalizeTranslationPreferences } from '@/lib/translation/storage'
import { describe, expect, it } from 'vitest'

describe('normalizeTranslationPreferences', () => {
  it('normalizes DeepL settings and rejects invalid language codes', () => {
    expect(normalizeTranslationPreferences({}).provider).toBe('opusmt')

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
})
