import { normalizeHashtag } from '@/lib/security/sanitize'
import { eventToSemanticText } from '@/lib/semantic/text'
import type { NostrEvent } from '@/types'

export type TagTimelineMode = 'any' | 'all'

export interface TagTimelineSpec {
  includeTags: string[]
  excludeTags: string[]
  mode: TagTimelineMode
}

export interface TagTimelineDescriptor extends TagTimelineSpec {
  title: string
  summary: string
}

const MAX_TIMELINE_TAGS = 6
const TAG_SPLIT_RE = /[+,\s]+/
const TIMELINE_TEXT_TERM_RE = /[^a-z0-9]+/g

export const TAG_TIMELINE_SEMANTIC_THRESHOLD = 0.48
export const TAG_TIMELINE_ALL_MODE_SEMANTIC_THRESHOLD = 0.56

function uniqueTags(values: string[]): string[] {
  return [...new Set(values)].slice(0, MAX_TIMELINE_TAGS)
}

function normalizeTagList(raw: string | null | undefined): string[] {
  if (!raw) return []

  return uniqueTags(
    raw
      .split(TAG_SPLIT_RE)
      .map((part) => normalizeHashtag(part))
      .filter((part): part is string => part !== null),
  )
}

export function normalizeTagTimelineTags(raw: string | null | undefined): string[] {
  return normalizeTagList(raw)
}

function formatTag(tag: string): string {
  return `#${tag}`
}

function formatTagList(tags: string[]): string {
  return tags.map(formatTag).join(', ')
}

function normalizeTimelineTerm(value: string): string {
  return value
    .toLowerCase()
    .replace(TIMELINE_TEXT_TERM_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function timelineTagToPlainTerm(tag: string): string {
  return normalizeTimelineTerm(tag.replace(/[_-]+/g, ' '))
}

function buildTimelineTermSet(tags: string[]): string[] {
  return [...new Set(
    tags
      .flatMap((tag) => [tag, timelineTagToPlainTerm(tag)])
      .map((value) => value.trim())
      .filter(Boolean),
  )]
}

function eventMatchesTimelineTerm(text: string, term: string): boolean {
  if (!text || !term) return false
  if (term.includes(' ')) return text.includes(term)

  const pattern = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[^a-z0-9]|$)`, 'i')
  return pattern.test(text)
}

function getTimelineEventText(event: NostrEvent): string {
  return normalizeTimelineTerm(eventToSemanticText(event) ?? event.content)
}

export function buildTagTimelineSemanticQuery(spec: TagTimelineSpec | null): string | null {
  if (!spec || spec.includeTags.length === 0) return null

  const query = buildTimelineTermSet(spec.includeTags).join(' ').trim()
  return query.length > 0 ? query : null
}

export function getTagTimelineKey(spec: TagTimelineSpec | null): string {
  if (!spec || spec.includeTags.length === 0) return 'empty'

  const includeTags = uniqueTags(spec.includeTags)
  const excludeTags = uniqueTags(spec.excludeTags).filter(
    (tag) => !includeTags.includes(tag),
  )
  const mode: TagTimelineMode = includeTags.length > 1 && spec.mode === 'all' ? 'all' : 'any'

  return [
    includeTags.join('+') || 'none',
    mode,
    excludeTags.join('+') || 'none',
  ].join('::')
}

export function parseTagTimeline(
  routeTag: string | undefined,
  search: string,
): TagTimelineSpec | null {
  const includeTags = normalizeTagList(routeTag)
  if (includeTags.length === 0) return null

  const params = new URLSearchParams(search)
  const excludeTags = normalizeTagList(params.get('exclude')).filter(
    (tag) => !includeTags.includes(tag),
  )
  const requestedMode = params.get('mode') === 'all' ? 'all' : 'any'

  return {
    includeTags,
    excludeTags,
    mode: includeTags.length > 1 ? requestedMode : 'any',
  }
}

export function buildTagTimelineHref(spec: TagTimelineSpec | null): string {
  if (!spec || spec.includeTags.length === 0) return '/'

  const includeTags = uniqueTags(spec.includeTags)
  if (includeTags.length === 0) return '/'

  const excludeTags = uniqueTags(spec.excludeTags).filter(
    (tag) => !includeTags.includes(tag),
  )
  const params = new URLSearchParams()
  const mode: TagTimelineMode = includeTags.length > 1 && spec.mode === 'all' ? 'all' : 'any'

  if (mode === 'all') {
    params.set('mode', 'all')
  }
  if (excludeTags.length > 0) {
    params.set('exclude', excludeTags.join(','))
  }

  const query = params.toString()
  return `/t/${includeTags.join('+')}${query ? `?${query}` : ''}`
}

export function extractEventHashtags(event: NostrEvent): string[] {
  return uniqueTags(
    event.tags
      .filter((tag) => tag[0] === 't')
      .map((tag) => normalizeHashtag(tag[1] ?? ''))
      .filter((tag): tag is string => tag !== null),
  )
}

export function matchesTagTimeline(
  event: NostrEvent,
  spec: TagTimelineSpec | null,
  options: {
    semanticScore?: number | null
  } = {},
): boolean {
  if (!spec) return true
  if (spec.includeTags.length === 0) return true

  const tags = new Set(extractEventHashtags(event))
  const text = getTimelineEventText(event)
  const includeMatches = spec.includeTags.map((tag) => {
    const terms = buildTimelineTermSet([tag])
    return tags.has(tag) || terms.some((term) => eventMatchesTimelineTerm(text, term))
  })
  const excludeMatched = spec.excludeTags.some((tag) => {
    const terms = buildTimelineTermSet([tag])
    return tags.has(tag) || terms.some((term) => eventMatchesTimelineTerm(text, term))
  })

  if (excludeMatched) return false

  const lexicalMatchCount = includeMatches.filter(Boolean).length
  const semanticScore = options.semanticScore ?? null
  const semanticThreshold = spec.mode === 'all'
    ? TAG_TIMELINE_ALL_MODE_SEMANTIC_THRESHOLD
    : TAG_TIMELINE_SEMANTIC_THRESHOLD
  const semanticMatched = semanticScore !== null && semanticScore >= semanticThreshold

  if (spec.mode === 'all') {
    if (lexicalMatchCount === spec.includeTags.length) return true
    const semanticCoverageFloor = Math.max(1, Math.ceil(spec.includeTags.length / 2))
    return semanticMatched && lexicalMatchCount >= semanticCoverageFloor
  }

  return lexicalMatchCount > 0 || semanticMatched
}

export function parseTagTimelineDraft(raw: string): {
  tag: string | null
  exclude: boolean
} {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { tag: null, exclude: false }
  }

  const exclude = trimmed.startsWith('-') || trimmed.startsWith('!')
  const body = exclude ? trimmed.slice(1) : trimmed
  return {
    tag: normalizeHashtag(body),
    exclude,
  }
}

export function describeTagTimeline(spec: TagTimelineSpec | null): TagTimelineDescriptor | null {
  if (!spec || spec.includeTags.length === 0) return null

  const includeText = formatTagList(spec.includeTags)
  const excludeText = spec.excludeTags.length > 0
    ? ` Excluding ${formatTagList(spec.excludeTags)}.`
    : ''

  if (spec.includeTags.length === 1 && spec.excludeTags.length === 0) {
    return {
      ...spec,
      title: formatTag(spec.includeTags[0]!),
      summary: `Posts, articles, and videos collected around ${formatTag(spec.includeTags[0]!)} with plain-text and semantic context.`,
    }
  }

  const matcher = spec.mode === 'all' ? 'all of' : 'any of'

  return {
    ...spec,
    title: 'Tag Mix',
    summary: `Posts, articles, and videos matching ${matcher} ${includeText}, including plain-text mentions and semantic context.${excludeText}`.trim(),
  }
}
