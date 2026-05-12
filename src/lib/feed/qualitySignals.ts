import { getEventMediaAttachments } from '@/lib/nostr/imeta'
import { parseLongFormEvent } from '@/lib/nostr/longForm'
import { parseCommentEvent, parseThreadEvent } from '@/lib/nostr/thread'
import { parseVideoEvent } from '@/lib/nostr/video'
import type { NostrEvent } from '@/types'

export interface EventQualitySignals {
  score: number
  reasons: string[]
  primaryTopic: string | null
}

function collectHashtags(event: NostrEvent): string[] {
  const tags = new Set<string>()
  for (const tag of event.tags) {
    if (tag[0] !== 't') continue
    const value = tag[1]?.trim().toLowerCase()
    if (value) tags.add(value)
  }
  return [...tags]
}

function getEventTextLength(event: NostrEvent): number {
  const article = parseLongFormEvent(event)
  if (article) {
    return [article.title, article.summary, event.content]
      .filter(Boolean)
      .join('\n\n')
      .length
  }

  const video = parseVideoEvent(event)
  if (video) {
    return [video.title, video.summary]
      .filter(Boolean)
      .join('\n\n')
      .length
  }

  const thread = parseThreadEvent(event)
  if (thread) {
    return [thread.title, thread.content]
      .filter(Boolean)
      .join('\n\n')
      .length
  }

  return (parseCommentEvent(event)?.content ?? event.content ?? '').trim().length
}

export function getEventQualitySignals(event: NostrEvent): EventQualitySignals {
  const reasons: string[] = []
  let score = 0

  const hashtags = collectHashtags(event)
  const textLength = getEventTextLength(event)
  const attachmentCount = getEventMediaAttachments(event).length
  const article = parseLongFormEvent(event)
  const video = parseVideoEvent(event)
  const thread = parseThreadEvent(event)

  if (article) {
    score += 3.2
    reasons.push('Longform')
  }

  if (video) {
    score += 2.6
    reasons.push(video.isShort ? 'Video' : 'Video brief')
  }

  if (thread) {
    score += 1.9
    reasons.push('Threaded')
  }

  if (textLength >= 420) {
    score += 1.8
    reasons.push('In-depth')
  } else if (textLength >= 180) {
    score += 1.0
    reasons.push('Substantive')
  }

  if (hashtags.length >= 2) {
    score += 1.2
    reasons.push('Topic-rich')
  } else if (hashtags.length === 1) {
    score += 0.6
  }

  if (attachmentCount > 0) {
    score += 0.7
    reasons.push('Visual context')
  }

  if (!article && !video && !thread && textLength > 0 && textLength < 90) {
    score -= 0.7
  }

  const normalizedReasons = [...new Set(reasons)].slice(0, 3)
  return {
    score,
    reasons: normalizedReasons,
    primaryTopic: hashtags[0] ?? null,
  }
}

export function isDeepReadEvent(event: NostrEvent): boolean {
  if (parseLongFormEvent(event) || parseVideoEvent(event) || parseThreadEvent(event)) return true
  return getEventTextLength(event) >= 280
}
