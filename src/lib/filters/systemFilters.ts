import type { KeywordFilter } from './types'

export interface SystemFilterGroup {
  id: string
  title: string
  description: string
  filters: KeywordFilter[]
}

interface SystemFilterGroupDefinition {
  id: string
  title: string
  description: string
  terms: readonly string[]
}

const SYSTEM_FILTER_GROUP_DEFINITIONS: readonly SystemFilterGroupDefinition[] = [
  {
    id: 'identity-hate',
    title: 'Identity Hate Slurs',
    description: 'Hard-blocked racist slurs and common spelling variations.',
    terms: [
      'nigger',
      '#nigger',
      'niggers',
      '#niggers',
      "n's",
      'niggerz',
      '#niggerz',
      'niggersz',
      '#niggersz',
      'n1gger',
      '#n1gger',
      'n1ggers',
      '#n1ggers',
      '#n1ggerz',
      'n1gg3r',
      '#n1gg3r',
      'n1gg3rz',
      'n!ggaz',
      '#n1ggaz',
    ],
  },
  {
    id: 'self-harm-abuse',
    title: 'Abuse And Self-Harm Directives',
    description: 'Threats, suicide-baiting, and common abusive humiliation phrases.',
    terms: [
      '#killyourself',
      'kill yourself',
      '#kys',
      '#godie',
      'go die',
      'betacuck',
      '#betacuck',
      'cuck',
      '#cuck',
      'cuckold',
      '#cuckold',
    ],
  },
  {
    id: 'explicit-sexual',
    title: 'Explicit Sexual Keywords',
    description: 'Pornographic body-part terms, explicit acts, and genre tags.',
    terms: [
      '#girlcock',
      'girl cock',
      '#boypussy',
      'boy pussy',
      'mangina',
      '#mangina',
      'furry sex',
      '#furrysex',
      'trans sex',
      '#transsex',
      'suck my dick',
      '#suckmydick',
      '#suckmycock',
      'suck my cock',
      '#suckmypenis',
      'suck my penis',
      'lick my clit',
      '#lickmyclit',
      'eat my ass',
      '#eatmyass',
      '#eastmyass',
      'cum',
      '#cum',
      'cumslut',
      '#cumslut',
      'cum slut',
      'cumstain',
      '#cumstain',
      '#cumstainm',
      'cum stain',
      '#cumshot',
      'cumshot',
      'cum shot',
      'creampie',
      '#creampie',
      'pegging',
      '#pegging',
      'futa',
      '#futa',
      'scat',
      'scat porn',
      '#scat',
      '#scatporn',
      '#porn',
      'marathi',
      '#marathi',
      'boi pucci',
      '#boipucci',
    ],
  },
  {
    id: 'exploitative-sexual',
    title: 'Exploitative Sexual Content',
    description: 'Incest, exploitative fetish, and sexualized minor-coded terms.',
    terms: [
      'lolicon',
      '#lolicon',
      '#loli',
      'lollicon',
      '#lollicon',
      'lolli',
      '#lolli',
      '#shotacon',
      'shotacon',
      'shota con',
      '#futacon',
      'futacon',
      'futa con',
      'sib cest',
      'sibcest',
      '#sibcest',
      'incest',
      '#incest',
    ],
  },
] as const

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

const seen = new Set<string>()

export const SYSTEM_FILTER_GROUPS: SystemFilterGroup[] = SYSTEM_FILTER_GROUP_DEFINITIONS
  .map((group) => ({
    id: group.id,
    title: group.title,
    description: group.description,
    filters: group.terms
      .map(canonicalTerm)
      .filter((term) => {
        if (!term || seen.has(term)) return false
        seen.add(term)
        return true
      })
      .map(makeSystemFilter),
  }))
  .filter((group) => group.filters.length > 0)

export const SYSTEM_KEYWORD_FILTERS: KeywordFilter[] = SYSTEM_FILTER_GROUPS.flatMap((group) => group.filters)

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