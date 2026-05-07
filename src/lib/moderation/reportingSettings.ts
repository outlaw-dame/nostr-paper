import { isValidRelayURL } from '@/lib/security/sanitize'

const STORAGE_KEY = 'nostr-paper:reporting-preferences:v1'

export const REPORTING_SETTINGS_UPDATED_EVENT = 'nostr-paper:reporting-settings-updated'

export type ReportPublishDestination = 'public' | 'private'

export interface ReportingSettings {
  destination: ReportPublishDestination
  privateRelayUrls: string[]
}

function resolveDefaultPrivateRelayUrls(): string[] {
  const fromEnv = import.meta.env.VITE_PRIVATE_REPORT_RELAY_URLS?.trim()
  const envValues = fromEnv
    ? fromEnv
      .split(',')
      .map((value: string) => value.trim())
      .filter((value: string) => value.length > 0)
    : []

  const singleEnv = import.meta.env.VITE_PRIVATE_REPORT_RELAY_URL?.trim()
  const combined = [...envValues, ...(singleEnv ? [singleEnv] : ['wss://relay.nos.social'])]
  const seen = new Set<string>()

  return combined.filter((value) => {
    const normalized = value.trim()
    if (!isValidRelayURL(normalized) || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

const DEFAULT_SETTINGS: ReportingSettings = {
  destination: 'public',
  privateRelayUrls: resolveDefaultPrivateRelayUrls(),
}

function emitUpdated(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(REPORTING_SETTINGS_UPDATED_EVENT))
}

function normalizeDestination(value: unknown): ReportPublishDestination {
  return value === 'private' ? 'private' : 'public'
}

function normalizeRelayUrls(values: unknown): string[] {
  if (!Array.isArray(values)) return [...DEFAULT_SETTINGS.privateRelayUrls]
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    if (typeof value !== 'string') continue
    const relayUrl = value.trim()
    if (!isValidRelayURL(relayUrl) || seen.has(relayUrl)) continue
    seen.add(relayUrl)
    normalized.push(relayUrl)
  }

  if (normalized.length === 0) return [...DEFAULT_SETTINGS.privateRelayUrls]
  return normalized.slice(0, 12)
}

function normalizeSettings(raw: unknown): ReportingSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      destination: DEFAULT_SETTINGS.destination,
      privateRelayUrls: [...DEFAULT_SETTINGS.privateRelayUrls],
    }
  }

  const parsed = raw as Partial<ReportingSettings>
  return {
    destination: normalizeDestination(parsed.destination),
    privateRelayUrls: normalizeRelayUrls(parsed.privateRelayUrls),
  }
}

export function getReportingSettings(): ReportingSettings {
  if (typeof window === 'undefined') {
    return {
      destination: DEFAULT_SETTINGS.destination,
      privateRelayUrls: [...DEFAULT_SETTINGS.privateRelayUrls],
    }
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {
        destination: DEFAULT_SETTINGS.destination,
        privateRelayUrls: [...DEFAULT_SETTINGS.privateRelayUrls],
      }
    }
    return normalizeSettings(JSON.parse(raw) as unknown)
  } catch {
    return {
      destination: DEFAULT_SETTINGS.destination,
      privateRelayUrls: [...DEFAULT_SETTINGS.privateRelayUrls],
    }
  }
}

export function setReportingSettings(next: Partial<ReportingSettings>): void {
  if (typeof window === 'undefined') return

  try {
    const current = getReportingSettings()
    const merged = normalizeSettings({ ...current, ...next })
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    emitUpdated()
  } catch {
    // Best-effort persistence only.
  }
}
