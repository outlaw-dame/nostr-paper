import { extractHashtags, sanitizeText } from '@/lib/security/sanitize'

export type DaySegment = 'morning' | 'evening' | 'night'

export interface ActivityRecapSignal {
  createdAt: number
  kind: 'engagement' | 'mention'
  actors: number
  reactionCount: number
  repostCount: number
  zapCount: number
  mentionCount: number
}

export interface ProfileInsightInput {
  displayName: string
  about: string
  hashtags: string[]
  recentPosts: string[]
}

export interface ComposeFallbackInput {
  draft: string
  tone: 'caution' | 'supportive' | 'neutral'
  duplicateReplyCount: number
  topThreadHighlights: string[]
  hashtagSuggestions: string[]
  keywordSuggestions: string[]
}

function cleanText(value: string): string {
  return sanitizeText(value).replace(/\s+/g, ' ').trim()
}

function tokenize(value: string): string[] {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3)
}

function topTerms(input: string[], limit = 6): string[] {
  const counts = new Map<string, number>()

  for (const entry of input) {
    for (const token of tokenize(entry)) {
      counts.set(token, (counts.get(token) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token)
}

export function getDaySegment(date = new Date()): DaySegment {
  const hour = date.getHours()
  if (hour >= 5 && hour < 16) return 'morning'
  if (hour >= 16 && hour < 22) return 'evening'
  return 'night'
}

export function buildActivityRecapFallback(
  signals: ActivityRecapSignal[],
  segment: DaySegment,
): string {
  if (signals.length === 0) {
    if (segment === 'morning') return 'Morning recap: You are all caught up. No new activity yet.'
    if (segment === 'evening') return 'Evening recap: Quiet window so far. You are fully caught up.'
    return 'Night recap: No new activity to review right now.'
  }

  const totals = signals.reduce((acc, signal) => ({
    reactions: acc.reactions + signal.reactionCount,
    reposts: acc.reposts + signal.repostCount,
    zaps: acc.zaps + signal.zapCount,
    mentions: acc.mentions + signal.mentionCount,
    actors: acc.actors + signal.actors,
  }), {
    reactions: 0,
    reposts: 0,
    zaps: 0,
    mentions: 0,
    actors: 0,
  })

  const engagementCount = totals.reactions + totals.reposts + totals.zaps
  const mostRecent = signals
    .map((signal) => signal.createdAt)
    .sort((a, b) => b - a)[0] ?? 0

  const freshLabel = mostRecent > 0
    ? new Date(mostRecent * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : 'recently'

  const intro = segment === 'morning'
    ? 'Morning recap'
    : segment === 'evening'
      ? 'Evening recap'
      : 'Night recap'

  return `${intro}: ${signals.length} activity group(s), ${engagementCount} engagement event(s), and ${totals.mentions} mention(s). Latest activity around ${freshLabel}.`
}

export function buildProfileInsightFallback(input: ProfileInsightInput): string[] {
  const lines: string[] = []
  const about = cleanText(input.about)
  const recentPosts = input.recentPosts
    .map(cleanText)
    .filter((value) => value.length > 0)
  const hashtags = [...new Set(input.hashtags.map((tag) => tag.toLowerCase()).filter(Boolean))]

  if (about.length > 0) {
    const snippet = about.length > 180 ? `${about.slice(0, 179)}…` : about
    lines.push(`${input.displayName}: ${snippet}`)
  }

  if (hashtags.length > 0) {
    lines.push(`Frequent tags: ${hashtags.slice(0, 6).map((tag) => `#${tag}`).join(', ')}`)
  }

  const dominantTerms = topTerms(recentPosts, 6)
  if (dominantTerms.length > 0) {
    lines.push(`Recent post themes: ${dominantTerms.join(', ')}`)
  }

  if (lines.length === 0) {
    lines.push('Not enough public profile context yet. Publish more notes or bio details for richer insights.')
  }

  return lines.slice(0, 3)
}

export function buildComposeFallbackSuggestion(input: ComposeFallbackInput): string {
  const lines: string[] = []

  if (input.tone === 'caution') {
    lines.push('Tone check: Consider replacing absolute claims with specific evidence to reduce escalation risk.')
  } else if (input.tone === 'supportive') {
    lines.push('Tone check: Supportive framing is strong. You can add one concrete example to deepen impact.')
  } else {
    lines.push('Tone check: Add one concise context sentence so intent is clearer to first-time readers.')
  }

  if (input.duplicateReplyCount > 0) {
    lines.push(`Thread check: ${input.duplicateReplyCount} similar reply pattern(s) detected. Add a distinct angle or citation.`)
  }

  if (input.topThreadHighlights.length > 0) {
    lines.push(`Context from thread: ${input.topThreadHighlights.slice(0, 1)[0]}`)
  }

  if (input.hashtagSuggestions.length > 0) {
    lines.push(`Suggested hashtag focus: ${input.hashtagSuggestions.slice(0, 3).map((tag) => `#${tag}`).join(', ')}`)
  }

  if (input.keywordSuggestions.length > 0) {
    lines.push(`Suggested keyword focus: ${input.keywordSuggestions.slice(0, 3).join(', ')}`)
  }

  return lines.join(' ')
}

export function extractHashtagsFromContents(contents: string[]): string[] {
  const tags = new Set<string>()
  for (const content of contents) {
    for (const tag of extractHashtags(content)) {
      if (tag) tags.add(tag.toLowerCase())
    }
  }
  return [...tags]
}
