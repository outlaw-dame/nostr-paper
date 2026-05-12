import { describe, expect, it } from 'vitest'
import { Kind, type NostrEvent } from '@/types'
import { scoreAndRankTrendingContent, scoreTrendingContent } from './trendingContent'

function makeEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: Kind.ShortNote,
    tags: [],
    content: 'Short note',
    sig: 'c'.repeat(128),
    ...overrides,
  }
}

describe('scoreAndRankTrendingContent', () => {
  it('ranks strong engagement and quality above a quiet recent note', () => {
    const olderQualityPost = makeEvent({
      kind: Kind.LongFormContent,
      created_at: 1_700_000_000 - 6 * 60 * 60,
      content: 'x'.repeat(420),
      tags: [['title', 'Deep dive'], ['summary', 'High signal'], ['t', 'nostr'], ['t', 'ai']],
    })

    const quietNote = makeEvent({
      created_at: 1_700_000_000 - 60,
      content: 'small update',
    })

    const ranked = scoreAndRankTrendingContent([
      {
        event: olderQualityPost,
        engagement: {
          replyCount: 3,
          repostCount: 2,
          reactionCount: 8,
          likeCount: 6,
          dislikeCount: 0,
          emojiReactions: [],
          zapCount: 1,
          zapTotalMsats: 18_000,
          currentUserHasReposted: false,
          currentUserHasLiked: false,
          currentUserHasDisliked: false,
        },
      },
      {
        event: quietNote,
        engagement: {
          replyCount: 0,
          repostCount: 0,
          reactionCount: 0,
          likeCount: 0,
          dislikeCount: 0,
          emojiReactions: [],
          zapCount: 0,
          zapTotalMsats: 0,
          currentUserHasReposted: false,
          currentUserHasLiked: false,
          currentUserHasDisliked: false,
        },
      },
    ], 2)

    expect(ranked[0]?.event.id).toBe(olderQualityPost.id)
    expect(ranked[0]?.reasons.length).toBeGreaterThan(0)
  })

  it('assigns higher popularScore when positive reactions are broader', () => {
    const highConsensus = scoreTrendingContent({
      event: makeEvent({ created_at: 1_700_000_000 - 2 * 60 * 60 }),
      engagement: {
        replyCount: 2,
        repostCount: 8,
        reactionCount: 80,
        likeCount: 72,
        dislikeCount: 3,
        emojiReactions: [],
        zapCount: 5,
        zapTotalMsats: 75_000,
        currentUserHasReposted: false,
        currentUserHasLiked: false,
        currentUserHasDisliked: false,
      },
    })

    const weakConsensus = scoreTrendingContent({
      event: makeEvent({ created_at: 1_700_000_000 - 2 * 60 * 60 }),
      engagement: {
        replyCount: 2,
        repostCount: 2,
        reactionCount: 20,
        likeCount: 9,
        dislikeCount: 4,
        emojiReactions: [],
        zapCount: 1,
        zapTotalMsats: 8_000,
        currentUserHasReposted: false,
        currentUserHasLiked: false,
        currentUserHasDisliked: false,
      },
    })

    expect(highConsensus.popularScore).toBeGreaterThan(weakConsensus.popularScore)
  })

  it('assigns higher trendScore to newer content at equal vote balance', () => {
    const recent = scoreTrendingContent({
      event: makeEvent({ created_at: 1_700_000_000 - 20 * 60 }),
      engagement: {
        replyCount: 1,
        repostCount: 2,
        reactionCount: 8,
        likeCount: 6,
        dislikeCount: 0,
        emojiReactions: [],
        zapCount: 1,
        zapTotalMsats: 5_000,
        currentUserHasReposted: false,
        currentUserHasLiked: false,
        currentUserHasDisliked: false,
      },
    })

    const older = scoreTrendingContent({
      event: makeEvent({ created_at: 1_700_000_000 - 6 * 60 * 60 }),
      engagement: {
        replyCount: 1,
        repostCount: 2,
        reactionCount: 8,
        likeCount: 6,
        dislikeCount: 0,
        emojiReactions: [],
        zapCount: 1,
        zapTotalMsats: 5_000,
        currentUserHasReposted: false,
        currentUserHasLiked: false,
        currentUserHasDisliked: false,
      },
    })

    expect(recent.trendScore).toBeGreaterThan(older.trendScore)
  })

  it('caps repeated authors in top trending results', () => {
    const sameAuthor = 'a'.repeat(64)
    const otherAuthor = 'd'.repeat(64)

    const ranked = scoreAndRankTrendingContent([
      {
        event: makeEvent({ id: '1'.repeat(64), pubkey: sameAuthor, created_at: 1_700_000_000 - 60, content: 'https://example.com/a' }),
        engagement: {
          replyCount: 3,
          repostCount: 4,
          reactionCount: 14,
          likeCount: 10,
          dislikeCount: 0,
          emojiReactions: [],
          zapCount: 1,
          zapTotalMsats: 4_000,
          currentUserHasReposted: false,
          currentUserHasLiked: false,
          currentUserHasDisliked: false,
        },
      },
      {
        event: makeEvent({ id: '2'.repeat(64), pubkey: sameAuthor, created_at: 1_700_000_000 - 120, content: 'https://example.com/b' }),
        engagement: {
          replyCount: 2,
          repostCount: 3,
          reactionCount: 12,
          likeCount: 8,
          dislikeCount: 0,
          emojiReactions: [],
          zapCount: 1,
          zapTotalMsats: 3_000,
          currentUserHasReposted: false,
          currentUserHasLiked: false,
          currentUserHasDisliked: false,
        },
      },
      {
        event: makeEvent({ id: '3'.repeat(64), pubkey: otherAuthor, created_at: 1_700_000_000 - 90, content: 'https://another.example.com/c' }),
        engagement: {
          replyCount: 2,
          repostCount: 2,
          reactionCount: 9,
          likeCount: 7,
          dislikeCount: 0,
          emojiReactions: [],
          zapCount: 1,
          zapTotalMsats: 2_000,
          currentUserHasReposted: false,
          currentUserHasLiked: false,
          currentUserHasDisliked: false,
        },
      },
    ], 3, { maxPerAuthor: 1 })

    const authorCounts = ranked.reduce<Record<string, number>>((acc, item) => {
      acc[item.event.pubkey] = (acc[item.event.pubkey] ?? 0) + 1
      return acc
    }, {})

    expect(authorCounts[sameAuthor]).toBe(1)
  })

  it('applies optional external trend source boost for configured pubkeys', () => {
    const externalPubkey = 'e'.repeat(64)
    const baseline = scoreTrendingContent({
      event: makeEvent({ id: '4'.repeat(64), pubkey: externalPubkey, created_at: 1_700_000_000 - 120 }),
      engagement: {
        replyCount: 1,
        repostCount: 1,
        reactionCount: 5,
        likeCount: 3,
        dislikeCount: 0,
        emojiReactions: [],
        zapCount: 0,
        zapTotalMsats: 0,
        currentUserHasReposted: false,
        currentUserHasLiked: false,
        currentUserHasDisliked: false,
      },
    })

    const boosted = scoreTrendingContent({
      event: makeEvent({ id: '5'.repeat(64), pubkey: externalPubkey, created_at: 1_700_000_000 - 120 }),
      engagement: {
        replyCount: 1,
        repostCount: 1,
        reactionCount: 5,
        likeCount: 3,
        dislikeCount: 0,
        emojiReactions: [],
        zapCount: 0,
        zapTotalMsats: 0,
        currentUserHasReposted: false,
        currentUserHasLiked: false,
        currentUserHasDisliked: false,
      },
    }, {
      externalSignalEnabled: true,
      externalSignalWeight: 0.2,
      externalSourcePubkeys: new Set([externalPubkey]),
    })

    expect(boosted.score).toBeGreaterThan(baseline.score)
    expect(boosted.reasons).toContain('External trend source')
  })
})