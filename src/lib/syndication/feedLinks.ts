import { isSafeURL, sanitizeName } from '@/lib/security/sanitize'

const STORAGE_KEY_PREFIX = 'nostr-paper:syndication-feed-links:v1:'

export const SYNDICATION_FEED_LINKS_UPDATED_EVENT = 'nostr-paper:syndication-feed-links-updated'

export type SavedSyndicationFeedKind = 'auto' | 'rss' | 'atom' | 'rdf' | 'json' | 'podcast'
export type SavedSyndicationSourceType = 'feed' | 'link'
export type SavedSyndicationLinkKind = 'website' | 'newsletter' | 'video' | 'social' | 'podcast-home' | 'other'

const DEFAULT_SOURCE_TYPE: SavedSyndicationSourceType = 'feed'
const DEFAULT_FEED_KIND: SavedSyndicationFeedKind = 'auto'
const DEFAULT_LINK_KIND: SavedSyndicationLinkKind = 'other'

export interface SavedSyndicationFeedLink {
  id: string
  url: string
  sourceType: SavedSyndicationSourceType
  kind: SavedSyndicationFeedKind
  linkKind: SavedSyndicationLinkKind
  label: string
  createdAt: number
  updatedAt: number
}

export interface SavedSyndicationFeedLinkInput {
  id?: string
  url: string
  sourceType?: SavedSyndicationSourceType
  kind?: SavedSyndicationFeedKind
  linkKind?: SavedSyndicationLinkKind
  label?: string
}

function getStorageKey(scopeId?: string | null): string {
  const scope = scopeId && scopeId.trim().length > 0 ? scopeId.trim() : 'anon'
  return `${STORAGE_KEY_PREFIX}${scope}`
}

function emitUpdated(scopeId?: string | null): void {
  if (typeof window === 'undefined') return

  window.dispatchEvent(new CustomEvent(SYNDICATION_FEED_LINKS_UPDATED_EVENT, {
    detail: { scopeId: scopeId ?? 'anon' },
  }))
}

function fallbackId(): string {
  return `feed-link-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function generateId(): string {
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

function parseFeedKind(value: unknown): SavedSyndicationFeedKind {
  if (value === 'rss' || value === 'atom' || value === 'rdf' || value === 'json' || value === 'podcast') {
    return value
  }

  return DEFAULT_FEED_KIND
}

function parseSourceType(value: unknown): SavedSyndicationSourceType {
  if (value === 'feed' || value === 'link') return value
  return DEFAULT_SOURCE_TYPE
}

function parseLinkKind(value: unknown): SavedSyndicationLinkKind {
  if (value === 'website' || value === 'newsletter' || value === 'video' || value === 'social' || value === 'podcast-home') {
    return value
  }

  return DEFAULT_LINK_KIND
}

function normalizeInput(input: SavedSyndicationFeedLinkInput): SavedSyndicationFeedLink | null {
  const trimmedUrl = input.url.trim()
  if (!trimmedUrl || !isSafeURL(trimmedUrl)) return null

  const now = Date.now()
  const parsedLabel = sanitizeName(input.label ?? '')
  const parsedUrl = new URL(trimmedUrl)
  const fallbackLabel = parsedUrl.hostname

  const sourceType = parseSourceType(input.sourceType)

  return {
    id: input.id?.trim() || generateId(),
    url: parsedUrl.toString(),
    sourceType,
    kind: sourceType === 'feed' ? parseFeedKind(input.kind) : DEFAULT_FEED_KIND,
    linkKind: sourceType === 'link' ? parseLinkKind(input.linkKind) : DEFAULT_LINK_KIND,
    label: parsedLabel || fallbackLabel,
    createdAt: now,
    updatedAt: now,
  }
}

function sanitizeRecord(value: unknown): SavedSyndicationFeedLink | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const candidate = value as Partial<SavedSyndicationFeedLink>
  const normalized = normalizeInput({
    ...(typeof candidate.id === 'string' ? { id: candidate.id } : {}),
    ...(typeof candidate.sourceType === 'string' ? { sourceType: candidate.sourceType } : {}),
    ...(typeof candidate.kind === 'string' ? { kind: candidate.kind } : {}),
    ...(typeof candidate.linkKind === 'string' ? { linkKind: candidate.linkKind } : {}),
    url: typeof candidate.url === 'string' ? candidate.url : '',
    label: typeof candidate.label === 'string' ? candidate.label : '',
  })
  if (!normalized) return null

  const createdAt = Number.isFinite(candidate.createdAt) ? Number(candidate.createdAt) : normalized.createdAt
  const updatedAt = Number.isFinite(candidate.updatedAt) ? Number(candidate.updatedAt) : normalized.updatedAt

  return {
    ...normalized,
    createdAt,
    updatedAt,
  }
}

function readAll(scopeId?: string | null): SavedSyndicationFeedLink[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(getStorageKey(scopeId))
    if (!raw) return []

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    const deduped = new Map<string, SavedSyndicationFeedLink>()
    for (const entry of parsed) {
      const sanitized = sanitizeRecord(entry)
      if (!sanitized) continue
      const existing = deduped.get(sanitized.id)
      if (!existing || existing.updatedAt < sanitized.updatedAt) {
        deduped.set(sanitized.id, sanitized)
      }
    }

    return [...deduped.values()].sort((left, right) => {
      if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt
      return left.id.localeCompare(right.id)
    })
  } catch {
    return []
  }
}

function writeAll(values: SavedSyndicationFeedLink[], scopeId?: string | null): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(getStorageKey(scopeId), JSON.stringify(values))
    emitUpdated(scopeId)
  } catch {
    // Best-effort only.
  }
}

export function listSavedSyndicationFeedLinks(scopeId?: string | null): SavedSyndicationFeedLink[] {
  return readAll(scopeId)
}

export function saveSyndicationFeedLink(
  input: SavedSyndicationFeedLinkInput,
  scopeId?: string | null,
): SavedSyndicationFeedLink | null {
  const normalized = normalizeInput(input)
  if (!normalized) return null

  const previous = readAll(scopeId)
  const now = Date.now()
  const next = [...previous]
  const existingIndex = next.findIndex((entry) => entry.id === normalized.id)

  if (existingIndex >= 0) {
    const existing = next[existingIndex]
    if (!existing) return null
    next[existingIndex] = {
      ...normalized,
      createdAt: existing.createdAt,
      updatedAt: now,
    }
  } else {
    next.unshift(normalized)
  }

  writeAll(next, scopeId)

  if (existingIndex >= 0) {
    return next[existingIndex] ?? null
  }

  return normalized
}

export function removeSyndicationFeedLink(id: string, scopeId?: string | null): void {
  const targetId = id.trim()
  if (!targetId) return

  const previous = readAll(scopeId)
  const next = previous.filter((entry) => entry.id !== targetId)
  if (next.length === previous.length) return

  writeAll(next, scopeId)
}
