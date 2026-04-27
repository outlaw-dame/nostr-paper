import { parseReactionEvent } from '@/lib/nostr/reaction'
import { parseRepostEvent } from '@/lib/nostr/repost'
import { parseVideoEvent } from '@/lib/nostr/video'
import { sanitizeName, sanitizeText } from '@/lib/security/sanitize'
import type { NostrEvent, Profile } from '@/types'

const MAX_QUERY_CHARS = 240
const MAX_EVENT_TEXT_CHARS = 900
const MAX_PROFILE_TEXT_CHARS = 420

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function normalizeSemanticQuery(query: string): string | null {
  const normalized = normalizeWhitespace(
    sanitizeText(query)
      .replace(/["'`]/g, ' ')
      // Strip leading # from hashtag tokens: "#Apple" → "Apple".
      // Defensive guard — hybridSearch normalises at entry, but override paths
      // (e.g. LLM rewrites) could still carry a raw hashtag-prefixed string.
      .replace(/(^|\s)#(\w)/g, '$1$2')
      .slice(0, MAX_QUERY_CHARS),
  )

  return normalized.length > 0 ? normalized : null
}

export function eventToSemanticText(event: NostrEvent): string | null {
  const repost = parseRepostEvent(event)
  const reaction = parseReactionEvent(event)
  const video = parseVideoEvent(event)
  const semanticSource = repost?.embeddedEvent?.content
    ?? (reaction
      ? `reaction ${reaction.content}`
      : video
        ? [
            video.title,
            video.summary,
            video.alt ?? '',
            video.references.join(' '),
          ].filter(Boolean).join('\n')
        : event.content)

  const content = normalizeWhitespace(sanitizeText(semanticSource).slice(0, MAX_EVENT_TEXT_CHARS))
  const hashtags = event.tags
    .filter(tag => tag[0] === 't' && typeof tag[1] === 'string')
    .map(tag => sanitizeText(tag[1] ?? '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12)

  const parts = [
    content,
    video?.title ? sanitizeText(video.title) : '',
    hashtags.length > 0 ? hashtags.join(' ') : '',
  ].filter(Boolean)

  if (parts.length === 0) return null
  return normalizeWhitespace(parts.join('\n')).slice(0, MAX_EVENT_TEXT_CHARS)
}

export function profileToSemanticText(profile: Profile): string | null {
  const parts = [
    profile.display_name ? sanitizeName(profile.display_name) : '',
    profile.name ? sanitizeName(profile.name) : '',
    profile.about ? sanitizeText(profile.about) : '',
    profile.website ? sanitizeText(profile.website) : '',
    profile.nip05Verified ? (profile.nip05 ?? '') : '',
    profile.bot ? 'bot automated account' : '',
  ]
    .map(value => normalizeWhitespace(value))
    .filter(Boolean)

  if (parts.length === 0) return null
  return parts.join('\n').slice(0, MAX_PROFILE_TEXT_CHARS)
}
