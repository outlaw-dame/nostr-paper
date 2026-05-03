import {
  normalizeNewsDomain,
  resolveSourceLens,
  type SourceOrientation,
} from '@/lib/media/sourceOrientation'

const STORAGE_KEY = 'nostr-paper:source-exposure:v1'
const MAX_ENTRIES = 2_000
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const DEDUPE_WINDOW_MS = 5 * 60 * 1000

export const SOURCE_EXPOSURE_UPDATED_EVENT = 'nostr-paper:source-exposure-updated'

export interface SourceExposureEntry {
  ts: number
  domain: string
  orientation: SourceOrientation
  source: 'link-preview' | 'trending-link' | 'note-page' | 'unknown'
}

export interface SourceExposureSummary {
  total: number
  byOrientation: Record<SourceOrientation, number>
}

function emptySummary(): SourceExposureSummary {
  return {
    total: 0,
    byOrientation: {
      left: 0,
      'lean-left': 0,
      center: 0,
      'lean-right': 0,
      right: 0,
      unknown: 0,
    },
  }
}

function getStorage(): Storage | null {
  const globalCandidate = globalThis as unknown as { localStorage?: Storage }
  if (globalCandidate.localStorage) return globalCandidate.localStorage

  const browserCandidate = globalThis as unknown as { window?: { localStorage?: Storage } }
  return browserCandidate.window?.localStorage ?? null
}

function emitUpdatedEvent(): void {
  if (typeof CustomEvent === 'undefined') return
  const browserCandidate = globalThis as unknown as { window?: Window }
  const target = browserCandidate.window ?? globalThis
  if (typeof (target as EventTarget).dispatchEvent !== 'function') return
  ;(target as EventTarget).dispatchEvent(new CustomEvent(SOURCE_EXPOSURE_UPDATED_EVENT))
}

function loadAll(): SourceExposureEntry[] {
  const storage = getStorage()
  if (!storage) return []
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    const now = Date.now()
    const filtered: SourceExposureEntry[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const entry = item as Partial<SourceExposureEntry>
      if (typeof entry.ts !== 'number' || !Number.isFinite(entry.ts)) continue
      if (entry.ts < now - RETENTION_MS) continue
      if (typeof entry.domain !== 'string' || entry.domain.length === 0) continue
      if (typeof entry.orientation !== 'string') continue
      const source = typeof entry.source === 'string' ? entry.source : 'unknown'
      filtered.push({
        ts: entry.ts,
        domain: entry.domain,
        orientation: entry.orientation as SourceOrientation,
        source: source as SourceExposureEntry['source'],
      })
    }
    return filtered
  } catch {
    return []
  }
}

function persist(entries: SourceExposureEntry[]): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries))
    emitUpdatedEvent()
  } catch {
    // Ignore storage quota/privacy mode failures.
  }
}

export function recordSourceExposure(
  domainOrUrl: string,
  source: SourceExposureEntry['source'] = 'unknown',
): void {
  const domain = normalizeNewsDomain(domainOrUrl)
  if (!domain) return

  const orientation = resolveSourceLens(domain).orientation
  const now = Date.now()
  const entries = loadAll()

  const existingRecent = entries.find((entry) =>
    entry.domain === domain &&
    entry.source === source &&
    now - entry.ts <= DEDUPE_WINDOW_MS,
  )
  if (existingRecent) return

  entries.push({ ts: now, domain, orientation, source })

  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES)
  }

  persist(entries)
}

export function summarizeSourceExposure(days = 14): SourceExposureSummary {
  const summary = emptySummary()
  const cutoff = Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000

  for (const entry of loadAll()) {
    if (entry.ts < cutoff) continue
    summary.total += 1
    summary.byOrientation[entry.orientation] += 1
  }

  return summary
}
