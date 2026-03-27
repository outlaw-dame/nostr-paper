import { queryEvents } from '@/lib/db/nostr'
import { parseTextNoteReply } from '@/lib/nostr/thread'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

const ROOT_CACHE_TTL_MS = 60_000
const MAX_ROOT_CACHE_ENTRIES = 300
const MAX_PREFETCH_ROOTS = 8

export interface SelfThreadIndex {
  index: number
  total: number
  rootEventId: string
}

interface RootCacheEntry {
  expiresAt: number
  byEventId: Map<string, SelfThreadIndex>
}

const rootCache = new Map<string, RootCacheEntry>()
const inflightLoads = new Map<string, Promise<Map<string, SelfThreadIndex>>>()

function sortChronologically(events: NostrEvent[]): NostrEvent[] {
  return [...events].sort((a, b) => (
    a.created_at - b.created_at || a.id.localeCompare(b.id)
  ))
}

function getRootEventId(event: NostrEvent): string | null {
  if (event.kind !== Kind.ShortNote) return null
  const reply = parseTextNoteReply(event)
  return reply?.rootEventId ?? event.id
}

function getFreshCacheEntry(rootEventId: string): RootCacheEntry | null {
  const cached = rootCache.get(rootEventId)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    rootCache.delete(rootEventId)
    return null
  }

  rootCache.delete(rootEventId)
  rootCache.set(rootEventId, cached)
  return cached
}

function saveCacheEntry(rootEventId: string, byEventId: Map<string, SelfThreadIndex>) {
  rootCache.delete(rootEventId)
  rootCache.set(rootEventId, {
    expiresAt: Date.now() + ROOT_CACHE_TTL_MS,
    byEventId,
  })

  while (rootCache.size > MAX_ROOT_CACHE_ENTRIES) {
    const oldestKey = rootCache.keys().next().value
    if (!oldestKey) break
    rootCache.delete(oldestKey)
  }
}

function buildSelfThreadIndexMap(rootEvent: NostrEvent, candidates: NostrEvent[]): Map<string, SelfThreadIndex> {
  if (rootEvent.kind !== Kind.ShortNote) {
    return new Map()
  }

  const dedupedById = new Map<string, NostrEvent>()
  dedupedById.set(rootEvent.id, rootEvent)

  for (const candidate of candidates) {
    if (candidate.kind !== Kind.ShortNote) continue
    if (candidate.pubkey !== rootEvent.pubkey) continue
    const reply = parseTextNoteReply(candidate)
    if (!reply || reply.rootEventId !== rootEvent.id) continue
    dedupedById.set(candidate.id, candidate)
  }

  const sequence = sortChronologically([...dedupedById.values()])
  if (sequence.length < 2) {
    return new Map()
  }

  const indexed = new Map<string, SelfThreadIndex>()
  for (let i = 0; i < sequence.length; i += 1) {
    const event = sequence[i]!
    indexed.set(event.id, {
      index: i + 1,
      total: sequence.length,
      rootEventId: rootEvent.id,
    })
  }

  return indexed
}

async function loadRootIndex(rootEventId: string): Promise<Map<string, SelfThreadIndex>> {
  const [rootEvent] = await queryEvents({ ids: [rootEventId], kinds: [Kind.ShortNote], limit: 1 })
  if (!rootEvent) {
    return new Map()
  }

  const related = await queryEvents({
    kinds: [Kind.ShortNote],
    authors: [rootEvent.pubkey],
    '#e': [rootEvent.id],
    limit: 500,
  })

  const indexMap = buildSelfThreadIndexMap(rootEvent, related)
  saveCacheEntry(rootEventId, indexMap)
  return indexMap
}

async function getOrLoadRootIndex(rootEventId: string): Promise<Map<string, SelfThreadIndex>> {
  const cached = getFreshCacheEntry(rootEventId)
  if (cached) {
    return cached.byEventId
  }

  const existingInflight = inflightLoads.get(rootEventId)
  if (existingInflight) {
    return existingInflight
  }

  const loader = loadRootIndex(rootEventId)
    .catch(() => {
      const empty = new Map<string, SelfThreadIndex>()
      saveCacheEntry(rootEventId, empty)
      return empty
    })
    .finally(() => {
      inflightLoads.delete(rootEventId)
    })

  inflightLoads.set(rootEventId, loader)
  return loader
}

export async function getSelfThreadIndex(event: NostrEvent): Promise<SelfThreadIndex | null> {
  const rootEventId = getRootEventId(event)
  if (!rootEventId) return null

  const indexMap = await getOrLoadRootIndex(rootEventId)
  return indexMap.get(event.id) ?? null
}

export function warmSelfThreadIndexCache(events: NostrEvent[]) {
  const uniqueRoots = new Set<string>()

  for (const event of events) {
    const rootEventId = getRootEventId(event)
    if (!rootEventId) continue
    uniqueRoots.add(rootEventId)
    if (uniqueRoots.size >= MAX_PREFETCH_ROOTS) break
  }

  for (const rootEventId of uniqueRoots) {
    void getOrLoadRootIndex(rootEventId)
  }
}
