import { collectStoryGroups, parseStoryEvent } from './stories'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

function baseEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_710_000_000,
    kind: Kind.ShortNote,
    tags: [],
    content: '',
    sig: 'c'.repeat(128),
    ...overrides,
  }
}

describe('parseStoryEvent', () => {
  it('parses expiring kind-1 image stories', () => {
    const event = baseEvent({
      content: 'Morning run\n\nhttps://cdn.example.com/story.jpg',
      tags: [
        ['expiration', '1710003600'],
        [
          'imeta',
          'url https://cdn.example.com/story.jpg',
          'm image/jpeg',
          `x ${'d'.repeat(64)}`,
          'alt Sunrise over the trail',
        ],
      ],
    })

    const story = parseStoryEvent(event, 1_710_000_100)

    expect(story).not.toBeNull()
    expect(story?.media.kind).toBe('image')
    expect(story?.caption).toBe('Morning run')
    expect(story?.expiresAt).toBe(1_710_003_600)
  })

  it('ignores notes without expiration', () => {
    const event = baseEvent({
      content: 'Plain note\n\nhttps://cdn.example.com/story.jpg',
      tags: [
        [
          'imeta',
          'url https://cdn.example.com/story.jpg',
          'm image/jpeg',
          `x ${'e'.repeat(64)}`,
        ],
      ],
    })

    expect(parseStoryEvent(event, 1_710_000_100)).toBeNull()
  })

  it('parses expiring NIP-71 video stories', () => {
    const event = baseEvent({
      kind: Kind.Video,
      content: 'Calm water at sunrise',
      tags: [
        ['expiration', '1710003600'],
        ['title', 'Ocean walk'],
        [
          'imeta',
          'url https://media.example.com/video.mp4',
          'm video/mp4',
          `x ${'f'.repeat(64)}`,
          'dim 1920x1080',
          'image https://media.example.com/poster.jpg',
          'duration 63.5',
        ],
      ],
    })

    const story = parseStoryEvent(event, 1_710_000_100)

    expect(story).not.toBeNull()
    expect(story?.media.kind).toBe('video')
    expect(story?.title).toBe('Ocean walk')
  })
})

describe('collectStoryGroups', () => {
  it('groups active stories by author and sorts them chronologically', () => {
    const events = [
      baseEvent({
        id: '1'.repeat(64),
        created_at: 1_710_000_100,
        content: 'First\n\nhttps://cdn.example.com/one.jpg',
        tags: [
          ['expiration', '1710003600'],
          ['imeta', 'url https://cdn.example.com/one.jpg', 'm image/jpeg', `x ${'1'.repeat(64)}`],
        ],
      }),
      baseEvent({
        id: '2'.repeat(64),
        created_at: 1_710_000_200,
        content: 'Second\n\nhttps://cdn.example.com/two.jpg',
        tags: [
          ['expiration', '1710007200'],
          ['imeta', 'url https://cdn.example.com/two.jpg', 'm image/jpeg', `x ${'2'.repeat(64)}`],
        ],
      }),
    ]

    const groups = collectStoryGroups(events, 1_710_000_300)

    expect(groups).toHaveLength(1)
    expect(groups[0]?.items.map((item) => item.id)).toEqual([
      '1'.repeat(64),
      '2'.repeat(64),
    ])
    expect(groups[0]?.previewImage).toBe('https://cdn.example.com/two.jpg')
  })
})
