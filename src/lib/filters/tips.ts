/**
 * Filter Tips & Best Practices
 *
 * Helpful information for users new to semantic filtering.
 */

export const FILTER_TIPS = [
  {
    title: 'Use Semantic for Synonyms',
    description: 'Enable semantic matching for broader concept matching. "violence" will catch "assault", "brutality", etc.',
    icon: '🧠',
  },
  {
    title: 'Whole Word for Precision',
    description: 'Enable "whole word" to prevent "as" from matching "class" or "ass".',
    icon: '🎯',
  },
  {
    title: 'Mix Hide & Warn',
    description: 'Use "hide" for content you never want to see, and "warn" for content that might be okay sometimes.',
    icon: '🚫⚠️',
  },
  {
    title: 'Scope Narrows Matching',
    description: 'Set scope to "author" to filter only by name/bio, or "content" to check posts only.',
    icon: '🔍',
  },
  {
    title: 'Expiry for Temporary Filters',
    description: 'Use expiry dates for event-specific filters. They\'ll auto-disable when time expires.',
    icon: '⏰',
  },
  {
    title: 'Test With Warn First',
    description: 'When unsure about a filter, start with "warn" to see false positives before hiding.',
    icon: '⚡',
  },
  {
    title: 'Profile Checking',
    description: 'Filters also apply to author profiles, so keywords in bios will be caught.',
    icon: '👤',
  },
  {
    title: 'Hashtag Matching',
    description: 'Set scope to "hashtag" to filter specific topics like #politics or #nsfw.',
    icon: '#️⃣',
  },
]

export const SEMANTIC_EXAMPLES = [
  {
    keyword: 'violence',
    semanticMatches: ['assault', 'brutality', 'conflict', 'aggression', 'slaughter'],
    description: 'Violence-related content',
  },
  {
    keyword: 'harassment',
    semanticMatches: ['bullying', 'abuse', 'assault', 'intimidation', 'threats'],
    description: 'Harassment and abusive content',
  },
  {
    keyword: 'scam',
    semanticMatches: ['fraud', 'deception', 'swindle', 'hoax', 'fake'],
    description: 'Scams and fraudulent schemes',
  },
  {
    keyword: 'spam',
    semanticMatches: ['junk', 'unsolicited', 'bulk', 'marketing', 'promotion'],
    description: 'Spam and unwanted content',
  },
  {
    keyword: 'politics',
    semanticMatches: ['election', 'candidate', 'government', 'policy', 'campaign'],
    description: 'Political discussion',
  },
]
