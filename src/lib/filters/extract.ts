/**
 * Keyword Filter — field extraction
 *
 * Extracts every filterable text field from a NostrEvent or Profile,
 * covering spaces that Mastodon's filtering doesn't reach (author bio,
 * NIP-05 identifier, poll option labels, article summary, etc.).
 */

import { sanitizeText } from '@/lib/security/sanitize'
import { parsePollEvent } from '@/lib/nostr/polls'
import type { NostrEvent, Profile } from '@/types'
import type { EventTextFields, ProfileTextFields } from './types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function tagValue(tags: string[][], name: string): string {
  return sanitizeText(tags.find(t => t[0] === name)?.[1]?.trim() ?? '')
}

// ── Event extraction ─────────────────────────────────────────────────────────

/**
 * Extract all filterable text fields from an event plus its optional author
 * profile.  Author fields are empty strings when the profile isn't loaded
 * yet; filtering is re-applied inside SecondaryCard once the profile resolves.
 */
export function extractEventFields(event: NostrEvent, profile?: Profile): EventTextFields {
  const { tags } = event

  const poll    = parsePollEvent(event)
  const hashtags = tags
    .filter(t => t[0] === 't' && typeof t[1] === 'string' && t[1].trim())
    .map(t => t[1]!.trim())

  return {
    content:     sanitizeText(event.content),
    title:       tagValue(tags, 'title'),
    summary:     tagValue(tags, 'summary'),
    subject:     tagValue(tags, 'subject'),
    alt:         tagValue(tags, 'alt'),
    hashtags,
    pollOptions: poll?.options.map(o => sanitizeText(o.label)) ?? [],
    authorName:  sanitizeText(
      profile?.display_name ?? profile?.name ?? ''
    ),
    authorBio:   sanitizeText(profile?.about ?? ''),
    authorNip05: sanitizeText(profile?.nip05 ?? ''),
  }
}

/**
 * Build a single string for semantic embedding from the most meaningful
 * text fields of an event (body + title + summary).  Capped so the model
 * input stays within practical limits.
 */
export function buildSemanticText(event: NostrEvent, profile?: Profile): string {
  const f = extractEventFields(event, profile)
  return [f.title, f.summary, f.content]
    .filter(Boolean)
    .join(' ')
    .slice(0, 1_200)
}

// ── Profile extraction ───────────────────────────────────────────────────────

export function extractProfileFields(profile: Profile): ProfileTextFields {
  return {
    name:        sanitizeText(profile.name         ?? ''),
    displayName: sanitizeText(profile.display_name ?? ''),
    about:       sanitizeText(profile.about        ?? ''),
    nip05:       sanitizeText(profile.nip05        ?? ''),
  }
}
