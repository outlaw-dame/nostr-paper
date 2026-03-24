/**
 * Keyword Filter Presets
 *
 * Pre-configured filter sets for common filtering scenarios.
 * Users can apply one-click or customize them.
 */

import type { CreateFilterInput } from './types'

export interface FilterPreset {
  id: string
  name: string
  description: string
  icon: string
  filters: CreateFilterInput[]
  category: 'safety' | 'content' | 'spam' | 'custom'
}

export const FILTER_PRESETS: FilterPreset[] = [
  {
    id: 'violence',
    name: 'Violence & Gore',
    description: 'Hides or warns on content depicting violence, injury, or gore',
    icon: '⚠️',
    category: 'safety',
    filters: [
      {
        term: 'violence',
        action: 'warn',
        scope: 'any',
        wholeWord: false,
        semantic: true,
        enabled: true,
        expiresAt: null,
      },
      {
        term: 'gore',
        action: 'warn',
        scope: 'any',
        wholeWord: false,
        semantic: true,
        enabled: true,
        expiresAt: null,
      },
      {
        term: 'injury',
        action: 'warn',
        scope: 'any',
        wholeWord: false,
        semantic: true,
        enabled: true,
        expiresAt: null,
      },
      {
        term: 'blood',
        action: 'warn',
        scope: 'any',
        wholeWord: false,
        semantic: false,
        enabled: true,
        expiresAt: null,
      },
    ],
  },
  {
    id: 'harassment',
    name: 'Harassment & Abuse',
    description: 'Detects harassment, bullying, hate speech, and abusive language',
    icon: '🚫',
    category: 'safety',
    filters: [
      {
        term: 'harassment',
        action: 'warn',
        scope: 'any',
        wholeWord: false,
        semantic: true,
        enabled: true,
        expiresAt: null,
      },
      {
        term: 'abuse',
        action: 'warn',
        scope: 'any',
        wholeWord: false,
        semantic: true,
        enabled: true,
        expiresAt: null,
      },
      {
        term: 'hate',
        action: 'warn',
        scope: 'any',
        wholeWord: false,
        semantic: true,
        enabled: true,
        expiresAt: null,
      },
      {
        term: 'bullying',
        action: 'warn',
        scope: 'any',
        wholeWord: false,
        semantic: true,
        enabled: true,
        expiresAt: null,
      },
    ],
  },
  {
    id: 'scam',
    name: 'Scams & Fraud',
    description: 'Identifies obvious scam attempts, phishing, and fraudulent schemes',
    icon: '🎣',
    category: 'safety',
    filters: [
      {
        term: 'scam',
        action: 'warn',
        scope: 'any',
        wholeWord: false,
        semantic: true,
        enabled: true,
        expiresAt: null,
      },
      {
        term: 'phishing',
        action: 'warn',
        scope: 'any',
        wholeWord: false,
        semantic: true,
        enabled: true,
        expiresAt: null,
      },
      {
        term: 'fraud',
        action: 'warn',
        scope: 'any',
        wholeWord: false,
        semantic: true,
        enabled: true,
        expiresAt: null,
      },
      {
        term: 'click here now',
        action: 'warn',
        scope: 'content',
        wholeWord: false,
        semantic: false,
        enabled: true,
        expiresAt: null,
      },
    ],
  },
  {
    id: 'spam',
    name: 'Spam & Promotion',
    description: 'Filters excessive self-promotion, bots, and spam content',
    icon: '📧',
    category: 'spam',
    filters: [
      {
        term: 'follow my link',
        action: 'warn',
        scope: 'content',
        wholeWord: false,
        semantic: false,
        enabled: true,
        expiresAt: null,
      },
      {
        term: 'click here',
        action: 'warn',
        scope: 'content',
        wholeWord: false,
        semantic: false,
        enabled: true,
        expiresAt: null,
      },
      {
        term: 'earn money fast',
        action: 'warn',
        scope: 'content',
        wholeWord: false,
        semantic: false,
        enabled: true,
        expiresAt: null,
      },
    ],
  },
  {
    id: 'politics',
    name: 'Politics & Elections',
    description: 'Hides political content and election discussion',
    icon: '🗳️',
    category: 'content',
    filters: [
      {
        term: 'politics',
        action: 'warn',
        scope: 'any',
        wholeWord: false,
        semantic: true,
        enabled: true,
        expiresAt: null,
      },
      {
        term: 'election',
        action: 'warn',
        scope: 'any',
        wholeWord: false,
        semantic: true,
        enabled: true,
        expiresAt: null,
      },
      {
        term: 'candidate',
        action: 'warn',
        scope: 'any',
        wholeWord: false,
        semantic: true,
        enabled: true,
        expiresAt: null,
      },
    ],
  },
  {
    id: 'nsfw',
    name: 'NSFW & Adult',
    description: 'Filters explicit sexual content and adult material',
    icon: '🔞',
    category: 'content',
    filters: [
      {
        term: 'adult content',
        action: 'warn',
        scope: 'any',
        wholeWord: false,
        semantic: true,
        enabled: true,
        expiresAt: null,
      },
      {
        term: 'explicit',
        action: 'warn',
        scope: 'any',
        wholeWord: false,
        semantic: true,
        enabled: true,
        expiresAt: null,
      },
    ],
  },
]

export function getPresetById(id: string): FilterPreset | undefined {
  return FILTER_PRESETS.find(p => p.id === id)
}

export function getPresetsByCategory(category: FilterPreset['category']): FilterPreset[] {
  return FILTER_PRESETS.filter(p => p.category === category)
}
