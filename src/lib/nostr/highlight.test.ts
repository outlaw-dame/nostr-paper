import {
  getHighlightPreviewText,
  getHighlightSourceLabel,
  isHighlightEvent,
  parseHighlightEvent,
} from './highlight'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

function baseHighlight(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: Kind.Highlight,
    tags: [['r', 'https://example.com/article']],
    content: 'This is a highlighted passage from the article.',
    sig: 'c'.repeat(128),
    ...overrides,
  }
}

// ── isHighlightEvent ─────────────────────────────────────────

describe('isHighlightEvent', () => {
  it('returns true for kind 9802', () => {
    expect(isHighlightEvent(baseHighlight())).toBe(true)
  })

  it('returns false for other kinds', () => {
    expect(isHighlightEvent(baseHighlight({ kind: 1 }))).toBe(false)
    expect(isHighlightEvent(baseHighlight({ kind: 30023 }))).toBe(false)
  })
})

// ── parseHighlightEvent ──────────────────────────────────────

describe('parseHighlightEvent', () => {
  it('parses a minimal highlight (content + r tag)', () => {
    const result = parseHighlightEvent(baseHighlight())
    expect(result).not.toBeNull()
    expect(result?.excerpt).toBe('This is a highlighted passage from the article.')
    expect(result?.sourceUrl).toBe('https://example.com/article')
    expect(result?.comment).toBeUndefined()
    expect(result?.context).toBeUndefined()
    expect(result?.sourceCoordinate).toBeUndefined()
    expect(result?.sourceEventId).toBeUndefined()
    expect(result?.attributedPubkeys).toEqual([])
  })

  it('parses comment and context tags', () => {
    const result = parseHighlightEvent(
      baseHighlight({
        tags: [
          ['r', 'https://example.com/article'],
          ['comment', 'Great insight about X.'],
          ['context', 'The surrounding text around the highlighted passage.'],
        ],
      }),
    )
    expect(result?.comment).toBe('Great insight about X.')
    expect(result?.context).toBe('The surrounding text around the highlighted passage.')
  })

  it('parses an a-tag source coordinate', () => {
    const result = parseHighlightEvent(
      baseHighlight({
        tags: [['a', '30023:b'.repeat(4) + ':my-article']],
      }),
    )
    expect(result?.sourceCoordinate).toContain('30023:')
  })

  it('parses an e-tag source event id', () => {
    const validEventId = 'd'.repeat(64)
    const result = parseHighlightEvent(
      baseHighlight({
        tags: [['e', validEventId]],
      }),
    )
    expect(result?.sourceEventId).toBe(validEventId)
  })

  it('parses attributed p-tags', () => {
    const pubkey1 = 'e'.repeat(64)
    const pubkey2 = 'f'.repeat(64)
    const result = parseHighlightEvent(
      baseHighlight({
        tags: [
          ['r', 'https://example.com/article'],
          ['p', pubkey1],
          ['p', pubkey2],
        ],
      }),
    )
    expect(result?.attributedPubkeys).toEqual([pubkey1, pubkey2])
  })

  it('rejects invalid p-tags', () => {
    const result = parseHighlightEvent(
      baseHighlight({
        tags: [
          ['r', 'https://example.com/article'],
          ['p', 'not-a-valid-hex'],
          ['p', ''],
        ],
      }),
    )
    expect(result?.attributedPubkeys).toEqual([])
  })

  it('returns null for wrong kind', () => {
    expect(parseHighlightEvent(baseHighlight({ kind: 1 }))).toBeNull()
  })

  it('returns null for empty content', () => {
    expect(parseHighlightEvent(baseHighlight({ content: '' }))).toBeNull()
    expect(parseHighlightEvent(baseHighlight({ content: '   ' }))).toBeNull()
  })

  it('rejects unsafe source URLs', () => {
    const result = parseHighlightEvent(
      baseHighlight({
        tags: [['r', 'javascript:alert(1)']],
        content: 'Something highlighted.',
      }),
    )
    expect(result).not.toBeNull()
    expect(result?.sourceUrl).toBeUndefined()
  })

  it('truncates very long excerpts', () => {
    const longContent = 'x'.repeat(5_000)
    const result = parseHighlightEvent(baseHighlight({ content: longContent }))
    expect(result?.excerpt.length).toBeLessThan(longContent.length)
    expect(result?.excerpt.endsWith('…')).toBe(true)
  })
})

// ── getHighlightPreviewText ───────────────────────────────────

describe('getHighlightPreviewText', () => {
  it('wraps excerpt in quotes', () => {
    const text = getHighlightPreviewText(baseHighlight())
    expect(text).toContain('"')
    expect(text).toContain('highlighted passage')
  })

  it('appends comment after em-dash when present', () => {
    const text = getHighlightPreviewText(
      baseHighlight({
        tags: [
          ['r', 'https://example.com'],
          ['comment', 'My annotation.'],
        ],
      }),
    )
    expect(text).toContain('— My annotation.')
  })

  it('returns empty string for non-highlight event', () => {
    expect(getHighlightPreviewText(baseHighlight({ kind: 1 }))).toBe('')
  })
})

// ── getHighlightSourceLabel ──────────────────────────────────

describe('getHighlightSourceLabel', () => {
  it('returns hostname for web source', () => {
    const highlight = parseHighlightEvent(baseHighlight())!
    expect(getHighlightSourceLabel(highlight)).toBe('example.com')
  })

  it('strips www prefix', () => {
    const highlight = parseHighlightEvent(
      baseHighlight({ tags: [['r', 'https://www.example.com/page']] }),
    )!
    expect(getHighlightSourceLabel(highlight)).toBe('example.com')
  })

  it('returns Article for kind 30023 coordinate', () => {
    const highlight = parseHighlightEvent(
      baseHighlight({
        tags: [['a', `30023:${'b'.repeat(64)}:my-article`]],
        content: 'Something.',
      }),
    )!
    expect(getHighlightSourceLabel(highlight)).toBe('Article')
  })

  it('returns Nostr note for e-tag source', () => {
    const highlight = parseHighlightEvent(
      baseHighlight({
        tags: [['e', 'e'.repeat(64)]],
        content: 'Something.',
      }),
    )!
    expect(getHighlightSourceLabel(highlight)).toBe('Nostr note')
  })

  it('returns Unknown source when no source tags', () => {
    const highlight = parseHighlightEvent(
      baseHighlight({ tags: [], content: 'Something.' }),
    )!
    expect(getHighlightSourceLabel(highlight)).toBe('Unknown source')
  })
})
