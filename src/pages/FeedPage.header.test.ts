import { describe, expect, it } from 'vitest'
import { getFeedHeaderSection } from '@/lib/feed/headerSection'
import type { SavedTagFeed } from '@/lib/feed/tagFeeds'
import type { TagTimelineSpec } from '@/lib/feed/tagTimeline'
import { Kind } from '@/types'

type HeaderSectionInput = Parameters<typeof getFeedHeaderSection>[0]

function makeSection(overrides: Partial<HeaderSectionInput> = {}): HeaderSectionInput {
  return {
    id: 'feed',
    label: 'Feed',
    summary: 'Latest across your network.',
    filter: { kinds: [Kind.ShortNote], limit: 20 },
    ...overrides,
  }
}

describe('getFeedHeaderSection', () => {
  it('keeps the normal feed header when a tag timeline section is active', () => {
    const tagTimeline: TagTimelineSpec = {
      includeTags: ['intelligence'],
      excludeTags: [],
      mode: 'any',
    }
    const defaultFeedSection = makeSection()

    const header = getFeedHeaderSection(makeSection({
      id: 'tag-route:intelligence',
      label: '#intelligence',
      summary: 'Posts collected around #intelligence.',
      tagTimeline,
      filter: {
        kinds: [Kind.ShortNote, Kind.Thread],
        '#t': ['intelligence'],
        limit: 50,
      },
    }), defaultFeedSection)

    expect(header.id).toBe('feed')
    expect(header.label).toBe('Feed')
    expect(header.summary).toBe('Latest across your network.')
  })

  it('leaves non-tag sections unchanged', () => {
    const notes = makeSection({
      id: 'notes',
      label: 'Notes',
      summary: 'Fast conversation and short-form posts.',
    })

    expect(getFeedHeaderSection(notes, makeSection())).toEqual(notes)
  })

  it('preserves the saved tag feed header when the active timeline is a saved feed', () => {
    const savedFeed: SavedTagFeed = {
      id: 'saved-intelligence',
      title: 'Intelligence',
      description: 'Research, signals, and people to watch.',
      avatar: 'https://cdn.example.com/intelligence-avatar.jpg',
      banner: 'https://cdn.example.com/intelligence-banner.jpg',
      profilePubkeys: ['a'.repeat(64)],
      includeTags: ['intelligence'],
      excludeTags: [],
      mode: 'any',
      createdAt: 10,
      updatedAt: 20,
    }
    const defaultFeedSection = makeSection()

    const header = getFeedHeaderSection(makeSection({
      id: 'tag-feed:saved-intelligence',
      label: 'Intelligence',
      summary: 'Research, signals, and people to watch.',
      tagTimeline: savedFeed,
      filter: {
        kinds: [Kind.ShortNote, Kind.Thread],
        '#t': ['intelligence'],
        limit: 50,
      },
    }), defaultFeedSection)

    expect(header.id).toBe('tag-feed:saved-intelligence')
    expect(header.label).toBe('Intelligence')
    expect(header.summary).toBe('Research, signals, and people to watch.')
  })
})
