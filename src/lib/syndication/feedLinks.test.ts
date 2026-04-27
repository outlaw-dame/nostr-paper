import { afterEach, describe, expect, it } from 'vitest'
import {
  listSavedSyndicationFeedLinks,
  removeSyndicationFeedLink,
  saveSyndicationFeedLink,
} from '@/lib/syndication/feedLinks'

describe('syndication feed/link source storage', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('saves and reads feed sources with feed kind metadata', () => {
    const saved = saveSyndicationFeedLink({
      url: 'https://example.com/feed.xml',
      sourceType: 'feed',
      kind: 'rss',
      label: 'Example Feed',
    }, 'alice')

    expect(saved).toMatchObject({
      sourceType: 'feed',
      kind: 'rss',
      linkKind: 'other',
      label: 'Example Feed',
      url: 'https://example.com/feed.xml',
    })

    const entries = listSavedSyndicationFeedLinks('alice')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      sourceType: 'feed',
      kind: 'rss',
      linkKind: 'other',
    })
  })

  it('saves and reads non-feed link sources with link kind metadata', () => {
    const saved = saveSyndicationFeedLink({
      url: 'https://example.com/newsletter',
      sourceType: 'link',
      linkKind: 'newsletter',
      label: 'Weekly Notes',
    }, 'alice')

    expect(saved).toMatchObject({
      sourceType: 'link',
      kind: 'auto',
      linkKind: 'newsletter',
      label: 'Weekly Notes',
    })

    const entries = listSavedSyndicationFeedLinks('alice')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      sourceType: 'link',
      kind: 'auto',
      linkKind: 'newsletter',
    })
  })

  it('migrates legacy records without sourceType to feed defaults', () => {
    window.localStorage.setItem('nostr-paper:syndication-feed-links:v1:alice', JSON.stringify([
      {
        id: 'legacy-entry',
        url: 'https://legacy.example.com/feed.xml',
        kind: 'atom',
        label: 'Legacy Feed',
        createdAt: 1,
        updatedAt: 2,
      },
    ]))

    const entries = listSavedSyndicationFeedLinks('alice')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      id: 'legacy-entry',
      sourceType: 'feed',
      kind: 'atom',
      linkKind: 'other',
    })
  })

  it('removes saved sources by id', () => {
    const first = saveSyndicationFeedLink({
      url: 'https://example.com/feed.xml',
      sourceType: 'feed',
      kind: 'rss',
    }, 'alice')

    const second = saveSyndicationFeedLink({
      url: 'https://example.com/site',
      sourceType: 'link',
      linkKind: 'website',
    }, 'alice')

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()

    if (!first) return
    removeSyndicationFeedLink(first.id, 'alice')
    const remaining = listSavedSyndicationFeedLinks('alice')

    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.sourceType).toBe('link')
  })
})
