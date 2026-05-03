import { describe, expect, it } from 'vitest'
import {
  detectLikelyLanguage,
  detectScriptLanguage,
  languagesProbablyMatch,
  looksLikeShortAsciiSnippet,
} from '@/lib/translation/detect'

describe('detectScriptLanguage', () => {
  it('detects additional Asian scripts used by fallback providers', () => {
    expect(detectScriptLanguage('นี่คือประโยคภาษาไทยสำหรับทดสอบ')).toBe('th')
    expect(detectScriptLanguage('यह एक हिन्दी परीक्षण वाक्य है')).toBe('hi')
    expect(detectScriptLanguage('এটি একটি বাংলা পরীক্ষার বাক্য')).toBe('bn')
  })

  it('keeps returning null for clearly Latin-script text', () => {
    expect(detectScriptLanguage('This is an English sentence.')).toBeNull()
  })
})

describe('detectLikelyLanguage', () => {
  it('detects likely English text with common stopwords', () => {
    expect(detectLikelyLanguage('This is an English sentence about the new release and what it means for users.')).toBe('en')
  })

  it('detects common Latin-script languages for local fallback routing', () => {
    expect(detectLikelyLanguage('Este es un mensaje para la comunidad y no se debe perder en el feed.')).toBe('es')
    expect(detectLikelyLanguage('Ceci est une note pour les lecteurs avec le contexte et la suite.')).toBe('fr')
  })
})

describe('looksLikeShortAsciiSnippet', () => {
  it('matches short ASCII snippets and rejects emoji-only text', () => {
    expect(looksLikeShortAsciiSnippet('Breaking news')).toBe(true)
    expect(looksLikeShortAsciiSnippet('hello world')).toBe(true)
    expect(looksLikeShortAsciiSnippet('🔥🔥🔥')).toBe(false)
  })
})

describe('languagesProbablyMatch', () => {
  it('compares primary language subtags only', () => {
    expect(languagesProbablyMatch('en-US', 'en')).toBe(true)
    expect(languagesProbablyMatch('ja', 'en')).toBe(false)
  })
})
