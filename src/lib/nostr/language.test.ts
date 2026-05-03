import { describe, expect, it } from 'vitest'
import { extractEventLanguageTag } from '@/lib/nostr/language'

describe('extractEventLanguageTag', () => {
  it('reads language from explicit l tag namespace', () => {
    expect(extractEventLanguageTag({
      tags: [['l', 'pt-BR', 'ISO-639-1']],
    })).toBe('pt-br')
  })

  it('reads language from l tag when ISO namespace is declared by L tag', () => {
    expect(extractEventLanguageTag({
      tags: [['L', 'ISO-639-1'], ['l', 'ja']],
    })).toBe('ja')
  })

  it('ignores unsupported namespaces and malformed values', () => {
    expect(extractEventLanguageTag({
      tags: [['l', 'english', 'custom'], ['l', 'en us', 'ISO-639-1']],
    })).toBeNull()
  })
})
