import { describe, expect, it } from 'vitest'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'
import {
  buildTagTimelineSemanticQuery,
  buildTagTimelineHref,
  describeTagTimeline,
  matchesTagTimeline,
  parseTagTimeline,
  parseTagTimelineDraft,
} from './tagTimeline'

function makeEvent(tags: string[], content = ''): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: Kind.ShortNote,
    tags: tags.map((tag) => ['t', tag]),
    content,
    sig: 'c'.repeat(128),
  }
}

describe('tagTimeline helpers', () => {
  it('parses multi-tag routes with mode and exclusions', () => {
    expect(parseTagTimeline('Bitcoin+Nostr', '?mode=all&exclude=spam,ads')).toEqual({
      includeTags: ['bitcoin', 'nostr'],
      excludeTags: ['spam', 'ads'],
      mode: 'all',
    })
  })

  it('builds canonical hrefs for shareable tag mixes', () => {
    expect(buildTagTimelineHref({
      includeTags: ['bitcoin', 'nostr'],
      excludeTags: ['spam'],
      mode: 'all',
    })).toBe('/t/bitcoin+nostr?mode=all&exclude=spam')
  })

  it('builds a semantic query from hashtag concepts', () => {
    expect(buildTagTimelineSemanticQuery(parseTagTimeline('apple+macbook_pro', ''))).toBe('apple macbook_pro macbook pro')
  })

  it('matches events for any-mode timelines', () => {
    const spec = parseTagTimeline('bitcoin+nostr', '')!
    expect(matchesTagTimeline(makeEvent(['bitcoin']), spec)).toBe(true)
    expect(matchesTagTimeline(makeEvent(['nostr']), spec)).toBe(true)
    expect(matchesTagTimeline(makeEvent(['music']), spec)).toBe(false)
  })

  it('matches plaintext counterparts when tags are missing', () => {
    const spec = parseTagTimeline('apple+iphone', '')!
    expect(matchesTagTimeline(makeEvent([], 'Apple just shipped a new iPhone camera system'), spec)).toBe(true)
  })

  it('matches events for all-mode timelines while respecting exclusions', () => {
    const spec = parseTagTimeline('bitcoin+nostr', '?mode=all&exclude=spam')!
    expect(matchesTagTimeline(makeEvent(['bitcoin', 'nostr']), spec)).toBe(true)
    expect(matchesTagTimeline(makeEvent(['bitcoin']), spec)).toBe(false)
    expect(matchesTagTimeline(makeEvent(['bitcoin', 'nostr', 'spam']), spec)).toBe(false)
  })

  it('admits semantic context for strongly related events', () => {
    const spec = parseTagTimeline('apple+iphone+macbook', '?mode=all')!
    expect(matchesTagTimeline(
      makeEvent([], 'Apple ecosystem updates and hardware roadmap'),
      spec,
      { semanticScore: 0.78 },
    )).toBe(false)
    expect(matchesTagTimeline(
      makeEvent([], 'Apple refreshed the MacBook lineup for creators'),
      spec,
      { semanticScore: 0.78 },
    )).toBe(true)
  })

  it('parses include and exclude drafts', () => {
    expect(parseTagTimelineDraft('#nostr')).toEqual({ tag: 'nostr', exclude: false })
    expect(parseTagTimelineDraft('-#spam')).toEqual({ tag: 'spam', exclude: true })
  })

  it('describes multi-tag timelines for the header copy', () => {
    expect(describeTagTimeline(parseTagTimeline('bitcoin+nostr', '?mode=all&exclude=spam'))).toEqual({
      includeTags: ['bitcoin', 'nostr'],
      excludeTags: ['spam'],
      mode: 'all',
      title: 'Tag Mix',
      summary: 'Posts, articles, and videos matching all of #bitcoin, #nostr, including plain-text mentions and semantic context. Excluding #spam.',
    })
  })
})
