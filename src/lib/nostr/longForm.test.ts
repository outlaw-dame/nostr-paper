import {
  decodeLongFormAddress,
  getArticleRoute,
  getDraftRoute,
  getNostrUriRoute,
  isDraftLongFormEvent,
  isLongFormEvent,
  normalizeLongFormIdentifier,
  parseLongFormEvent,
} from './longForm'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

function baseEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: Kind.LongFormContent,
    tags: [['d', 'hello-world']],
    content: '# Hello World\n\nThis is a **markdown** article.',
    sig: 'c'.repeat(128),
    ...overrides,
  }
}

function draftEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return baseEvent({ kind: Kind.LongFormDraft, ...overrides })
}

// ── normalizeLongFormIdentifier ───────────────────────────────

describe('normalizeLongFormIdentifier', () => {
  it('accepts non-empty printable identifiers', () => {
    expect(normalizeLongFormIdentifier('hello/world')).toBe('hello/world')
  })

  it('rejects empty and control-character identifiers', () => {
    expect(normalizeLongFormIdentifier('')).toBeNull()
    expect(normalizeLongFormIdentifier(' \t ')).toBeNull()
    expect(normalizeLongFormIdentifier('bad\u0000id')).toBeNull()
  })
})

// ── parseLongFormEvent — kind-30023 published ─────────────────

describe('parseLongFormEvent (kind 30023 — published)', () => {
  it('parses all NIP-23 metadata tags', () => {
    const article = parseLongFormEvent(baseEvent({
      tags: [
        ['d', 'hello-world'],
        ['title', 'Hello World'],
        ['summary', 'Short summary'],
        ['image', 'https://example.com/article.jpg'],
        ['published_at', '1700000000'],
        ['t', 'nostr'],
        ['t', 'bitcoin'],
      ],
    }))

    expect(article).not.toBeNull()
    expect(article?.isDraft).toBe(false)
    expect(article?.identifier).toBe('hello-world')
    expect(article?.title).toBe('Hello World')
    expect(article?.summary).toBe('Short summary')
    expect(article?.image).toBe('https://example.com/article.jpg')
    expect(article?.publishedAt).toBe(1_700_000_000)
    expect(article?.hashtags).toEqual(['nostr', 'bitcoin'])
    expect(article?.route).toBe(getArticleRoute('b'.repeat(64), 'hello-world'))
  })

  it('derives title and summary from markdown when tags are missing', () => {
    const article = parseLongFormEvent(baseEvent({
      content: '# Derived Title\n\nA paragraph with [a link](https://example.com) and `code`.',
    }))

    expect(article?.title).toBe('Derived Title')
    expect(article?.summary).toContain('A paragraph with a link and code.')
  })

  it('does not treat a plain external article URL as the article image', () => {
    const article = parseLongFormEvent(baseEvent({
      content: 'https://techcrunch.com/example-story',
    }))

    expect(article?.image).toBeUndefined()
  })

  it('rejects events without a usable d tag', () => {
    expect(parseLongFormEvent(baseEvent({ tags: [] }))).toBeNull()
    expect(parseLongFormEvent(baseEvent({ tags: [['d', '   ']] }))).toBeNull()
  })

  it('rejects events of other kinds', () => {
    expect(parseLongFormEvent(baseEvent({ kind: 1 }))).toBeNull()
    expect(parseLongFormEvent(baseEvent({ kind: 0 }))).toBeNull()
  })

  it('sets isDraft = false for kind 30023', () => {
    const article = parseLongFormEvent(baseEvent())
    expect(article?.isDraft).toBe(false)
  })
})

// ── parseLongFormEvent — kind-30024 draft ─────────────────────

describe('parseLongFormEvent (kind 30024 — draft)', () => {
  it('parses draft events', () => {
    const article = parseLongFormEvent(draftEvent({
      tags: [['d', 'my-draft'], ['title', 'Work in Progress']],
    }))

    expect(article).not.toBeNull()
    expect(article?.isDraft).toBe(true)
    expect(article?.identifier).toBe('my-draft')
    expect(article?.title).toBe('Work in Progress')
    expect(article?.route).toBe(getDraftRoute('b'.repeat(64), 'my-draft'))
  })

  it('rejects draft events without a d tag', () => {
    expect(parseLongFormEvent(draftEvent({ tags: [] }))).toBeNull()
  })

  it('isLongFormEvent returns false for drafts', () => {
    const event = draftEvent()
    expect(isLongFormEvent(event)).toBe(false)
  })

  it('isDraftLongFormEvent returns true for kind 30024', () => {
    const event = draftEvent()
    expect(isDraftLongFormEvent(event)).toBe(true)
  })

  it('isDraftLongFormEvent returns false for kind 30023', () => {
    const event = baseEvent()
    expect(isDraftLongFormEvent(event)).toBe(false)
  })
})

// ── Cross-references (`a` tags) ───────────────────────────────

describe('parseLongFormEvent — a-tag cross-references', () => {
  const authorPubkey = 'b'.repeat(64)

  it('parses valid a-tag references to other articles', () => {
    const referencedPubkey = 'c'.repeat(64)
    const article = parseLongFormEvent(baseEvent({
      tags: [
        ['d', 'my-article'],
        ['a', `30023:${referencedPubkey}:referenced-article`],
      ],
    }))

    expect(article?.references).toHaveLength(1)
    const ref = article?.references[0]
    expect(ref?.kind).toBe(30023)
    expect(ref?.pubkey).toBe(referencedPubkey)
    expect(ref?.identifier).toBe('referenced-article')
    expect(ref?.coordinate).toBe(`30023:${referencedPubkey}:referenced-article`)
    expect(ref?.naddr).toBeTruthy()
  })

  it('stores a relay hint from the a tag when present and safe', () => {
    const refPubkey = 'c'.repeat(64)
    const article = parseLongFormEvent(baseEvent({
      tags: [
        ['d', 'my-article'],
        ['a', `30023:${refPubkey}:slug`, 'wss://relay.example.com'],
      ],
    }))

    expect(article?.references[0]?.relayHint).toBe('wss://relay.example.com')
  })

  it('drops a tags with invalid coordinates', () => {
    const article = parseLongFormEvent(baseEvent({
      tags: [
        ['d', 'my-article'],
        ['a', 'not:a:valid:coord'],
        ['a', ''],
        ['a', 'abc'],
      ],
    }))
    expect(article?.references).toHaveLength(0)
  })

  it('deduplicates repeated a tags with the same coordinate', () => {
    const refPubkey = 'c'.repeat(64)
    const coord = `30023:${refPubkey}:same-article`
    const article = parseLongFormEvent(baseEvent({
      tags: [
        ['d', 'my-article'],
        ['a', coord],
        ['a', coord],
      ],
    }))
    expect(article?.references).toHaveLength(1)
  })

  it('returns empty references array when no a tags present', () => {
    const article = parseLongFormEvent(baseEvent())
    expect(article?.references).toEqual([])
  })

  it('cross-references also work in draft events', () => {
    const refPubkey = 'c'.repeat(64)
    const article = parseLongFormEvent(draftEvent({
      tags: [
        ['d', 'draft-slug'],
        ['a', `30023:${refPubkey}:pub-article`],
      ],
    }))
    expect(article?.references).toHaveLength(1)
  })
})

// ── published_at / updatedAt timestamp semantics ─────────────

describe('parseLongFormEvent — timestamp semantics', () => {
  it('sets updatedAt to created_at', () => {
    const article = parseLongFormEvent(baseEvent({ created_at: 1_700_000_000 }))
    expect(article?.updatedAt).toBe(1_700_000_000)
  })

  it('sets publishedAt from published_at tag', () => {
    const article = parseLongFormEvent(baseEvent({
      created_at: 1_700_005_000,
      tags: [['d', 'x'], ['published_at', '1700000000']],
    }))
    expect(article?.publishedAt).toBe(1_700_000_000)
    expect(article?.updatedAt).toBe(1_700_005_000)
  })

  it('omits publishedAt when tag is absent', () => {
    const article = parseLongFormEvent(baseEvent())
    expect(article?.publishedAt).toBeUndefined()
  })

  it('rejects non-numeric or negative published_at', () => {
    const article = parseLongFormEvent(baseEvent({
      tags: [['d', 'x'], ['published_at', 'not-a-number']],
    }))
    expect(article?.publishedAt).toBeUndefined()
  })
})

// ── NIP-23 address helpers ────────────────────────────────────

describe('NIP-23 address helpers', () => {
  it('decodes naddr back into pubkey and identifier for published articles', () => {
    const article = parseLongFormEvent(baseEvent())
    const decoded = article ? decodeLongFormAddress(article.naddr) : null

    expect(decoded).toEqual({
      pubkey: 'b'.repeat(64),
      identifier: 'hello-world',
      isDraft: false,
    })
  })

  it('decodes naddr back into pubkey and identifier for drafts', () => {
    const article = parseLongFormEvent(draftEvent({ tags: [['d', 'my-draft']] }))
    const decoded = article ? decodeLongFormAddress(article.naddr) : null

    expect(decoded).toEqual({
      pubkey: 'b'.repeat(64),
      identifier: 'my-draft',
      isDraft: true,
    })
  })

  it('maps nostr article references to internal article routes', () => {
    const article = parseLongFormEvent(baseEvent())
    expect(article).not.toBeNull()
    expect(getNostrUriRoute(`nostr:${article!.naddr}`)).toBe(`/a/${article!.naddr}`)
  })

  it('returns null for naddr with wrong kind', () => {
    expect(decodeLongFormAddress('naddr1invalid')).toBeNull()
  })
})
