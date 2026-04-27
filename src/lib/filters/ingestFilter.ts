/**
 * Ingest-layer keyword filter
 *
 * Provides a fast, synchronous `shouldBlockEvent(event)` guard that is
 * called inside the NDK SQLiteCacheAdapter *before* any event is written to
 * the local database.  Events that match a `'block'` filter are dropped at
 * ingest — they will never appear in any feed, thread, or query.
 *
 * Architecture
 * ────────────
 * • A module-level singleton keeps an in-memory copy of the enabled block
 *   filters so `shouldBlockEvent` runs synchronously with zero async overhead.
 * • The singleton is refreshed on module load and whenever the shared
 *   FILTERS_UPDATED_EVENT fires (same-tab writes OR cross-tab StorageEvent).
 * • Only Tier-1 text matching is used here — semantic (ML) checks are async
 *   and unsuitable for a synchronous hot-path.
 */

import type { NostrEvent } from '@/types'
import type { KeywordFilter } from './types'
import { loadFilters, FILTERS_UPDATED_EVENT } from './storage'
import { extractEventFields } from './extract'
import { checkEventText } from './matcher'
import { getEffectiveKeywordFilters } from './systemFilters'

// ── In-memory cache ───────────────────────────────────────────────────────────

let _blockFilters: KeywordFilter[] = []

function _refreshBlockFilters(all: KeywordFilter[]): void {
  const now = Date.now()
  _blockFilters = all.filter(
    (f) =>
      f.action === 'block' &&
      f.enabled &&
      (f.expiresAt === null || f.expiresAt > now),
  )
}

async function _reload(): Promise<void> {
  try {
    const all = getEffectiveKeywordFilters(await loadFilters())
    _refreshBlockFilters(all)
  } catch {
    // Degraded — keep whatever was last loaded
  }
}

// Initial load
void _reload()

// Re-sync when filters change (same-tab writes)
if (typeof window !== 'undefined') {
  window.addEventListener(FILTERS_UPDATED_EVENT, () => {
    void _reload()
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns `true` when the event matches at least one enabled `'block'` filter
 * rule, meaning the event should be dropped and never written to the DB.
 *
 * This is intentionally synchronous and lightweight — only Tier-1 text
 * matching is performed (no ML embeddings).
 */
export function shouldBlockEvent(event: NostrEvent): boolean {
  if (_blockFilters.length === 0) return false

  const now = Date.now()
  const activeFilters = _blockFilters.filter(
    (f) => f.expiresAt === null || f.expiresAt > now,
  )
  if (activeFilters.length === 0) return false

  const fields = extractEventFields(event)
  const result = checkEventText(fields, activeFilters)
  return result.action === 'block'
}
