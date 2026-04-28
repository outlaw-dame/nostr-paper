// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearDraft,
  pruneExpiredDrafts,
  readDraft,
  writeDraft,
  type DraftContext,
} from './drafts'

const DRAFT_KEY_PREFIX = 'nostr-paper:draft:'
const DAY_MS = 24 * 60 * 60 * 1000

function getDraftKey(context: DraftContext): string {
  return `${DRAFT_KEY_PREFIX}${context}`
}

describe('compose drafts persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useRealTimers()
  })

  afterEach(() => {
    localStorage.clear()
    vi.useRealTimers()
  })

  it('writes and reads a draft round-trip', () => {
    writeDraft('note', { body: 'hello nostr', threadTitle: 'Thread title' })

    const draft = readDraft('note')

    expect(draft).toMatchObject({
      body: 'hello nostr',
      threadTitle: 'Thread title',
    })
    expect(typeof draft?.savedAt).toBe('number')
  })

  it('self-heals corrupt JSON payloads by removing broken draft keys', () => {
    localStorage.setItem(getDraftKey('note'), '{ broken json')

    expect(readDraft('note')).toBeNull()
    expect(localStorage.getItem(getDraftKey('note'))).toBeNull()
  })

  it('expires stale drafts older than 7 days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-10T00:00:00Z'))

    localStorage.setItem(getDraftKey('note'), JSON.stringify({
      body: 'old draft',
      savedAt: Date.now() - (8 * DAY_MS),
    }))

    expect(readDraft('note')).toBeNull()
    expect(localStorage.getItem(getDraftKey('note'))).toBeNull()
  })

  it('rejects oversized draft bodies to avoid localStorage abuse', () => {
    writeDraft('note', { body: 'a'.repeat((256 * 1024) + 1) })

    expect(readDraft('note')).toBeNull()
    expect(localStorage.getItem(getDraftKey('note'))).toBeNull()
  })

  it('clears a saved draft explicitly', () => {
    writeDraft('note', { body: 'temporary draft' })
    clearDraft('note')

    expect(readDraft('note')).toBeNull()
  })

  it('prunes only expired/corrupt draft entries and keeps valid entries', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-10T00:00:00Z'))

    localStorage.setItem(getDraftKey('note'), JSON.stringify({
      body: 'fresh',
      savedAt: Date.now() - DAY_MS,
    }))
    localStorage.setItem(getDraftKey('reply:abc123'), JSON.stringify({
      body: 'expired',
      savedAt: Date.now() - (9 * DAY_MS),
    }))
    localStorage.setItem(getDraftKey('quote:def456'), '{not-json')
    localStorage.setItem('nostr-paper:other-key', 'keep-me')

    pruneExpiredDrafts()

    expect(readDraft('note')?.body).toBe('fresh')
    expect(localStorage.getItem(getDraftKey('reply:abc123'))).toBeNull()
    expect(localStorage.getItem(getDraftKey('quote:def456'))).toBeNull()
    expect(localStorage.getItem('nostr-paper:other-key')).toBe('keep-me')
  })
})
