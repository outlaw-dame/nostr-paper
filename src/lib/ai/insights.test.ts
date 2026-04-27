import { describe, expect, it } from 'vitest'
import {
  buildActivityRecapFallback,
  buildComposeFallbackSuggestion,
  buildProfileInsightFallback,
  extractHashtagsFromContents,
  getDaySegment,
} from '@/lib/ai/insights'

describe('ai insights fallback builders', () => {
  it('resolves day segment buckets', () => {
    expect(getDaySegment(new Date('2026-04-19T08:00:00Z'))).toBe('morning')
    expect(getDaySegment(new Date('2026-04-19T18:30:00Z'))).toBe('evening')
    expect(getDaySegment(new Date('2026-04-19T23:30:00Z'))).toBe('night')
  })

  it('builds empty and populated activity recaps', () => {
    const empty = buildActivityRecapFallback([], 'morning')
    expect(empty.toLowerCase()).toContain('morning recap')
    expect(empty.toLowerCase()).toContain('caught up')

    const populated = buildActivityRecapFallback([
      {
        createdAt: 1_744_000_000,
        kind: 'engagement',
        actors: 3,
        reactionCount: 2,
        repostCount: 1,
        zapCount: 0,
        mentionCount: 0,
      },
      {
        createdAt: 1_744_000_800,
        kind: 'mention',
        actors: 1,
        reactionCount: 0,
        repostCount: 0,
        zapCount: 0,
        mentionCount: 1,
      },
    ], 'evening')

    expect(populated.toLowerCase()).toContain('evening recap')
    expect(populated).toContain('2 activity group(s)')
    expect(populated).toContain('3 engagement event(s)')
  })

  it('builds profile insights from bio, tags, and posts', () => {
    const insights = buildProfileInsightFallback({
      displayName: 'Alice',
      about: 'Building Nostr clients and moderation tooling for healthier conversations.',
      hashtags: ['nostr', 'ai', 'privacy'],
      recentPosts: [
        'Shipping better #nostr discovery and moderation controls.',
        'AI assistance should improve context quality and user safety.',
      ],
    })

    expect(insights.length).toBeGreaterThan(0)
    expect(insights[0]).toContain('Alice')
    expect(insights.join(' ')).toContain('#nostr')
  })

  it('builds compose fallback guidance with context signals', () => {
    const suggestion = buildComposeFallbackSuggestion({
      draft: 'This is my reply draft',
      tone: 'caution',
      duplicateReplyCount: 2,
      topThreadHighlights: ['Someone already made this point with examples.'],
      hashtagSuggestions: ['nostr', 'safety', 'ai'],
      keywordSuggestions: ['context', 'moderation', 'quality'],
    })

    expect(suggestion.toLowerCase()).toContain('tone check')
    expect(suggestion.toLowerCase()).toContain('thread check')
    expect(suggestion).toContain('#nostr')
    expect(suggestion).toContain('context')
  })

  it('extracts unique normalized hashtags from content arrays', () => {
    const tags = extractHashtagsFromContents([
      'Testing #Nostr and #AI helpers',
      'Second post with #nostr and #Privacy',
    ])

    expect(tags).toEqual(['nostr', 'ai', 'privacy'])
  })
})
