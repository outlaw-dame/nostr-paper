import { sanitizeText } from '@/lib/security/sanitize'
import type { ModerationDocument, NostrEvent, Profile } from '@/types'

const MAX_MODERATION_CHARS = 2_000
const MODERATION_TAG_NAMES = new Set(['title', 'summary', 'subject', 'alt', 'name'])
const URL_PATTERN = /https?:\/\/\S+/gi
const NOSTR_URI_PATTERN = /nostr:[a-z0-9]+/gi

export function hashModerationText(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

export function normalizeModerationText(value: string): string {
  const sanitized = sanitizeText(value)
    .replace(URL_PATTERN, ' ')
    .replace(NOSTR_URI_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (sanitized.length <= MAX_MODERATION_CHARS) return sanitized
  return sanitized.slice(0, MAX_MODERATION_CHARS)
}

function appendUniquePart(parts: string[], rawValue: string | null | undefined): void {
  if (!rawValue) return
  const normalized = normalizeModerationText(rawValue)
  if (!normalized || parts.includes(normalized)) return
  parts.push(normalized)
}

function getEventMetadataText(event: NostrEvent): string[] {
  const parts: string[] = []

  for (const tag of event.tags) {
    if (!MODERATION_TAG_NAMES.has(tag[0] ?? '')) continue
    appendUniquePart(parts, tag[1])
  }

  return parts
}

export function buildEventModerationText(event: NostrEvent): string {
  const parts = getEventMetadataText(event)
  appendUniquePart(parts, event.content)
  return normalizeModerationText(parts.join('\n\n'))
}

export function buildProfileModerationText(profile: Pick<Profile, 'display_name' | 'name' | 'about'>): string {
  const parts: string[] = []
  appendUniquePart(parts, profile.display_name)
  appendUniquePart(parts, profile.name)
  appendUniquePart(parts, profile.about)
  return normalizeModerationText(parts.join('\n\n'))
}

export function buildEventModerationDocument(event: NostrEvent): ModerationDocument | null {
  const text = buildEventModerationText(event)
  if (!text) return null

  return {
    id: event.id,
    kind: 'event',
    text,
    updatedAt: event.created_at,
  }
}

export function buildProfileModerationDocument(profile: Profile): ModerationDocument | null {
  const text = buildProfileModerationText(profile)
  if (!text) return null

  return {
    id: profile.pubkey,
    kind: 'profile',
    text,
    updatedAt: profile.updatedAt,
  }
}

export function getModerationDocumentCacheKey(document: ModerationDocument): string {
  return `${document.kind}:${document.id}:${document.updatedAt}:${hashModerationText(document.text)}`
}
