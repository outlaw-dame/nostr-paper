import { describe, expect, it, vi } from 'vitest'

import {
  classifyFactCheckRating,
  searchFactChecks,
} from '@/lib/security/factCheck'

describe('factCheck', () => {
  it('classifies textual ratings conservatively', () => {
    expect(classifyFactCheckRating('False')).toBe('false')
    expect(classifyFactCheckRating('Mostly accurate')).toBe('true')
    expect(classifyFactCheckRating('Mixed')).toBe('mixed')
  })

  it('retries transient upstream failures', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        claims: [{
          text: 'Claim text',
          claimReview: [{
            textualRating: 'False',
            url: 'https://example.org/review',
            publisher: { name: 'Fact Checker' },
          }],
        }],
      }), { status: 200 }))

    const originalFetch = globalThis.fetch
    ;(globalThis as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch

    const result = await searchFactChecks(`test-query-${Date.now()}`)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.ratings).toHaveLength(1)
    expect(result.ratings[0]?.textualRating).toBe('False')

    ;(globalThis as { fetch?: typeof fetch }).fetch = originalFetch
  })
})
