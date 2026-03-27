/**
 * Keyword Filter — persistent storage
 *
 * Stores KeywordFilter rules in a dedicated IndexedDB database using
 * idb-keyval, following the same pattern as translation storage.
 */

import { createStore, entries, get, set, del } from 'idb-keyval'
import type { KeywordFilter, CreateFilterInput } from './types'

const STORE = createStore('nostr-paper-filters', 'keyword-filters')

/** Custom event name broadcast when filters change (same-tab). */
export const FILTERS_UPDATED_EVENT = 'nostr-paper:keyword-filters-updated'

function emit(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FILTERS_UPDATED_EVENT))
  }
}

function fallbackId(): string {
  const partA = Date.now().toString(36)
  const partB = Math.random().toString(36).slice(2, 10)
  return `kf-${partA}-${partB}`
}

function generateFilterId(): string {
  const maybeCrypto = globalThis.crypto
  if (!maybeCrypto) return fallbackId()

  if (typeof maybeCrypto.randomUUID === 'function') {
    try {
      return maybeCrypto.randomUUID()
    } catch {
      // Fall through to alternate generation below.
    }
  }

  if (typeof maybeCrypto.getRandomValues === 'function' && typeof Uint8Array !== 'undefined') {
    try {
      const bytes = new Uint8Array(16)
      maybeCrypto.getRandomValues(bytes)
      bytes[6] = (bytes[6]! & 0x0f) | 0x40
      bytes[8] = (bytes[8]! & 0x3f) | 0x80
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    } catch {
      return fallbackId()
    }
  }

  return fallbackId()
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function loadFilters(): Promise<KeywordFilter[]> {
  try {
    const all = await entries<string, KeywordFilter>(STORE)
    return all
      .map(([, v]) => v)
      .filter(Boolean)
      .sort((a, b) => a.createdAt - b.createdAt)
  } catch {
    return []
  }
}

export async function getFilter(id: string): Promise<KeywordFilter | undefined> {
  try {
    return await get<KeywordFilter>(id, STORE)
  } catch {
    return undefined
  }
}

export async function createFilter(input: CreateFilterInput): Promise<KeywordFilter> {
  const filter: KeywordFilter = {
    ...input,
    id:        generateFilterId(),
    createdAt: Date.now(),
  }
  await set(filter.id, filter, STORE)
  emit()
  return filter
}

export async function updateFilter(
  id: string,
  patch: Partial<Omit<KeywordFilter, 'id' | 'createdAt'>>,
): Promise<KeywordFilter | null> {
  const existing = await get<KeywordFilter>(id, STORE)
  if (!existing) return null
  const updated = { ...existing, ...patch }
  await set(id, updated, STORE)
  emit()
  return updated
}

export async function deleteFilter(id: string): Promise<void> {
  await del(id, STORE)
  emit()
}

export async function clearAllFilters(): Promise<void> {
  const all = await loadFilters()
  await Promise.all(all.map(f => del(f.id, STORE)))
  emit()
}
