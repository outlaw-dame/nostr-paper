export const DISCOVERY_CONTROLS_UPDATED_EVENT = 'nostr-paper:discovery-controls-updated'

const STORAGE_KEY = 'nostr-paper:discovery-controls:v1'

export interface TrendingTopicWeights {
  popularity: number
  diversity: number
  freshness: number
  momentum: number
}

export interface SuggestedAccountWeights {
  social: number
  semantic: number
  keyword: number
  hashtag: number
  bio: number
  language: number
}

export interface FollowPackWeights {
  semanticBoost: number
}

export interface DiscoveryControls {
  trending: TrendingTopicWeights
  suggested: SuggestedAccountWeights
  followPacks: FollowPackWeights
}

export const DEFAULT_DISCOVERY_CONTROLS: DiscoveryControls = {
  trending: {
    popularity: 0.38,
    diversity: 0.26,
    freshness: 0.20,
    momentum: 0.16,
  },
  suggested: {
    social: 0.58,
    semantic: 0.42,
    keyword: 0.34,
    hashtag: 0.26,
    bio: 0.22,
    language: 0.18,
  },
  followPacks: {
    semanticBoost: 2.1,
  },
}

function coerceNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeRatioWeights<T extends Record<string, number>>(weights: T, fallback: T): T {
  const values = Object.entries(weights).map(([key, value]) => [key, Math.max(value, 0)] as const)
  const sum = values.reduce((acc, [, value]) => acc + value, 0)

  if (sum <= 0) return { ...fallback }

  const normalized = Object.fromEntries(
    values.map(([key, value]) => [key, value / sum]),
  )

  return normalized as T
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function normalizeControls(partial?: Partial<DiscoveryControls> | null): DiscoveryControls {
  const trending = normalizeRatioWeights(
    {
      popularity: coerceNumber(partial?.trending?.popularity, DEFAULT_DISCOVERY_CONTROLS.trending.popularity),
      diversity: coerceNumber(partial?.trending?.diversity, DEFAULT_DISCOVERY_CONTROLS.trending.diversity),
      freshness: coerceNumber(partial?.trending?.freshness, DEFAULT_DISCOVERY_CONTROLS.trending.freshness),
      momentum: coerceNumber(partial?.trending?.momentum, DEFAULT_DISCOVERY_CONTROLS.trending.momentum),
    },
    DEFAULT_DISCOVERY_CONTROLS.trending,
  )

  const suggested = normalizeRatioWeights(
    {
      social: coerceNumber(partial?.suggested?.social, DEFAULT_DISCOVERY_CONTROLS.suggested.social),
      semantic: coerceNumber(partial?.suggested?.semantic, DEFAULT_DISCOVERY_CONTROLS.suggested.semantic),
      keyword: coerceNumber(partial?.suggested?.keyword, DEFAULT_DISCOVERY_CONTROLS.suggested.keyword),
      hashtag: coerceNumber(partial?.suggested?.hashtag, DEFAULT_DISCOVERY_CONTROLS.suggested.hashtag),
      bio: coerceNumber(partial?.suggested?.bio, DEFAULT_DISCOVERY_CONTROLS.suggested.bio),
      language: coerceNumber(partial?.suggested?.language, DEFAULT_DISCOVERY_CONTROLS.suggested.language),
    },
    DEFAULT_DISCOVERY_CONTROLS.suggested,
  )

  const semanticBoost = clamp(
    coerceNumber(partial?.followPacks?.semanticBoost, DEFAULT_DISCOVERY_CONTROLS.followPacks.semanticBoost),
    0,
    6,
  )

  return {
    trending,
    suggested,
    followPacks: { semanticBoost },
  }
}

export function loadDiscoveryControls(): DiscoveryControls {
  if (typeof window === 'undefined') return { ...DEFAULT_DISCOVERY_CONTROLS }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_DISCOVERY_CONTROLS }

    const parsed = JSON.parse(raw) as Partial<DiscoveryControls>
    return normalizeControls(parsed)
  } catch {
    return { ...DEFAULT_DISCOVERY_CONTROLS }
  }
}

export function saveDiscoveryControls(next: Partial<DiscoveryControls>): DiscoveryControls {
  const current = loadDiscoveryControls()
  const merged = normalizeControls({
    ...current,
    ...next,
    trending: { ...current.trending, ...next.trending },
    suggested: { ...current.suggested, ...next.suggested },
    followPacks: { ...current.followPacks, ...next.followPacks },
  })

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    window.dispatchEvent(new Event(DISCOVERY_CONTROLS_UPDATED_EVENT))
  }

  return merged
}

export function resetDiscoveryControls(): DiscoveryControls {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(STORAGE_KEY)
    window.dispatchEvent(new Event(DISCOVERY_CONTROLS_UPDATED_EVENT))
  }
  return { ...DEFAULT_DISCOVERY_CONTROLS }
}