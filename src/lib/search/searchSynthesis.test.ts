/**
 * Unit tests for LLM search-answer synthesis (post-retrieval)
 *
 * External LLM helpers are mocked so tests run fully offline.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { NostrEvent } from '@/types'

// --- mocks must be declared before any import of the module under test ---

vi.mock('@/lib/gemma/client', () => ({
  isGemmaAvailable: vi.fn(() => false),
}))

vi.mock('@/lib/ai/gemmaAssist', () => ({
  canUseGeminiAssist: vi.fn(async () => false),
  generateGemmaAssistText: vi.fn(async () => ''),
  generateGeminiAssistText: vi.fn(async () => ''),
}))

vi.mock('@/lib/security/sanitize', () => ({
  sanitizeText: vi.fn((s: string) => s),
}))

import { isGemmaAvailable } from '@/lib/gemma/client'
import {
  canUseGeminiAssist,
  generateGemmaAssistText,
  generateGeminiAssistText,
} from '@/lib/ai/gemmaAssist'
import { synthesizeSearchAnswer } from './searchSynthesis'

const mockIsGemmaAvailable = isGemmaAvailable as ReturnType<typeof vi.fn>
const mockCanUseGeminiAssist = canUseGeminiAssist as ReturnType<typeof vi.fn>
const mockGenerateGemma = generateGemmaAssistText as ReturnType<typeof vi.fn>
const mockGenerateGemini = generateGeminiAssistText as ReturnType<typeof vi.fn>

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeEvent(id: string, content: string): NostrEvent {
  return {
    id,
    pubkey: 'a'.repeat(64),
    created_at: 1_710_000_000,
    kind: 1,
    tags: [],
    content,
    sig: 'b'.repeat(128),
  }
}

const EVENTS_3 = [
  makeEvent('e1', 'Nostr is a decentralized social protocol using public-key cryptography.'),
  makeEvent('e2', 'You can use Nostr to post notes without any central server.'),
  makeEvent('e3', 'Relays store and forward notes; clients choose which relays to connect to.'),
]

const EVENTS_8 = [
  ...EVENTS_3,
  makeEvent('e4', 'Each note is signed by the author\'s private key.'),
  makeEvent('e5', 'Nostr allows users to own their identity via keypairs.'),
  makeEvent('e6', 'Lightning network payments can be integrated into Nostr clients.'),
  makeEvent('e7', 'Most Nostr clients support NIP-01 at minimum.'),
  makeEvent('e8', 'The protocol supports encrypted direct messages.'),
]

beforeEach(() => {
  vi.clearAllMocks()
  mockIsGemmaAvailable.mockReturnValue(false)
  mockCanUseGeminiAssist.mockResolvedValue(false)
  mockGenerateGemma.mockResolvedValue('')
  mockGenerateGemini.mockResolvedValue('')
})

// ─── intent and count gating ──────────────────────────────────────────────────

// Semantic query with 6+ tokens so the real classifyQueryIntent returns 'semantic'
const SEMANTIC_Q = 'what is the nostr protocol about'

describe('synthesizeSearchAnswer — gating', () => {
  // Short (1-token) queries → real classifier returns 'keyword'
  it('returns null for a short keyword query (real classifier: keyword)', async () => {
    const result = await synthesizeSearchAnswer('nostr', EVENTS_3)
    expect(result).toBeNull()
  })

  it('returns null for a handle query (real classifier: keyword)', async () => {
    const result = await synthesizeSearchAnswer('@jack', EVENTS_3)
    expect(result).toBeNull()
  })

  it('returns null for empty query', async () => {
    const result = await synthesizeSearchAnswer('   ', EVENTS_3)
    expect(result).toBeNull()
  })

  it('returns null when fewer than 3 events are provided', async () => {
    const result = await synthesizeSearchAnswer(SEMANTIC_Q, EVENTS_3.slice(0, 2))
    expect(result).toBeNull()
  })

  it('returns null when no LLM is available', async () => {
    mockIsGemmaAvailable.mockReturnValue(false)
    mockCanUseGeminiAssist.mockResolvedValue(false)
    const result = await synthesizeSearchAnswer(SEMANTIC_Q, EVENTS_3)
    expect(result).toBeNull()
  })
})

// ─── provider selection ───────────────────────────────────────────────────────

describe('synthesizeSearchAnswer — provider selection', () => {
  it('uses Gemma when available and returns source=gemma', async () => {
    mockIsGemmaAvailable.mockReturnValue(true)
    mockGenerateGemma.mockResolvedValue('Nostr is a decentralized protocol using keypairs.')

    const result = await synthesizeSearchAnswer(SEMANTIC_Q, EVENTS_3)

    expect(mockGenerateGemma).toHaveBeenCalledOnce()
    expect(mockGenerateGemini).not.toHaveBeenCalled()
    expect(result).not.toBeNull()
    expect(result!.source).toBe('gemma')
    expect(result!.text).toContain('Nostr')
  })

  it('falls back to Gemini when Gemma is unavailable and returns source=gemini', async () => {
    mockIsGemmaAvailable.mockReturnValue(false)
    mockCanUseGeminiAssist.mockResolvedValue(true)
    mockGenerateGemini.mockResolvedValue('Nostr is an open social protocol based on cryptographic keys.')

    const result = await synthesizeSearchAnswer(SEMANTIC_Q, EVENTS_3)

    expect(mockGenerateGemma).not.toHaveBeenCalled()
    expect(mockGenerateGemini).toHaveBeenCalledOnce()
    expect(result!.source).toBe('gemini')
  })

  it('caps input to the first 6 events regardless of how many are passed', async () => {
    mockIsGemmaAvailable.mockReturnValue(true)
    mockGenerateGemma.mockResolvedValue('Summary answer here.')

    await synthesizeSearchAnswer(SEMANTIC_Q, EVENTS_8)

    // The prompt passed to Gemma should only reference up to 6 snippets
    expect(mockGenerateGemma.mock.calls.length).toBeGreaterThan(0)
    const promptArg = mockGenerateGemma.mock.calls[0]?.[0] as string
    // Snippets are labeled [1] through [N]
    expect(promptArg).toContain('[6]')
    expect(promptArg).not.toContain('[7]')
    expect(promptArg).not.toContain('[8]')
  })
})

// ─── output sanitisation ──────────────────────────────────────────────────────

describe('synthesizeSearchAnswer — output sanitisation', () => {
  it('strips an "Answer: " preamble from the model output', async () => {
    mockIsGemmaAvailable.mockReturnValue(true)
    mockGenerateGemma.mockResolvedValue('Answer: Nostr is a protocol.')

    const result = await synthesizeSearchAnswer(SEMANTIC_Q, EVENTS_3)
    expect(result!.text).toBe('Nostr is a protocol.')
  })

  it('strips markdown code fences from the output', async () => {
    mockIsGemmaAvailable.mockReturnValue(true)
    mockGenerateGemma.mockResolvedValue('```\nNostr uses keypairs.\n```')

    const result = await synthesizeSearchAnswer(SEMANTIC_Q, EVENTS_3)
    expect(result!.text).not.toContain('```')
    expect(result!.text).toContain('Nostr uses keypairs.')
  })

  it('truncates output to 420 characters', async () => {
    mockIsGemmaAvailable.mockReturnValue(true)
    const longAnswer = 'a '.repeat(250).trim() // 499 chars
    mockGenerateGemma.mockResolvedValue(longAnswer)

    const result = await synthesizeSearchAnswer(SEMANTIC_Q, EVENTS_3)
    expect(result!.text.length).toBeLessThanOrEqual(420)
    expect(result!.text.endsWith('…')).toBe(true)
  })

  it('returns null when the LLM returns empty text after sanitisation', async () => {
    mockIsGemmaAvailable.mockReturnValue(true)
    mockGenerateGemma.mockResolvedValue('   ')

    const result = await synthesizeSearchAnswer(SEMANTIC_Q, EVENTS_3)
    expect(result).toBeNull()
  })
})

// ─── error resilience ─────────────────────────────────────────────────────────

describe('synthesizeSearchAnswer — error resilience', () => {
  it('returns null when Gemma throws, without propagating', async () => {
    mockIsGemmaAvailable.mockReturnValue(true)
    mockGenerateGemma.mockRejectedValue(new Error('inference failed'))

    const result = await synthesizeSearchAnswer(SEMANTIC_Q, EVENTS_3)
    expect(result).toBeNull()
  })

  it('returns null when Gemini throws, without propagating', async () => {
    mockIsGemmaAvailable.mockReturnValue(false)
    mockCanUseGeminiAssist.mockResolvedValue(true)
    mockGenerateGemini.mockRejectedValue(new Error('timeout'))

    const result = await synthesizeSearchAnswer(SEMANTIC_Q, EVENTS_3)
    expect(result).toBeNull()
  })

  it('respects an already-aborted signal and returns null', async () => {
    mockIsGemmaAvailable.mockReturnValue(true)
    mockGenerateGemma.mockImplementation(async (_prompt: string, signal: AbortSignal) => {
      if (signal.aborted) throw signal.reason
      return 'Nostr is a protocol.'
    })

    const ac = new AbortController()
    ac.abort()

    const result = await synthesizeSearchAnswer(SEMANTIC_Q, EVENTS_3, ac.signal)
    expect(result).toBeNull()
  })
})

// ─── prompt quality ───────────────────────────────────────────────────────────

describe('synthesizeSearchAnswer — prompt construction', () => {
  it('includes the query verbatim in the prompt', async () => {
    mockIsGemmaAvailable.mockReturnValue(true)
    mockGenerateGemma.mockResolvedValue('Some answer.')

    const QUERY = 'how does nostr handle identity and keys'
    await synthesizeSearchAnswer(QUERY, EVENTS_3)

    expect(mockGenerateGemma.mock.calls.length).toBeGreaterThan(0)
    const promptArg = mockGenerateGemma.mock.calls[0]?.[0] as string
    expect(promptArg).toContain(QUERY)
  })

  it('includes event content snippets in the prompt', async () => {
    mockIsGemmaAvailable.mockReturnValue(true)
    mockGenerateGemma.mockResolvedValue('Some answer.')

    await synthesizeSearchAnswer(SEMANTIC_Q, EVENTS_3)

    expect(mockGenerateGemma.mock.calls.length).toBeGreaterThan(0)
    const promptArg = mockGenerateGemma.mock.calls[0]?.[0] as string
    expect(promptArg).toContain('decentralized social protocol')
  })
})
