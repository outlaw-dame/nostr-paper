import { describe, expect, it } from 'vitest'
import { filterNsfwTaggedEvents, hasNsfwHashtag } from './nsfwTags'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

function makeEvent(id: string, tags: string[][]): NostrEvent {
  return {
    id,
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: Kind.ShortNote,
    tags,
    content: '',
    sig: 'c'.repeat(128),
  }
}

describe('nsfw hashtag moderation helpers', () => {
  it('matches canonical #nsfw tag (case-insensitive)', () => {
    expect(hasNsfwHashtag(makeEvent('a'.repeat(64), [['t', 'nsfw']]))).toBe(true)
    expect(hasNsfwHashtag(makeEvent('d'.repeat(64), [['t', 'NSFW']]))).toBe(true)
    expect(hasNsfwHashtag(makeEvent('e'.repeat(64), [['t', 'nsfw-art']]))).toBe(false)
    expect(hasNsfwHashtag(makeEvent('f'.repeat(64), [['t', 'art']]))).toBe(false)
  })

  it('matches expanded NSFW hashtag variants', () => {
    const variants = ['adult', 'explicit', 'porn', 'pornography', 'hentai', 'lewd', 'nude', 'nudity', 'naked', 'erotica', 'mature', 'onlyfans', 'boobs', 'xxx', 'sex', 'sexy', 'topless', 'fetish', 'kink']
    for (const variant of variants) {
      expect(hasNsfwHashtag(makeEvent('a'.repeat(64), [['t', variant]]))).toBe(true)
      expect(hasNsfwHashtag(makeEvent('b'.repeat(64), [['t', variant.toUpperCase()]]))).toBe(true)
    }
  })

  it('does not match unrelated tags', () => {
    expect(hasNsfwHashtag(makeEvent('a'.repeat(64), [['t', 'nostr']]))).toBe(false)
    expect(hasNsfwHashtag(makeEvent('b'.repeat(64), [['t', 'bitcoin']]))).toBe(false)
    expect(hasNsfwHashtag(makeEvent('c'.repeat(64), [['t', 'art']]))).toBe(false)
  })

  it('filters tagged posts only when enabled', () => {
    const safe = makeEvent('1'.repeat(64), [['t', 'nostr']])
    const nsfw = makeEvent('2'.repeat(64), [['t', 'nsfw']])

    expect(filterNsfwTaggedEvents([safe, nsfw], false)).toEqual([safe, nsfw])
    expect(filterNsfwTaggedEvents([safe, nsfw], true)).toEqual([safe])
  })

  it('filters expanded variants when enabled', () => {
    const safe   = makeEvent('1'.repeat(64), [['t', 'nostr']])
    const adult  = makeEvent('2'.repeat(64), [['t', 'adult']])
    const lewd   = makeEvent('3'.repeat(64), [['t', 'lewd']])

    expect(filterNsfwTaggedEvents([safe, adult, lewd], true)).toEqual([safe])
  })
})
