import {
  canBookmarkEvent,
  getNip51ListPreviewText,
  isEventInBookmarkList,
  parseNip51ListEvent,
} from './lists'
import { Kind, type NostrEvent } from '@/types'

function baseEvent(overrides: Partial<NostrEvent>): NostrEvent {
  return {
    id: '1'.repeat(64),
    pubkey: '2'.repeat(64),
    created_at: 1_720_000_000,
    kind: Kind.ShortNote,
    tags: [],
    content: '',
    sig: '3'.repeat(128),
    ...overrides,
  }
}

describe('parseNip51ListEvent', () => {
  it('keeps only profile references inside a follow set', () => {
    const event = baseEvent({
      kind: Kind.FollowSet,
      tags: [
        ['d', 'close-friends'],
        ['p', '4'.repeat(64)],
        ['e', '5'.repeat(64)],
      ],
    })

    expect(parseNip51ListEvent(event)).toEqual(expect.objectContaining({
      publicItems: [
        { tagName: 'p', values: ['4'.repeat(64)] },
      ],
    }))
  })

  it('parses a standard bookmarks list with legacy private-content detection', () => {
    const event = baseEvent({
      kind: Kind.Bookmarks,
      tags: [
        ['e', '4'.repeat(64)],
        ['a', `${Kind.LongFormContent}:${'5'.repeat(64)}:essay`],
      ],
      content: 'ciphertext==?iv=legacy',
    })

    expect(parseNip51ListEvent(event)).toEqual(expect.objectContaining({
      id: event.id,
      kind: Kind.Bookmarks,
      route: `/note/${event.id}`,
      hasPrivateItems: true,
      privateEncryption: 'nip04',
      publicItems: [
        { tagName: 'e', values: ['4'.repeat(64)] },
        { tagName: 'a', values: [`${Kind.LongFormContent}:${'5'.repeat(64)}:essay`] },
      ],
    }))
    expect(getNip51ListPreviewText(event)).toBe('Bookmarks with 2 public items with encrypted private items.')
  })

  it('parses an addressable set with metadata and an naddr route', () => {
    const event = baseEvent({
      kind: Kind.BookmarkSet,
      tags: [
        ['d', 'favorites'],
        ['title', 'Favorites'],
        ['description', 'Things worth revisiting'],
        ['image', 'https://example.com/favorites.jpg'],
        ['e', '4'.repeat(64)],
      ],
    })

    const parsed = parseNip51ListEvent(event)
    expect(parsed).toEqual(expect.objectContaining({
      kind: Kind.BookmarkSet,
      identifier: 'favorites',
      title: 'Favorites',
      description: 'Things worth revisiting',
      image: 'https://example.com/favorites.jpg',
      route: expect.stringMatching(/^\/a\/naddr1/),
      naddr: expect.stringMatching(/^naddr1/),
    }))
  })

  it('rejects kind mute sets without a numeric d identifier', () => {
    const event = baseEvent({
      kind: Kind.KindMuteSet,
      tags: [['d', 'notes']],
    })

    expect(parseNip51ListEvent(event)).toBeNull()
  })

  it('filters article curation sets to kind-30023 address references and note ids', () => {
    const event = baseEvent({
      kind: Kind.ArticleCurationSet,
      tags: [
        ['d', 'essays'],
        ['a', `${Kind.LongFormContent}:${'6'.repeat(64)}:essay-one`],
        ['a', `${Kind.AppCurationSet}:${'7'.repeat(64)}:wrong-kind`],
        ['e', '8'.repeat(64)],
      ],
    })

    expect(parseNip51ListEvent(event)?.publicItems).toEqual([
      { tagName: 'a', values: [`${Kind.LongFormContent}:${'6'.repeat(64)}:essay-one`] },
      { tagName: 'e', values: ['8'.repeat(64)] },
    ])
  })

  it('filters app curation sets to software-application addresses', () => {
    const event = baseEvent({
      kind: Kind.AppCurationSet,
      tags: [
        ['d', 'apps'],
        ['a', `${Kind.SoftwareApplication}:${'9'.repeat(64)}:com.example.one`],
        ['a', `${Kind.LongFormContent}:${'a'.repeat(64)}:essay-two`],
      ],
    })

    expect(parseNip51ListEvent(event)?.publicItems).toEqual([
      { tagName: 'a', values: [`${Kind.SoftwareApplication}:${'9'.repeat(64)}:com.example.one`] },
    ])
  })

  it('describes starter packs with follow-together copy', () => {
    const event = baseEvent({
      kind: Kind.StarterPack,
      tags: [
        ['d', 'onboarding'],
        ['title', 'Bitcoin Starter Pack'],
        ['p', '4'.repeat(64)],
        ['p', '5'.repeat(64)],
      ],
    })

    expect(getNip51ListPreviewText(event)).toBe('Bitcoin Starter Pack with 2 profiles to follow together.')
  })

  it('describes media starter packs with media-focused follow-together copy', () => {
    const event = baseEvent({
      kind: Kind.MediaStarterPack,
      tags: [
        ['d', 'media'],
        ['p', '6'.repeat(64)],
      ],
    })

    expect(getNip51ListPreviewText(event)).toBe('Media Starter Pack with 1 media-focused profile to follow together.')
  })
})

describe('bookmark helpers', () => {
  it('supports bookmarks for notes and articles but not unrelated kinds', () => {
    const note = baseEvent({
      kind: Kind.ShortNote,
      id: '6'.repeat(64),
    })
    const article = baseEvent({
      kind: Kind.LongFormContent,
      id: '7'.repeat(64),
      pubkey: '8'.repeat(64),
      tags: [['d', 'essay']],
    })
    const video = baseEvent({
      kind: Kind.Video,
      id: '9'.repeat(64),
    })

    expect(canBookmarkEvent(note)).toBe(true)
    expect(canBookmarkEvent(article)).toBe(true)
    expect(canBookmarkEvent(video)).toBe(false)
  })

  it('matches note and article targets inside the global bookmarks list', () => {
    const note = baseEvent({
      kind: Kind.ShortNote,
      id: 'a'.repeat(64),
    })
    const article = baseEvent({
      kind: Kind.LongFormContent,
      id: 'b'.repeat(64),
      pubkey: 'c'.repeat(64),
      tags: [['d', 'essay']],
    })
    const bookmarkList = baseEvent({
      kind: Kind.Bookmarks,
      tags: [
        ['e', note.id],
        ['a', `${Kind.LongFormContent}:${article.pubkey}:essay`],
      ],
    })

    expect(isEventInBookmarkList(note, bookmarkList)).toBe(true)
    expect(isEventInBookmarkList(article, bookmarkList)).toBe(true)
  })
})
