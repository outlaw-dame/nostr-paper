import { afterEach, describe, expect, it } from 'vitest'
import { deleteTagFeed, getSavedTagFeeds, getTagFeedsStorageKey, saveTagFeed } from './tagFeeds'

describe('tagFeeds storage', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('creates normalized saved tag feeds', () => {
    const saved = saveTagFeed({
      title: ' Apple ',
      description: ' <b>Curated chatter</b> ',
      avatar: 'https://cdn.example.com/avatar.jpg',
      banner: 'https://cdn.example.com/banner.jpg',
      profilePubkeys: ['A'.repeat(64), 'a'.repeat(64), 'not-a-pubkey'],
      includeTags: ['Apple', 'iPhone'],
      excludeTags: ['SPAM', 'apple'],
      mode: 'all',
    }, 'alice')

    expect(saved).toMatchObject({
      title: 'Apple',
      description: 'Curated chatter',
      avatar: 'https://cdn.example.com/avatar.jpg',
      banner: 'https://cdn.example.com/banner.jpg',
      profilePubkeys: ['a'.repeat(64)],
      includeTags: ['apple', 'iphone'],
      excludeTags: ['spam'],
      mode: 'all',
    })
    expect(getSavedTagFeeds('alice')).toEqual([saved])
    expect(getSavedTagFeeds('bob')).toEqual([saved])
  })

  it('falls back to any mode for single-tag feeds and derives a title when needed', () => {
    const saved = saveTagFeed({
      title: '   ',
      includeTags: ['Bitcoin'],
      excludeTags: [],
      mode: 'all',
    }, 'alice')

    expect(saved).toMatchObject({
      title: '#bitcoin',
      includeTags: ['bitcoin'],
      excludeTags: [],
      mode: 'any',
    })
  })

  it('updates and deletes saved feeds', () => {
    const created = saveTagFeed({
      title: 'Apple',
      description: 'All the Apple chatter in one place.',
      avatar: 'https://cdn.example.com/apple-avatar.jpg',
      banner: 'https://cdn.example.com/apple-banner.jpg',
      profilePubkeys: ['1'.repeat(64)],
      includeTags: ['apple', 'iphone'],
      excludeTags: [],
      mode: 'any',
    }, 'alice')

    const updated = saveTagFeed({
      id: created?.id,
      title: 'Apple Ecosystem',
      description: 'Hardware, software, and creators around Apple.',
      avatar: 'https://cdn.example.com/apple-avatar-2.jpg',
      banner: 'https://cdn.example.com/apple-banner-2.jpg',
      profilePubkeys: ['1'.repeat(64), '2'.repeat(64)],
      includeTags: ['apple', 'iphone', 'macbook'],
      excludeTags: ['spam'],
      mode: 'all',
    }, 'alice')

    expect(updated?.id).toBe(created?.id)
    expect(getSavedTagFeeds('alice')).toHaveLength(1)
    expect(getSavedTagFeeds('alice')[0]).toMatchObject({
      title: 'Apple Ecosystem',
      description: 'Hardware, software, and creators around Apple.',
      avatar: 'https://cdn.example.com/apple-avatar-2.jpg',
      banner: 'https://cdn.example.com/apple-banner-2.jpg',
      profilePubkeys: ['1'.repeat(64), '2'.repeat(64)],
      includeTags: ['apple', 'iphone', 'macbook'],
      excludeTags: ['spam'],
      mode: 'all',
    })

    deleteTagFeed(created!.id, 'alice')
    expect(getSavedTagFeeds('alice')).toEqual([])
    expect(getSavedTagFeeds('bob')).toEqual([])
  })

  it('migrates anon and account-scoped feeds into the global browser scope', () => {
    window.localStorage.setItem('nostr-paper:tag-feeds:v1:anon', JSON.stringify([
      {
        id: 'anon-feed',
        title: 'Apple',
        includeTags: ['apple'],
        excludeTags: [],
        mode: 'any',
        createdAt: 10,
        updatedAt: 10,
      },
    ]))
    window.localStorage.setItem('nostr-paper:tag-feeds:v1:alice', JSON.stringify([
      {
        id: 'alice-feed',
        title: 'Apple Ecosystem',
        includeTags: ['apple'],
        excludeTags: [],
        mode: 'any',
        createdAt: 20,
        updatedAt: 20,
      },
      {
        id: 'nostr-feed',
        title: 'Nostr',
        includeTags: ['nostr'],
        excludeTags: [],
        mode: 'any',
        createdAt: 30,
        updatedAt: 30,
      },
    ]))

    const migrated = getSavedTagFeeds('alice')

    expect(migrated).toMatchObject([
      {
        title: 'Apple Ecosystem',
        includeTags: ['apple'],
      },
      {
        title: 'Nostr',
        includeTags: ['nostr'],
      },
    ])
    expect(window.localStorage.getItem('nostr-paper:tag-feeds:v1:anon')).toBeNull()
    expect(window.localStorage.getItem('nostr-paper:tag-feeds:v1:alice')).toBeNull()
    expect(JSON.parse(window.localStorage.getItem(getTagFeedsStorageKey('alice')) ?? '[]')).toHaveLength(2)
  })

  it('migrates feeds from any legacy account scope into the global browser scope', () => {
    window.localStorage.setItem('nostr-paper:tag-feeds:v1:deadbeef', JSON.stringify([
      {
        id: 'legacy-feed',
        title: 'Intelligence',
        includeTags: ['intelligence'],
        excludeTags: [],
        mode: 'any',
        createdAt: 40,
        updatedAt: 40,
      },
    ]))

    const migrated = getSavedTagFeeds('alice')

    expect(migrated).toMatchObject([
      {
        title: 'Intelligence',
        includeTags: ['intelligence'],
      },
    ])
    expect(window.localStorage.getItem('nostr-paper:tag-feeds:v1:deadbeef')).toBeNull()
    expect(JSON.parse(window.localStorage.getItem(getTagFeedsStorageKey('alice')) ?? '[]')).toHaveLength(1)
  })
})
