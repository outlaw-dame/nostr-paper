import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

const listRecentHashtagStats = vi.fn()
const listRecentTaggedEvents = vi.fn()
const rankSemanticDocuments = vi.fn()

vi.mock('@/lib/db/nostr', () => ({
  listRecentHashtagStats,
  listRecentTaggedEvents,
}))

vi.mock('@/lib/semantic/client', () => ({
  rankSemanticDocuments,
}))

function createEvent(id: string, content: string, createdAt: number, tags: string[]): NostrEvent {
  return {
    id,
    pubkey: 'f'.repeat(64),
    created_at: createdAt,
    kind: Kind.ShortNote,
    tags: tags.map((tag) => ['t', tag]),
    content,
    sig: 'a'.repeat(128),
  }
}

describe('compose hashtag helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('extracts the active trailing hashtag prefix', async () => {
    const { getActiveHashtagPrefix } = await import('@/lib/compose/hashtags')

    expect(getActiveHashtagPrefix('writing about nostr #bit')).toBe('bit')
    expect(getActiveHashtagPrefix('writing about nostr')).toBeNull()
  })

  it('replaces the active hashtag when applying a suggestion', async () => {
    const { applyHashtagSuggestion } = await import('@/lib/compose/hashtags')

    expect(applyHashtagSuggestion('writing about #bit', 'bitcoin')).toBe('writing about #bitcoin ')
  })

  it('appends a new hashtag when there is no active prefix', async () => {
    const { applyHashtagSuggestion } = await import('@/lib/compose/hashtags')

    expect(applyHashtagSuggestion('writing about nostr', 'bitcoin')).toBe('writing about nostr #bitcoin ')
  })

  it('balances relevance with recency and popularity', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-20T12:00:00Z'))

    listRecentHashtagStats.mockResolvedValue([
      { tag: 'bitcoin', usageCount: 48, uniqueAuthorCount: 28, latestCreatedAt: 1_742_472_000 },
      { tag: 'lightning', usageCount: 22, uniqueAuthorCount: 18, latestCreatedAt: 1_742_475_000 },
      { tag: 'tech', usageCount: 80, uniqueAuthorCount: 42, latestCreatedAt: 1_740_000_000 },
    ])

    listRecentTaggedEvents.mockResolvedValue([
      createEvent('e1', 'bitcoin self custody and cold storage', 1_742_472_000, ['bitcoin']),
      createEvent('e2', 'lightning wallets and routing tips', 1_742_475_000, ['lightning']),
      createEvent('e3', 'general consumer technology news', 1_740_000_000, ['tech']),
    ])

    rankSemanticDocuments.mockResolvedValue([
      { id: 'e2', score: 0.98 },
      { id: 'e1', score: 0.74 },
      { id: 'e3', score: 0.12 },
    ])

    const { suggestHashtagsForDraft } = await import('@/lib/compose/hashtags')
    const suggestions = await suggestHashtagsForDraft('Comparing self-custody lightning wallets for mobile use')

    expect(suggestions[0]?.tag).toBe('lightning')
    expect(suggestions.some((suggestion) => suggestion.tag === 'bitcoin')).toBe(true)
    expect(suggestions.find((suggestion) => suggestion.tag === 'tech')?.score ?? 0).toBeLessThan(
      suggestions.find((suggestion) => suggestion.tag === 'bitcoin')?.score ?? 1,
    )

    vi.useRealTimers()
  })

  it('falls back to fresh popular prefix matches while typing a hashtag', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-20T12:00:00Z'))

    listRecentHashtagStats.mockResolvedValue([
      { tag: 'bitcoin', usageCount: 40, uniqueAuthorCount: 26, latestCreatedAt: 1_742_475_000 },
      { tag: 'bitdevs', usageCount: 18, uniqueAuthorCount: 12, latestCreatedAt: 1_742_300_000 },
    ])
    listRecentTaggedEvents.mockResolvedValue([])

    const { suggestHashtagsForDraft } = await import('@/lib/compose/hashtags')
    const suggestions = await suggestHashtagsForDraft('Looking at #bit')

    expect(rankSemanticDocuments).not.toHaveBeenCalled()
    expect(suggestions.map((suggestion) => suggestion.tag)).toEqual(['bitcoin', 'bitdevs'])

    vi.useRealTimers()
  })
})
