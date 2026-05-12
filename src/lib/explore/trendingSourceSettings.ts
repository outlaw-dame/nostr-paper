const TRENDING_SOURCE_SETTINGS_KEY = 'nostr-paper:explore:trending-source-settings'
export const TRENDING_SOURCE_SETTINGS_UPDATED_EVENT = 'nostr-paper:explore-trending-source-settings-updated'

export interface TrendingSourceSettings {
  enabled: boolean
  externalSignalWeight: number
  sourcePubkeys: string[]
  maxPerAuthor: number
  maxPerLinkDomain: number
}

const DEFAULT_SETTINGS: TrendingSourceSettings = {
  enabled: false,
  externalSignalWeight: 0.15,
  sourcePubkeys: [],
  maxPerAuthor: 2,
  maxPerLinkDomain: 2,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function normalizePubkeys(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const valid = value
    .map((entry) => typeof entry === 'string' ? entry.trim().toLowerCase() : '')
    .filter((entry) => /^[0-9a-f]{64}$/.test(entry))
  return [...new Set(valid)].slice(0, 256)
}

function normalizeSettings(raw: Partial<TrendingSourceSettings> | null | undefined): TrendingSourceSettings {
  const weight = typeof raw?.externalSignalWeight === 'number' && Number.isFinite(raw.externalSignalWeight)
    ? raw.externalSignalWeight
    : DEFAULT_SETTINGS.externalSignalWeight

  const maxPerAuthor = typeof raw?.maxPerAuthor === 'number' && Number.isFinite(raw.maxPerAuthor)
    ? raw.maxPerAuthor
    : DEFAULT_SETTINGS.maxPerAuthor

  const maxPerLinkDomain = typeof raw?.maxPerLinkDomain === 'number' && Number.isFinite(raw.maxPerLinkDomain)
    ? raw.maxPerLinkDomain
    : DEFAULT_SETTINGS.maxPerLinkDomain

  return {
    enabled: raw?.enabled === true,
    externalSignalWeight: clamp(weight, 0, 0.4),
    sourcePubkeys: normalizePubkeys(raw?.sourcePubkeys),
    maxPerAuthor: Math.max(1, Math.floor(maxPerAuthor)),
    maxPerLinkDomain: Math.max(1, Math.floor(maxPerLinkDomain)),
  }
}

export function getTrendingSourceSettings(): TrendingSourceSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS }

  try {
    const raw = window.localStorage.getItem(TRENDING_SOURCE_SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return normalizeSettings(JSON.parse(raw) as Partial<TrendingSourceSettings>)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function setTrendingSourceSettings(next: Partial<TrendingSourceSettings>): TrendingSourceSettings {
  const current = getTrendingSourceSettings()
  const merged = normalizeSettings({
    ...current,
    ...next,
    sourcePubkeys: next.sourcePubkeys ?? current.sourcePubkeys,
  })

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(TRENDING_SOURCE_SETTINGS_KEY, JSON.stringify(merged))
    window.dispatchEvent(new Event(TRENDING_SOURCE_SETTINGS_UPDATED_EVENT))
  }

  return merged
}
