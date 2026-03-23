import { describe, it, expect } from 'vitest'
import { parseSearchQuery, sanitizeFts5Query } from './search'

describe('parseSearchQuery', () => {
  it('preserves the relay query while extracting local domain filters', () => {
    const parsed = parseSearchQuery('"best nostr app" domain:Example.COM')

    expect(parsed.relayQuery).toBe('"best nostr app" domain:Example.COM')
    expect(parsed.localQuery).toBe('"best nostr app"')
    expect(parsed.domains).toEqual(['example.com'])
    expect(parsed.unsupportedExtensions).toEqual([])
  })

  it('keeps non-standard key:value text searchable locally', () => {
    const parsed = parseSearchQuery('nostr:npub1something hello')

    expect(parsed.localQuery).toBe('nostr npub1something hello')
    expect(parsed.domains).toEqual([])
  })

  it('tracks relay-only standardized extensions separately', () => {
    const parsed = parseSearchQuery('hello language:en sentiment:positive')

    expect(parsed.localQuery).toBe('hello')
    expect(parsed.unsupportedExtensions).toEqual([
      { key: 'language', value: 'en' },
      { key: 'sentiment', value: 'positive' },
    ])
  })

  it('supports domain-only queries for local filtering', () => {
    const parsed = parseSearchQuery('domain:example.com')

    expect(parsed.localQuery).toBeNull()
    expect(parsed.domains).toEqual(['example.com'])
  })

  it('caps forwarded queries to the maximum supported length', () => {
    const parsed = parseSearchQuery(`hello ${'a'.repeat(600)}`)

    expect(parsed.relayQuery?.length).toBe(512)
  })
})

describe('sanitizeFts5Query', () => {
  it('quotes boolean keywords so they remain searchable terms', () => {
    expect(sanitizeFts5Query('OR AND NOT')).toBe('"OR" "AND" "NOT"')
  })

  it('returns null when only relay-only standardized filters remain', () => {
    expect(sanitizeFts5Query('language:en sentiment:positive')).toBeNull()
  })
})
