import { describe, expect, it } from 'vitest'
import type { EventTextFields, KeywordFilter, ProfileTextFields } from './types'
import { checkEventText, checkProfileText, mergeResults } from './matcher'

function makeFilter(overrides: Partial<KeywordFilter> = {}): KeywordFilter {
  return {
    id: 'filter-1',
    term: 'resume',
    action: 'warn',
    scope: 'any',
    wholeWord: false,
    semantic: false,
    enabled: true,
    createdAt: Date.now(),
    expiresAt: null,
    ...overrides,
  }
}

function makeEventFields(overrides: Partial<EventTextFields> = {}): EventTextFields {
  return {
    content: 'This resume checklist helps candidates.',
    title: '',
    summary: '',
    subject: '',
    alt: '',
    hashtags: ['nostr'],
    pollOptions: [],
    authorName: 'Alice',
    authorBio: 'Building clients',
    authorNip05: 'alice@example.com',
    ...overrides,
  }
}

function makeProfileFields(overrides: Partial<ProfileTextFields> = {}): ProfileTextFields {
  return {
    name: 'alice',
    displayName: 'Alice Builder',
    about: 'Building resilient communities',
    nip05: 'alice@example.com',
    ...overrides,
  }
}

describe('checkEventText', () => {
  it('matches diacritic variants case-insensitively', () => {
    const fields = makeEventFields({ content: 'Resume writing and resume review.' })
    const result = checkEventText(fields, [makeFilter({ term: 'résumé' })])

    expect(result.action).toBe('warn')
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]?.field).toBe('content')
  })

  it('respects whole-word mode so partial substrings do not match', () => {
    const fields = makeEventFields({ content: 'Classic classes classification.' })

    const wholeWord = checkEventText(fields, [
      makeFilter({ term: 'class', wholeWord: true, action: 'hide' }),
    ])
    const substring = checkEventText(fields, [
      makeFilter({ term: 'class', wholeWord: false, action: 'hide' }),
    ])

    expect(wholeWord.action).toBeNull()
    expect(substring.action).toBe('hide')
  })

  it('matches hashtag scope with normalized # prefix handling', () => {
    const fields = makeEventFields({ hashtags: ['Bitcoin'] })
    const result = checkEventText(fields, [
      makeFilter({ term: '#bitcoin', scope: 'hashtag', action: 'block' }),
    ])

    expect(result.action).toBe('block')
    expect(result.matches[0]?.field).toBe('hashtag')
  })

  it('applies severity precedence block > hide > warn across multiple matches', () => {
    const fields = makeEventFields({ content: 'Alpha and beta and gamma' })
    const result = checkEventText(fields, [
      makeFilter({ id: 'w', term: 'alpha', action: 'warn' }),
      makeFilter({ id: 'h', term: 'beta', action: 'hide' }),
      makeFilter({ id: 'b', term: 'gamma', action: 'block' }),
    ])

    expect(result.action).toBe('block')
    expect(result.matches).toHaveLength(3)
  })
})

describe('checkProfileText', () => {
  it('only applies any/author filters for profiles', () => {
    const profile = makeProfileFields()

    const result = checkProfileText(profile, [
      makeFilter({ term: 'alice', scope: 'author', action: 'hide' }),
      makeFilter({ term: 'alice', scope: 'content', action: 'block' }),
    ])

    expect(result.action).toBe('hide')
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]?.field).toBe('authorName')
  })
})

describe('mergeResults', () => {
  it('merges text + semantic matches and preserves highest severity', () => {
    const merged = mergeResults(
      {
        action: 'hide',
        matches: [{
          filterId: 'text-1',
          term: 'violence',
          action: 'hide',
          field: 'content',
          excerpt: 'violence',
          semantic: false,
        }],
      },
      {
        action: 'block',
        matches: [{
          filterId: 'sem-1',
          term: 'abuse',
          action: 'block',
          field: 'content',
          excerpt: '',
          semantic: true,
        }],
      },
    )

    expect(merged.action).toBe('block')
    expect(merged.matches).toHaveLength(2)
    expect(merged.matches.some((m) => m.semantic)).toBe(true)
  })
})
