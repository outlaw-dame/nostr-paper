import { describe, expect, it } from 'vitest'
import {
  batchTranslationSegments,
  hasMeaningfulTranslationText,
  joinTranslatedSegments,
  markdownToPlainText,
  splitTextForTranslation,
} from '@/lib/translation/text'

describe('splitTextForTranslation', () => {
  it('preserves paragraph boundaries while splitting long text', () => {
    const segments = splitTextForTranslation(
      'First paragraph sentence one. Sentence two.\n\nSecond paragraph is longer than the limit.',
      32,
    )

    expect(segments).toEqual([
      'First paragraph sentence one.',
      'Sentence two.',
      'Second paragraph is longer than',
      'the limit.',
    ])
  })
})

describe('batchTranslationSegments', () => {
  it('chunks segments into fixed-size batches', () => {
    expect(batchTranslationSegments(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e'],
    ])
  })
})

describe('joinTranslatedSegments', () => {
  it('joins non-empty translated segments with paragraph gaps', () => {
    expect(joinTranslatedSegments([' One ', '', 'Two'])).toBe('One\n\nTwo')
  })
})

describe('markdownToPlainText', () => {
  it('strips common markdown syntax into plain text', () => {
    expect(markdownToPlainText('# Title\n\n[Link](https://example.com)\n\n- Item')).toBe(
      'Title\n\nLink\n\nItem',
    )
  })
})

describe('hasMeaningfulTranslationText', () => {
  it('ignores emoji-only text and keeps natural language text', () => {
    expect(hasMeaningfulTranslationText('🔥🔥🔥')).toBe(false)
    expect(hasMeaningfulTranslationText('   😊   ')).toBe(false)
    expect(hasMeaningfulTranslationText('Hello')).toBe(true)
    expect(hasMeaningfulTranslationText('こんにちは')).toBe(true)
  })
})
