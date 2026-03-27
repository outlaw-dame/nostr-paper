import {
  describeTagTimeline,
  getTagTimelineKey,
  normalizeTagTimelineTags,
  type TagTimelineMode,
  type TagTimelineSpec,
} from '@/lib/feed/tagTimeline'
import { normalizeHashtag } from '@/lib/security/sanitize'

const STORAGE_KEY_PREFIX = 'nostr-paper:tag-feeds:v1:'
const GLOBAL_TAG_FEED_SCOPE = 'global'

export const TAG_FEEDS_UPDATED_EVENT = 'nostr-paper:tag-feeds-updated'

export interface SavedTagFeed extends TagTimelineSpec {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface SavedTagFeedInput extends TagTimelineSpec {
  id?: string | undefined
  title: string
}

export function getTagFeedsScopeId(_scopeId?: string | null): string {
  return GLOBAL_TAG_FEED_SCOPE
}

function getScopedStorageKey(scopeId: string): string {
  return `${STORAGE_KEY_PREFIX}${scopeId}`
}

export function getTagFeedsStorageKey(scopeId?: string | null): string {
  return getScopedStorageKey(getTagFeedsScopeId(scopeId))
}

function emitUpdated(scopeId?: string | null): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(TAG_FEEDS_UPDATED_EVENT, {
    detail: { scopeId: getTagFeedsScopeId(scopeId) },
  }))
}

function fallbackId(): string {
  return `tag-feed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function generateTagFeedId(): string {
  const maybeCrypto = globalThis.crypto
  if (!maybeCrypto) return fallbackId()

  if (typeof maybeCrypto.randomUUID === 'function') {
    try {
      return maybeCrypto.randomUUID()
    } catch {
      return fallbackId()
    }
  }

  return fallbackId()
}

function sanitizeTagList(values: string[]): string[] {
  return [...new Set(
    values
      .map((value) => normalizeHashtag(value))
      .filter((value): value is string => value !== null),
  )]
}

function sanitizeTagFeedInput(input: SavedTagFeedInput): SavedTagFeedInput | null {
  const includeTags = sanitizeTagList(input.includeTags)
  if (includeTags.length === 0) return null

  const excludeTags = sanitizeTagList(input.excludeTags).filter(
    (tag) => !includeTags.includes(tag),
  )
  const mode: TagTimelineMode = includeTags.length > 1 && input.mode === 'all' ? 'all' : 'any'
  const spec = { includeTags, excludeTags, mode }
  const fallbackTitle = describeTagTimeline(spec)?.title ?? `#${includeTags[0]}`
  const title = input.title.trim() || fallbackTitle

  return {
    id: input.id,
    title,
    includeTags,
    excludeTags,
    mode,
  }
}

function sanitizeSavedTagFeedRecord(value: unknown): SavedTagFeed | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const candidate = value as Partial<SavedTagFeed>
  const includeTags = Array.isArray(candidate.includeTags)
    ? normalizeTagTimelineTags(candidate.includeTags.join(','))
    : []
  const excludeTags = Array.isArray(candidate.excludeTags)
    ? normalizeTagTimelineTags(candidate.excludeTags.join(','))
    : []
  const mode: TagTimelineMode = candidate.mode === 'all' ? 'all' : 'any'

  const sanitized = sanitizeTagFeedInput({
    id: typeof candidate.id === 'string' ? candidate.id : undefined,
    title: typeof candidate.title === 'string' ? candidate.title : '',
    includeTags,
    excludeTags,
    mode,
  })
  if (!sanitized) return null

  const now = Date.now()

  return {
    id: sanitized.id ?? generateTagFeedId(),
    title: sanitized.title,
    includeTags: sanitized.includeTags,
    excludeTags: sanitized.excludeTags,
    mode: sanitized.mode,
    createdAt: Number.isFinite(candidate.createdAt) ? Number(candidate.createdAt) : now,
    updatedAt: Number.isFinite(candidate.updatedAt) ? Number(candidate.updatedAt) : now,
  }
}

function readSavedTagFeedsFromStorageKey(storageKey: string): SavedTagFeed[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return []

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed
      .map((entry) => sanitizeSavedTagFeedRecord(entry))
      .filter((entry): entry is SavedTagFeed => entry !== null)
  } catch {
    return []
  }
}

function listLegacyTagFeedStorageKeys(targetKey: string): string[] {
  if (typeof window === 'undefined') return []

  const keys: string[] = []
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (!key || !key.startsWith(STORAGE_KEY_PREFIX)) continue
    if (key === targetKey) continue
    keys.push(key)
  }

  return [...new Set(keys)]
}

function pickPreferredSavedTagFeed(current: SavedTagFeed, candidate: SavedTagFeed): SavedTagFeed {
  const candidateIsNewer = candidate.updatedAt > current.updatedAt
    || (candidate.updatedAt === current.updatedAt && candidate.createdAt > current.createdAt)
    || (candidate.updatedAt === current.updatedAt && candidate.createdAt === current.createdAt && candidate.id > current.id)
  const preferred = candidateIsNewer ? candidate : current
  const fallback = candidateIsNewer ? current : candidate

  return {
    ...preferred,
    createdAt: Math.min(current.createdAt, candidate.createdAt),
    updatedAt: Math.max(current.updatedAt, candidate.updatedAt),
    title: preferred.title || fallback.title,
  }
}

function mergeSavedTagFeeds(feeds: SavedTagFeed[]): SavedTagFeed[] {
  const byId = new Map<string, SavedTagFeed>()

  for (const feed of feeds) {
    const existing = byId.get(feed.id)
    byId.set(feed.id, existing ? pickPreferredSavedTagFeed(existing, feed) : feed)
  }

  const byTimeline = new Map<string, SavedTagFeed>()
  for (const feed of byId.values()) {
    const timelineKey = getTagTimelineKey(feed)
    const existing = byTimeline.get(timelineKey)
    byTimeline.set(timelineKey, existing ? pickPreferredSavedTagFeed(existing, feed) : feed)
  }

  return [...byTimeline.values()].sort((left, right) => {
    if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt
    return left.id.localeCompare(right.id)
  })
}

function migrateLegacyTagFeeds(scopeId?: string | null): SavedTagFeed[] {
  if (typeof window === 'undefined') return []

  const targetKey = getTagFeedsStorageKey(scopeId)
  const currentGlobalFeeds = readSavedTagFeedsFromStorageKey(targetKey)
  const legacyKeys = listLegacyTagFeedStorageKeys(targetKey)
  const legacyFeeds = legacyKeys.flatMap((storageKey) => readSavedTagFeedsFromStorageKey(storageKey))
  if (legacyFeeds.length === 0) {
    return mergeSavedTagFeeds(currentGlobalFeeds)
  }

  const mergedFeeds = mergeSavedTagFeeds([...currentGlobalFeeds, ...legacyFeeds])

  try {
    window.localStorage.setItem(targetKey, JSON.stringify(mergedFeeds))
    for (const storageKey of legacyKeys) {
      if (readSavedTagFeedsFromStorageKey(storageKey).length === 0) continue
      window.localStorage.removeItem(storageKey)
    }
  } catch {
    return mergedFeeds
  }

  return mergedFeeds
}

function writeSavedTagFeeds(feeds: SavedTagFeed[], scopeId?: string | null): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(getTagFeedsStorageKey(scopeId), JSON.stringify(mergeSavedTagFeeds(feeds)))
    emitUpdated(scopeId)
  } catch {
    // Best-effort persistence only.
  }
}

export function getSavedTagFeeds(scopeId?: string | null): SavedTagFeed[] {
  return migrateLegacyTagFeeds(scopeId)
}

export function saveTagFeed(input: SavedTagFeedInput, scopeId?: string | null): SavedTagFeed | null {
  const sanitized = sanitizeTagFeedInput(input)
  if (!sanitized) return null

  const existingFeeds = getSavedTagFeeds(scopeId)
  const now = Date.now()
  const existing = sanitized.id
    ? existingFeeds.find((feed) => feed.id === sanitized.id) ?? null
    : null

  const nextFeed: SavedTagFeed = {
    id: existing?.id ?? sanitized.id ?? generateTagFeedId(),
    title: sanitized.title,
    includeTags: sanitized.includeTags,
    excludeTags: sanitized.excludeTags,
    mode: sanitized.mode,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }

  const nextFeeds = existing
    ? existingFeeds.map((feed) => (feed.id === existing.id ? nextFeed : feed))
    : [...existingFeeds, nextFeed]

  writeSavedTagFeeds(nextFeeds, scopeId)
  return nextFeed
}

export function deleteTagFeed(id: string, scopeId?: string | null): void {
  const nextFeeds = getSavedTagFeeds(scopeId).filter((feed) => feed.id !== id)
  writeSavedTagFeeds(nextFeeds, scopeId)
}
