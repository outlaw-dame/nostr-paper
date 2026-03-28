import { describe, expect, it } from 'vitest'
import { buildArticleFeedSections } from '@/lib/feed/articleFeeds'
import type { SavedTagFeed } from '@/lib/feed/tagFeeds'
import { Kind } from '@/types'

function makeSavedFeed(overrides: Partial<SavedTagFeed> = {}): SavedTagFeed {
  return {
    id: 'ai-desk',
    title: 'AI Desk',
    description: '',
    avatar: '',
    banner: '',
    profilePubkeys: [],
    includeTags: ['ai', 'agents'],
    excludeTags: [],
    mode: 'all',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

describe('buildArticleFeedSections', () => {
  it('always starts with an all-feeds aggregate section', () => {
    const sections = buildArticleFeedSections({})

    expect(sections[0]).toEqual(expect.objectContaining({
      id: 'articles:all-feeds',
      label: 'All feeds',
      tone: 'all',
      filter: {
        kinds: [Kind.LongFormContent],
        limit: 20,
      },
    }))
  })

  it('adds a following lane when the viewer has followed authors', () => {
    const sections = buildArticleFeedSections({
      currentUserPubkey: 'a'.repeat(64),
      followingPubkeys: ['b'.repeat(64), 'c'.repeat(64), 'b'.repeat(64)],
    })

    expect(sections[1]).toEqual(expect.objectContaining({
      id: 'articles:following',
      label: 'Following',
      tone: 'following',
      profileCount: 3,
      followingCount: 2,
      filter: {
        authors: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)],
        kinds: [Kind.LongFormContent],
        limit: 20,
      },
    }))
  })

  it('turns saved tag feeds into article-only custom lanes', () => {
    const sections = buildArticleFeedSections({
      savedTagFeeds: [
        makeSavedFeed({
          profilePubkeys: ['d'.repeat(64)],
          banner: 'https://cdn.example.com/banner.jpg',
          avatar: 'https://cdn.example.com/avatar.jpg',
        }),
      ],
    })

    expect(sections[1]).toEqual(expect.objectContaining({
      id: 'articles:saved:ai-desk',
      label: 'AI Desk',
      tone: 'custom',
      banner: 'https://cdn.example.com/banner.jpg',
      avatar: 'https://cdn.example.com/avatar.jpg',
      keywordCount: 2,
      profileCount: 1,
      filter: {
        kinds: [Kind.LongFormContent],
        '#t': ['ai', 'agents'],
        limit: 80,
      },
    }))
  })
})
