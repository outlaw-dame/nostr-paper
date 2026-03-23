/**
 * NIP-36 Content Warning
 *
 * Events tagged with ["content-warning", "optional reason"] signal
 * that their content may be sensitive or disturbing.
 *
 * Spec: https://github.com/nostr-protocol/nips/blob/master/36.md
 */

import type { NostrEvent } from '@/types'

export interface ContentWarning {
  /** Whether the event carries a content-warning tag */
  hasWarning: true
  /** Optional reason string (may be empty) */
  reason: string | null
}

/**
 * Parse the content-warning tag from a Nostr event.
 *
 * Returns a ContentWarning object if the tag is present, null otherwise.
 */
export function parseContentWarning(event: NostrEvent): ContentWarning | null {
  for (const tag of event.tags) {
    if (tag[0] === 'content-warning') {
      const reason = typeof tag[1] === 'string' && tag[1].trim().length > 0
        ? tag[1].trim()
        : null
      return { hasWarning: true, reason }
    }
  }
  return null
}
