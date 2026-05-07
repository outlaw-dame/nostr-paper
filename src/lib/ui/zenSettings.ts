const STORAGE_KEY_PREFIX = 'nostr-paper:zen:v1:'

export const ZEN_SETTINGS_UPDATED_EVENT = 'nostr-paper:zen-settings-updated'

interface ZenSettings {
  metricsVisible?: boolean
  repostCarouselVisible?: boolean
  feedInlineMediaAutoplayEnabled?: boolean
}

type NetworkInformationLike = {
  saveData?: boolean
  effectiveType?: string
}

export interface FeedInlineAutoplayPolicy {
  enabled: boolean
  source: 'user' | 'adaptive-default'
  reason: string | null
}

function getStorageKey(scopeId?: string | null): string {
  const scope = scopeId && scopeId.trim().length > 0 ? scopeId.trim() : 'anon'
  return `${STORAGE_KEY_PREFIX}${scope}`
}

function emitUpdated(scopeId?: string | null): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(ZEN_SETTINGS_UPDATED_EVENT, {
    detail: { scopeId: scopeId ?? 'anon' },
  }))
}

function readZenSettings(scopeId?: string | null): ZenSettings {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(getStorageKey(scopeId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as ZenSettings
  } catch {
    return {}
  }
}

function writeZenSettings(next: ZenSettings, scopeId?: string | null): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(getStorageKey(scopeId), JSON.stringify(next))
    emitUpdated(scopeId)
  } catch {
    // Best-effort persistence only.
  }
}

export function getMetricsVisible(scopeId?: string | null): boolean {
  const visible = readZenSettings(scopeId).metricsVisible
  return visible === false ? false : true
}

export function setMetricsVisible(visible: boolean, scopeId?: string | null): void {
  const previous = readZenSettings(scopeId)
  writeZenSettings({
    ...previous,
    metricsVisible: Boolean(visible),
  }, scopeId)
}

export function getRepostCarouselVisible(scopeId?: string | null): boolean {
  const visible = readZenSettings(scopeId).repostCarouselVisible
  return visible === false ? false : true
}

export function setRepostCarouselVisible(visible: boolean, scopeId?: string | null): void {
  const previous = readZenSettings(scopeId)
  writeZenSettings({
    ...previous,
    repostCarouselVisible: Boolean(visible),
  }, scopeId)
}

export function getFeedInlineMediaAutoplayEnabled(scopeId?: string | null): boolean {
  return getFeedInlineMediaAutoplayPolicy(scopeId).enabled
}

export function getFeedInlineMediaAutoplayPolicy(scopeId?: string | null): FeedInlineAutoplayPolicy {
  const enabled = readZenSettings(scopeId).feedInlineMediaAutoplayEnabled
  if (enabled === true || enabled === false) {
    return {
      enabled,
      source: 'user',
      reason: null,
    }
  }

  if (typeof window === 'undefined') {
    return {
      enabled: false,
      source: 'adaptive-default',
      reason: 'disabled-server-default',
    }
  }

  const navigatorWithConnection = window.navigator as Navigator & { connection?: NetworkInformationLike }
  const ua = window.navigator.userAgent ?? ''
  const isMobile = /iPhone|iPad|iPod|Android/i.test(ua)
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const saveData = navigatorWithConnection.connection?.saveData === true
  const effectiveType = navigatorWithConnection.connection?.effectiveType ?? ''
  const constrainedNetwork = effectiveType === 'slow-2g' || effectiveType === '2g'

  if (prefersReducedMotion) {
    return {
      enabled: false,
      source: 'adaptive-default',
      reason: 'disabled-reduced-motion',
    }
  }

  if (saveData || constrainedNetwork) {
    return {
      enabled: false,
      source: 'adaptive-default',
      reason: 'disabled-constrained-network',
    }
  }

  if (isMobile) {
    return {
      enabled: false,
      source: 'adaptive-default',
      reason: 'disabled-mobile-stability',
    }
  }

  return {
    enabled: true,
    source: 'adaptive-default',
    reason: 'enabled-desktop-default',
  }
}

export function setFeedInlineMediaAutoplayEnabled(enabled: boolean, scopeId?: string | null): void {
  const previous = readZenSettings(scopeId)
  writeZenSettings({
    ...previous,
    feedInlineMediaAutoplayEnabled: Boolean(enabled),
  }, scopeId)
}
