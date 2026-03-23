import { describe, expect, it } from 'vitest'
import { detectScriptLanguage } from '@/lib/translation/detect'

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
