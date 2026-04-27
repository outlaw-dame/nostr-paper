/**
 * Unit tests for LLM query rewriting (pre-retrieval)
 *
 * The module under test calls external LLM helpers; we mock them so tests run
 * fully offline without touching any model runtime.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

// --- mocks must be declared before any import of the module under test ---

vi.mock('@/lib/gemma/client', () => ({
  isGemmaAvailable: vi.fn(() => false),
}))

vi.mock('@/lib/ai/gemmaAssist', () => ({
  canUseGeminiAssist: vi.fn(async () => false),
  generateGemmaAssistText: vi.fn(async () => ''),
  generateGeminiAssistText: vi.fn(async () => ''),
}))

import { isGemmaAvailable } from '@/lib/gemma/client'
import {
  canUseGeminiAssist,
  generateGemmaAssistText,
  generateGeminiAssistText,
} from '@/lib/ai/gemmaAssist'
import { rewriteSearchQuery } from './queryRewrite'

const mockIsGemmaAvailable = isGemmaAvailable as ReturnType<typeof vi.fn>
const mockCanUseGeminiAssist = canUseGeminiAssist as ReturnType<typeof vi.fn>
const mockGenerateGemma = generateGemmaAssistText as ReturnType<typeof vi.fn>
const mockGenerateGemini = generateGeminiAssistText as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockIsGemmaAvailable.mockReturnValue(false)
  mockCanUseGeminiAssist.mockResolvedValue(false)
  mockGenerateGemma.mockResolvedValue('')
  mockGenerateGemini.mockResolvedValue('')
})

// ─── intent gating ────────────────────────────────────────────────────────────

describe('rewriteSearchQuery — intent gating', () => {
  it('returns null for a short keyword-only query (real classifier: keyword)', async () => {
    // 'bitcoin' is 1 token → classifyQueryIntent returns 'keyword'
    const result = await rewriteSearchQuery('bitcoin')
    expect(result).toBeNull()
  })

  it('returns null for a handle query (real classifier: keyword)', async () => {
    // '@jack' is 1 token starting with @ → classifyQueryIntent returns 'keyword'
    const result = await rewriteSearchQuery('@jack')
    expect(result).toBeNull()
  })

  it('returns null for empty input', async () => {
    const result = await rewriteSearchQuery('   ')
    expect(result).toBeNull()
  })

  it('returns null for a 3-token query (real classifier: balanced, not semantic)', async () => {
    // 'tell me about' is 3 tokens → classifyQueryIntent returns 'balanced'
    const result = await rewriteSearchQuery('tell me about')
    expect(result).toBeNull()
  })
})

// ─── provider selection ───────────────────────────────────────────────────────

describe('rewriteSearchQuery — provider selection', () => {
  const LONG_QUERY = 'what are people saying about bitcoin price predictions for 2026'

  it('uses Gemma when available and returns the sanitized rewrite', async () => {
    mockIsGemmaAvailable.mockReturnValue(true)
    mockGenerateGemma.mockResolvedValue('bitcoin price predictions 2026')

    const result = await rewriteSearchQuery(LONG_QUERY)

    expect(mockGenerateGemma).toHaveBeenCalledOnce()
    expect(mockGenerateGemini).not.toHaveBeenCalled()
    expect(result).toBe('bitcoin price predictions 2026')
  })

  it('falls back to Gemini when Gemma is unavailable', async () => {
    mockIsGemmaAvailable.mockReturnValue(false)
    mockCanUseGeminiAssist.mockResolvedValue(true)
    mockGenerateGemini.mockResolvedValue('bitcoin price forecast 2026')

    const result = await rewriteSearchQuery(LONG_QUERY)

    expect(mockGenerateGemma).not.toHaveBeenCalled()
    expect(mockGenerateGemini).toHaveBeenCalledOnce()
    expect(result).toBe('bitcoin price forecast 2026')
  })

  it('returns null when no LLM is available', async () => {
    mockIsGemmaAvailable.mockReturnValue(false)
    mockCanUseGeminiAssist.mockResolvedValue(false)

    const result = await rewriteSearchQuery(LONG_QUERY)

    expect(result).toBeNull()
  })
})

// ─── sanitisation ─────────────────────────────────────────────────────────────

describe('rewriteSearchQuery — output sanitisation', () => {
  const LONG_QUERY = 'what are people talking about regarding the latest nostr protocol updates'

  it('strips a "Keywords: " preamble from the model output', async () => {
    mockIsGemmaAvailable.mockReturnValue(true)
    mockGenerateGemma.mockResolvedValue('Keywords: nostr protocol updates')

    const result = await rewriteSearchQuery(LONG_QUERY)
    expect(result).toBe('nostr protocol updates')
  })

  it('rejects output that looks like a full sentence (contains a period)', async () => {
    mockIsGemmaAvailable.mockReturnValue(true)
    mockGenerateGemma.mockResolvedValue('Here are some keywords. Nostr protocol.')

    const result = await rewriteSearchQuery(LONG_QUERY)
    expect(result).toBeNull()
  })

  it('rejects output with more than 12 tokens', async () => {
    mockIsGemmaAvailable.mockReturnValue(true)
    // 13 tokens — one over the limit
    mockGenerateGemma.mockResolvedValue(
      'nostr protocol decentralization updates relay messaging clients pubkeys keys bitcoin lightning network payments',
    )

    const result = await rewriteSearchQuery(LONG_QUERY)
    expect(result).toBeNull()
  })

  it('returns null when the rewrite is identical to the original (lowercased)', async () => {
    const QUERY = 'what are people talking about regarding the latest nostr protocol updates'
    mockIsGemmaAvailable.mockReturnValue(true)
    // Exact match after lowercase trim
    mockGenerateGemma.mockResolvedValue(QUERY.toLowerCase())

    const result = await rewriteSearchQuery(QUERY)
    expect(result).toBeNull()
  })
})

// ─── error resilience ─────────────────────────────────────────────────────────

describe('rewriteSearchQuery — error resilience', () => {
  const LONG_QUERY = 'what does everyone think about the new gemma model performance on mobile devices'

  it('returns null when Gemma throws, without propagating the error', async () => {
    mockIsGemmaAvailable.mockReturnValue(true)
    mockGenerateGemma.mockRejectedValue(new Error('inference error'))

    const result = await rewriteSearchQuery(LONG_QUERY)
    expect(result).toBeNull()
  })

  it('returns null when Gemini throws, without propagating the error', async () => {
    mockIsGemmaAvailable.mockReturnValue(false)
    mockCanUseGeminiAssist.mockResolvedValue(true)
    mockGenerateGemini.mockRejectedValue(new Error('network error'))

    const result = await rewriteSearchQuery(LONG_QUERY)
    expect(result).toBeNull()
  })

  it('respects an already-aborted signal and returns null', async () => {
    mockIsGemmaAvailable.mockReturnValue(true)
    mockGenerateGemma.mockImplementation(async (_prompt: string, signal: AbortSignal) => {
      if (signal.aborted) throw signal.reason
      return 'gemma model performance mobile'
    })

    const ac = new AbortController()
    ac.abort()

    const result = await rewriteSearchQuery(LONG_QUERY, ac.signal)
    expect(result).toBeNull()
  })
})
