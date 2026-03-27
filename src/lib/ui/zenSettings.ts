const STORAGE_KEY_PREFIX = 'nostr-paper:zen:v1:'

export const ZEN_SETTINGS_UPDATED_EVENT = 'nostr-paper:zen-settings-updated'

interface ZenSettings {
  metricsVisible?: boolean
  repostCarouselVisible?: boolean
  feedInlineMediaAutoplayEnabled?: boolean
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
  const enabled = readZenSettings(scopeId).feedInlineMediaAutoplayEnabled
  return enabled === false ? false : true
}

export function setFeedInlineMediaAutoplayEnabled(enabled: boolean, scopeId?: string | null): void {
  const previous = readZenSettings(scopeId)
  writeZenSettings({
    ...previous,
    feedInlineMediaAutoplayEnabled: Boolean(enabled),
  }, scopeId)
}
