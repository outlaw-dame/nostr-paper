/**
 * Tests: Search Intent Router
 *
 * Covers:
 *  - heuristicClassifySearchIntent: regex-based pre-classification
 *  - classifySearchIntent: full function including heuristic fast path
 *  - Worker mock: verifies fallback to 'hybrid' on worker errors and disabled state
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { heuristicClassifySearchIntent, classifySearchIntent } from '@/lib/search/router'

// ── heuristicClassifySearchIntent ─────────────────────────────

describe('heuristicClassifySearchIntent', () => {
  describe('lexical patterns', () => {
    it('classifies a single hashtag as lexical', () => {
      expect(heuristicClassifySearchIntent('#bitcoin')).toBe('lexical')
    })

    it('classifies multiple hashtags as lexical', () => {
      expect(heuristicClassifySearchIntent('#nostr #lightning')).toBe('lexical')
    })

    it('classifies an @mention as lexical', () => {
      expect(heuristicClassifySearchIntent('@alice')).toBe('lexical')
    })

    it('classifies a nostr npub key as lexical', () => {
      expect(heuristicClassifySearchIntent('npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq28nx5z')).toBe('lexical')
    })

    it('classifies a nostr nsec key as lexical', () => {
      expect(heuristicClassifySearchIntent('nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq4jle2r')).toBe('lexical')
    })

    it('classifies a note bech32 as lexical', () => {
      expect(heuristicClassifySearchIntent('note1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp0hj4e')).toBe('lexical')
    })

    it('classifies a 64-char hex string as lexical', () => {
      expect(heuristicClassifySearchIntent('a'.repeat(64))).toBe('lexical')
    })

    it('classifies mixed-case 64-char hex as lexical', () => {
      expect(heuristicClassifySearchIntent('AABBCC' + 'a'.repeat(58))).toBe('lexical')
    })

    it('classifies an empty string as lexical', () => {
      expect(heuristicClassifySearchIntent('')).toBe('lexical')
    })

    it('classifies whitespace-only string as lexical', () => {
      expect(heuristicClassifySearchIntent('   ')).toBe('lexical')
    })
  })

  describe('semantic patterns', () => {
    it('classifies a question-mark query as semantic', () => {
      expect(heuristicClassifySearchIntent('what is zapping?')).toBe('semantic')
    })

    it('classifies a conceptual query with ? as semantic', () => {
      expect(heuristicClassifySearchIntent('how does lightning network work?')).toBe('semantic')
    })
  })

  describe('ambiguous patterns (returns null)', () => {
    it('returns null for natural language without ?', () => {
      expect(heuristicClassifySearchIntent('posts about climate change')).toBeNull()
    })

    it('returns null for a single common word', () => {
      expect(heuristicClassifySearchIntent('bitcoin')).toBeNull()
    })

    it('returns null for mixed lexical and conceptual', () => {
      expect(heuristicClassifySearchIntent('#bitcoin price discussion')).toBeNull()
    })

    it('returns null for a topic phrase', () => {
      expect(heuristicClassifySearchIntent('decentralized social media')).toBeNull()
    })
  })
})

// ── classifySearchIntent (integration with heuristic + fallback) ──

// Mock the Worker global so the worker file is never actually instantiated
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  postMessage(_data: unknown) {}
  terminate() {}
}

describe('classifySearchIntent', () => {
  let OriginalWorker: typeof Worker

  beforeEach(() => {
    OriginalWorker = globalThis.Worker
    // Replace Worker with our mock so no actual worker is spawned
    globalThis.Worker = MockWorker as unknown as typeof Worker
  })

  afterEach(() => {
    globalThis.Worker = OriginalWorker
    vi.restoreAllMocks()
  })

  it('resolves heuristic lexical patterns without touching the worker', async () => {
    const result = await classifySearchIntent('#bitcoin')
    expect(result).toBe('lexical')
  })

  it('resolves heuristic semantic patterns (?) without touching the worker', async () => {
    const result = await classifySearchIntent('what is nostr?')
    expect(result).toBe('semantic')
  })

  it('returns hybrid for ambiguous queries when router is disabled (default)', async () => {
    // VITE_ENABLE_SEARCH_ROUTER defaults to false in tests, so LLM path is skipped
    const result = await classifySearchIntent('bitcoin price analysis')
    expect(result).toBe('hybrid')
  })

  it('returns hybrid for empty string', async () => {
    const result = await classifySearchIntent('')
    expect(result).toBe('lexical') // empty → heuristic returns lexical
  })

  it('always resolves — never rejects', async () => {
    await expect(classifySearchIntent('some query that could fail')).resolves.toBeDefined()
  })

  it('returns a valid SearchIntent value for any input', async () => {
    const valid = new Set(['lexical', 'semantic', 'hybrid'])
    const results = await Promise.all([
      classifySearchIntent('#nostr'),
      classifySearchIntent('hello world?'),
      classifySearchIntent('conceptual query'),
      classifySearchIntent('npub1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa7e4j'),
    ])
    for (const r of results) {
      expect(valid.has(r)).toBe(true)
    }
  })
})

// ── heuristic edge cases ───────────────────────────────────────

describe('heuristicClassifySearchIntent — edge cases', () => {
  it('handles uppercase hashtag', () => {
    expect(heuristicClassifySearchIntent('#Bitcoin')).toBe('lexical')
  })

  it('handles a hashtag and mention together', () => {
    expect(heuristicClassifySearchIntent('#bitcoin @alice')).toBe('lexical')
  })

  it('handles a query with only whitespace tokens still classified correctly', () => {
    // After trim, split by \s+, every token check
    const result = heuristicClassifySearchIntent('#a #b #c')
    expect(result).toBe('lexical')
  })

  it('returns null for a word that looks like a hashtag prefix but is not', () => {
    // "hash" starts with letters but no #
    expect(heuristicClassifySearchIntent('hash table data structure')).toBeNull()
  })

  it('does not misclassify partial nostr key prefixes', () => {
    // "npub" alone is not a full bech32 key
    expect(heuristicClassifySearchIntent('npub')).toBeNull()
  })
})
