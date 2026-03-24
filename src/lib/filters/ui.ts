/**
 * Filter Configuration UI - Common for all filter configuration surfaces
 */

import type { FilterAction, FilterScope } from '@/lib/filters/types'

export const ACTION_ICONS: Record<FilterAction, string> = {
  hide: '🚫',
  warn: '⚠️',
}

export const ACTION_LABELS: Record<FilterAction, string> = {
  hide: 'Hide',
  warn: 'Warn',
}

export const ACTION_DESCRIPTIONS: Record<FilterAction, string> = {
  hide: 'Completely removes matching content from view',
  warn: 'Shows a warning pill; tap to reveal content',
}

export const SCOPE_ICONS: Record<FilterScope, string> = {
  any: '🔍',
  content: '📝',
  author: '👤',
  hashtag: '#️⃣',
}

export const SCOPE_LABELS: Record<FilterScope, string> = {
  any: 'Entire post (content, author, hashtags)',
  content: 'Post content, title, summary, hashtags',
  author: 'Author name, bio, NIP-05',
  hashtag: 'Hashtags only (#t tags)',
}

export const SCOPE_DESCRIPTIONS: Record<FilterScope, string> = {
  any: 'Checks every field of the post and author profile',
  content: 'Post body, title, summary, and hashtags',
  author: 'Filters based on author name, bio, and identifier',
  hashtag: 'Only matches hashtag tags (#t tags)',
}
