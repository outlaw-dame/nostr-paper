import { describe, expect, it } from 'vitest'
import {
  buildEventModerationText,
  buildProfileModerationText,
  normalizeModerationText,
} from './content'
import { Kind, type NostrEvent, type Profile } from '@/types'

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

describe('normalizeModerationText', () => {
  it('strips URLs and nostr references before moderation', () => {
    expect(normalizeModerationText('See https://example.com and nostr:note1test hello'))
      .toBe('See and hello')
  })
})

describe('buildEventModerationText', () => {
  it('combines relevant metadata tags with content', () => {
    const text = buildEventModerationText(baseEvent({
      content: 'Main body',
      tags: [
        ['title', 'Threatening title'],
        ['summary', 'Summary text'],
        ['image', 'https://example.com/image.jpg'],
      ],
    }))

    expect(text).toContain('Threatening title')
    expect(text).toContain('Summary text')
    expect(text).toContain('Main body')
    expect(text).not.toContain('image.jpg')
  })
})

describe('buildProfileModerationText', () => {
  it('uses profile names and bio text', () => {
    const profile: Profile = {
      pubkey: '4'.repeat(64),
      updatedAt: 123,
      name: 'Alice',
      display_name: 'Alice Example',
      about: 'Bio text',
    }

    expect(buildProfileModerationText(profile)).toBe('Alice Example Alice Bio text')
  })
})
