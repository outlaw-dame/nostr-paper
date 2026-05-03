import { INTERNAL_SYSTEM_KEYWORD_TERMS } from '@nostr-paper/content-policy'
import type { KeywordFilter } from './types'

function canonicalTerm(term: string): string {
  return term.trim().replace(/\s+/g, ' ').toLowerCase()
}

function makeSystemFilter(term: string, index: number): KeywordFilter {
  const canonical = canonicalTerm(term)
  const slug = canonical
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `rule-${index + 1}`

  return {
    id: `system-block-${slug}`,
    term: canonical,
    action: 'block',
    scope: 'content',
    wholeWord: true,
    semantic: true,
    enabled: true,
    createdAt: 0,
    expiresAt: null,
  }
}

export const SYSTEM_KEYWORD_FILTERS: KeywordFilter[] = [...INTERNAL_SYSTEM_KEYWORD_TERMS]
  .map(canonicalTerm)
  .filter((term, index, arr) => term.length > 0 && arr.indexOf(term) === index)
  .map(makeSystemFilter)

function filterSignature(filter: KeywordFilter): string {
  return [
    canonicalTerm(filter.term),
    filter.action,
    filter.scope,
    filter.wholeWord ? 'whole' : 'partial',
    filter.semantic ? 'semantic' : 'text',
  ].join('|')
}

export function getEffectiveKeywordFilters(userFilters: KeywordFilter[]): KeywordFilter[] {
  if (userFilters.length === 0) return SYSTEM_KEYWORD_FILTERS

  const seenSignatures = new Set(userFilters.map(filterSignature))
  const systemOnly = SYSTEM_KEYWORD_FILTERS.filter((filter) => !seenSignatures.has(filterSignature(filter)))
  return [...userFilters, ...systemOnly]
}
