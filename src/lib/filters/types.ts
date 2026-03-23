/**
 * Keyword Filter — types
 *
 * A two-tier system that significantly improves on Mastodon's keyword
 * filtering model:
 *
 *   Tier 1 — Fast synchronous text matching
 *     Exact, whole-word, and phrase matching with Unicode normalisation,
 *     diacritic stripping, and proper word-boundary handling.  Applies to
 *     every filterable field on an event or profile.
 *
 *   Tier 2 — Semantic similarity (async, cached)
 *     Reuses the existing `Xenova/all-MiniLM-L6-v2` sentence-embedding
 *     worker.  When `semantic: true` the filter term is embedded and
 *     compared against content embeddings via cosine similarity.  A match
 *     at ≥ 0.42 means "violence" also catches "assault", "brutality",
 *     "conflict", etc. without the user having to enumerate synonyms.
 *
 * Filterable spaces (beyond Mastodon's content-only approach):
 *   • Note content / article body
 *   • Title, summary, subject, alt tags
 *   • Poll option labels
 *   • Hashtags (#t tags)
 *   • Author display name + username
 *   • Author bio (about)
 *   • Author NIP-05 identifier
 */

// ── Filter rule ──────────────────────────────────────────────────────────────

/** What to do when the filter matches. */
export type FilterAction = 'hide' | 'warn'

/**
 * Which fields to check.
 *   'any'     — all fields (default)
 *   'content' — note body, title, summary, hashtags, poll options
 *   'author'  — display name, username, bio, NIP-05
 *   'hashtag' — only #t hashtag tags (exact, normalised)
 */
export type FilterScope = 'any' | 'content' | 'author' | 'hashtag'

export interface KeywordFilter {
  id:         string
  term:       string           // user-entered word, phrase, or #hashtag
  action:     FilterAction
  scope:      FilterScope
  /** Require a word boundary so "ass" doesn't match "class". */
  wholeWord:  boolean
  /** Also run semantic embedding similarity check (async, cached). */
  semantic:   boolean
  enabled:    boolean
  createdAt:  number           // Unix ms
  expiresAt:  number | null    // Unix ms, null = never
}

export type CreateFilterInput = Omit<KeywordFilter, 'id' | 'createdAt'>

// ── Match result ────────────────────────────────────────────────────────────

export type MatchedField =
  | 'content'
  | 'title'
  | 'summary'
  | 'subject'
  | 'alt'
  | 'pollOption'
  | 'hashtag'
  | 'authorName'
  | 'authorBio'
  | 'authorNip05'

export interface FilterMatch {
  filterId:    string
  term:        string
  action:      FilterAction
  field:       MatchedField
  /** Short excerpt of the matched text (for the warn UI label). */
  excerpt:     string
  /** True when matched via semantic embedding rather than text search. */
  semantic:    boolean
}

export interface FilterCheckResult {
  /** null = not filtered. */
  action:  FilterAction | null
  matches: FilterMatch[]
}

// ── Extracted text fields ───────────────────────────────────────────────────

/** All filterable text extracted from a NostrEvent + optional author profile. */
export interface EventTextFields {
  content:     string
  title:       string
  summary:     string
  subject:     string
  alt:         string
  hashtags:    string[]
  pollOptions: string[]
  authorName:  string
  authorBio:   string
  authorNip05: string
}

/** All filterable text extracted from a Profile. */
export interface ProfileTextFields {
  name:        string
  displayName: string
  about:       string
  nip05:       string
}
