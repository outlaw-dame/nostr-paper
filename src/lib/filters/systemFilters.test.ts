import { describe, expect, it } from 'vitest'
import { checkEventText } from './matcher'
import { SYSTEM_KEYWORD_FILTERS } from './systemFilters'
import type { EventTextFields } from './types'

function makeFields(overrides: Partial<EventTextFields> = {}): EventTextFields {
  return {
    content: '',
    title: '',
    summary: '',
    subject: '',
    alt: '',
    hashtags: [],
    pollOptions: [],
    authorName: '',
    authorBio: '',
    authorNip05: '',
    ...overrides,
  }
}

describe('SYSTEM_KEYWORD_FILTERS', () => {
  it('contains plain-text and hashtag variants for internal terms', () => {
    const terms = new Set(SYSTEM_KEYWORD_FILTERS.map((filter) => filter.term))

    expect(terms.has('kys')).toBe(true)
    expect(terms.has('#kys')).toBe(true)
  })

  it('blocks plain-text content matches', () => {
    const result = checkEventText(
      makeFields({ content: 'You should kys right now.' }),
      SYSTEM_KEYWORD_FILTERS,
    )

    expect(result.action).toBe('block')
  })

  it('blocks hashtag-only matches when text is otherwise clean', () => {
    const result = checkEventText(
      makeFields({ hashtags: ['kys'] }),
      SYSTEM_KEYWORD_FILTERS,
    )

    expect(result.action).toBe('block')
    expect(result.matches.some((match) => match.field === 'hashtag')).toBe(true)
  })
})
