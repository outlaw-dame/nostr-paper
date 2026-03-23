/**
 * Keyword Filter — synchronous text matcher
 *
 * Implements Tier-1 matching: fast, zero-ML text search applied across all
 * filterable fields.  Improvements over Mastodon's approach:
 *
 *   • Unicode NFD normalisation + diacritic stripping so "résumé" matches
 *     a filter for "resume" and vice-versa.
 *   • True word-boundary detection via Unicode-aware lookbehind/lookahead so
 *     whole-word mode doesn't break on punctuation or emoji boundaries.
 *   • Native hashtag matching (#t tags normalised before comparison).
 *   • Phrase support — multi-word terms are treated as substring searches
 *     with optional boundary enforcement at the phrase edges only.
 *   • Scope control — check just content, just author fields, just hashtags,
 *     or everything at once.
 *   • Per-match field attribution for rich warn-UI explanations.
 */

import type {
  KeywordFilter,
  EventTextFields,
  ProfileTextFields,
  FilterMatch,
  FilterCheckResult,
  MatchedField,
} from './types'

// ── Unicode normalisation ─────────────────────────────────────────────────────

function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip combining diacritics (é → e)
    .toLowerCase()
}

// ── Pattern building ──────────────────────────────────────────────────────────

/**
 * Build a RegExp for the filter term.
 *
 * For whole-word mode we use `(?<![\\w])` / `(?![\\w])` lookbehind/ahead.
 * This is intentionally character-class based rather than `\b` because `\b`
 * treats accented characters as non-word characters in most engines, which
 * would make "café" not match a whole-word filter for "café".
 *
 * Hashtag terms (starting with #) skip word-boundary logic because the `#`
 * character itself acts as the left boundary.
 */
function buildPattern(term: string, wholeWord: boolean): RegExp | null {
  const norm = normalise(term).trim()
  if (!norm) return null

  const escaped = norm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // #hashtag — match the normalised hashtag literally; # is its own boundary
  if (escaped.startsWith('#')) {
    return new RegExp(escaped, 'i')
  }

  return wholeWord
    ? new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'iu')
    : new RegExp(escaped, 'i')
}

// ── Field helpers ─────────────────────────────────────────────────────────────

const EXCERPT_MAX = 120

function excerptAround(text: string, pattern: RegExp): string {
  const idx = text.search(pattern)
  if (idx < 0) return text.slice(0, EXCERPT_MAX)
  const start = Math.max(0, idx - 30)
  const end   = Math.min(text.length, idx + 90)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

function testField(
  pattern:  RegExp,
  rawText:  string,
  field:    MatchedField,
  filter:   KeywordFilter,
): FilterMatch | null {
  if (!rawText.trim()) return null
  if (!pattern.test(normalise(rawText))) return null

  return {
    filterId:  filter.id,
    term:      filter.term,
    action:    filter.action,
    field,
    excerpt:   excerptAround(rawText, pattern),
    semantic:  false,
  }
}

/**
 * Normalised hashtag matching — strips the leading # from both the term
 * and the tag before comparing so "#bitcoin" and "bitcoin" both match
 * events with a `t` tag of "bitcoin" or "Bitcoin".
 */
function testHashtag(filter: KeywordFilter, hashtags: string[]): FilterMatch | null {
  const needle = normalise(filter.term).replace(/^#/, '').trim()
  if (!needle) return null

  for (const tag of hashtags) {
    if (normalise(tag).replace(/^#/, '') === needle) {
      return {
        filterId:  filter.id,
        term:      filter.term,
        action:    filter.action,
        field:     'hashtag',
        excerpt:   `#${tag}`,
        semantic:  false,
      }
    }
  }
  return null
}

function testPollOptions(
  pattern:  RegExp,
  options:  string[],
  filter:   KeywordFilter,
): FilterMatch | null {
  for (const option of options) {
    const m = testField(pattern, option, 'pollOption', filter)
    if (m) return m
  }
  return null
}

// ── Per-filter dispatch ───────────────────────────────────────────────────────

function checkFilter(
  filter: KeywordFilter,
  fields: EventTextFields,
): FilterMatch | null {
  const { scope, wholeWord } = filter

  // Hashtag scope — only #t tags
  if (scope === 'hashtag') {
    return testHashtag(filter, fields.hashtags)
  }

  const pattern = buildPattern(filter.term, wholeWord)
  if (!pattern) return null

  if (scope === 'author') {
    return (
      testField(pattern, fields.authorName,  'authorName',  filter) ??
      testField(pattern, fields.authorBio,   'authorBio',   filter) ??
      testField(pattern, fields.authorNip05, 'authorNip05', filter)
    )
  }

  if (scope === 'content') {
    return (
      testField(pattern, fields.content,  'content',  filter) ??
      testField(pattern, fields.title,    'title',    filter) ??
      testField(pattern, fields.summary,  'summary',  filter) ??
      testField(pattern, fields.subject,  'subject',  filter) ??
      testField(pattern, fields.alt,      'alt',      filter) ??
      testHashtag(filter, fields.hashtags)                    ??
      testPollOptions(pattern, fields.pollOptions, filter)
    )
  }

  // scope === 'any' — check everything
  return (
    testField(pattern, fields.content,     'content',    filter) ??
    testField(pattern, fields.title,       'title',      filter) ??
    testField(pattern, fields.summary,     'summary',    filter) ??
    testField(pattern, fields.subject,     'subject',    filter) ??
    testField(pattern, fields.alt,         'alt',        filter) ??
    testHashtag(filter, fields.hashtags)                         ??
    testPollOptions(pattern, fields.pollOptions, filter)         ??
    testField(pattern, fields.authorName,  'authorName',  filter) ??
    testField(pattern, fields.authorBio,   'authorBio',   filter) ??
    testField(pattern, fields.authorNip05, 'authorNip05', filter)
  )
}

// ── Aggregation ───────────────────────────────────────────────────────────────

function activeFilters(filters: KeywordFilter[]): KeywordFilter[] {
  const now = Date.now()
  return filters.filter(
    f => f.enabled && (f.expiresAt === null || f.expiresAt > now),
  )
}

function aggregate(matches: FilterMatch[]): FilterCheckResult {
  if (!matches.length) return { action: null, matches: [] }
  // A single 'hide' match escalates the whole result to 'hide'
  const action: FilterCheckResult['action'] =
    matches.some(m => m.action === 'hide') ? 'hide' : 'warn'
  return { action, matches }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Synchronously check an event's text fields against all active filters.
 * Returns the worst-case action and every match found.
 */
export function checkEventText(
  fields:  EventTextFields,
  filters: KeywordFilter[],
): FilterCheckResult {
  const active  = activeFilters(filters)
  const matches = active
    .map(f => checkFilter(f, fields))
    .filter((m): m is FilterMatch => m !== null)
  return aggregate(matches)
}

/**
 * Synchronously check a profile's text fields against all active filters.
 * Content-scoped and hashtag-scoped filters are excluded (profiles have
 * neither post content nor hashtags).
 */
export function checkProfileText(
  fields:  ProfileTextFields,
  filters: KeywordFilter[],
): FilterCheckResult {
  const active = activeFilters(filters).filter(
    f => f.scope === 'any' || f.scope === 'author',
  )
  const matches: FilterMatch[] = []

  for (const filter of active) {
    const pattern = buildPattern(filter.term, filter.wholeWord)
    if (!pattern) continue

    const match =
      testField(pattern, fields.displayName, 'authorName',  filter) ??
      testField(pattern, fields.name,        'authorName',  filter) ??
      testField(pattern, fields.about,       'authorBio',   filter) ??
      testField(pattern, fields.nip05,       'authorNip05', filter)

    if (match) matches.push(match)
  }

  return aggregate(matches)
}

/**
 * Merge a text-match result with an async semantic result.
 * If either says 'hide', the merged action is 'hide'.
 */
export function mergeResults(
  text:     FilterCheckResult,
  semantic: FilterCheckResult,
): FilterCheckResult {
  const matches = [...text.matches, ...semantic.matches]
  return aggregate(matches)
}
