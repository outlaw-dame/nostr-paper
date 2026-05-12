import { isValidRelayURL } from '@/lib/security/sanitize'

const STORAGE_KEY = 'nostr-paper:reporting-preferences:v1'
const DEFAULT_TAGR_BOT_PUBKEY_HEX = '56d4b3d6310fadb7294b7f041aab469c5ffc8991b1b1b331981b96a246f6ae65'

export const REPORTING_SETTINGS_UPDATED_EVENT = 'nostr-paper:reporting-settings-updated'

export type ReportPublishDestination = 'public' | 'private' | 'moderator'

export interface ReportingSettings {
  destination: ReportPublishDestination
  privateRelayUrls: string[]
  moderatorRelayUrls: string[]
  moderatorPubkey: string
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

function resolveDefaultModeratorRelayUrls(): string[] {
  const fromEnv = import.meta.env.VITE_TAGR_RELAY_URLS?.trim()
  const envValues = fromEnv
    ? fromEnv
      .split(',')
      .map((value: string) => value.trim())
      .filter((value: string) => value.length > 0)
    : []

  const singleEnv = import.meta.env.VITE_TAGR_RELAY_URL?.trim()
  const combined = [...envValues, ...(singleEnv ? [singleEnv] : ['wss://relay.nos.social'])]
  const seen = new Set<string>()

  return combined.filter((value) => {
    const normalized = value.trim()
    if (!isValidRelayURL(normalized) || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

function resolveDefaultModeratorPubkey(): string {
  const fromEnv = import.meta.env.VITE_TAGR_BOT_PUBKEY?.trim().toLowerCase()
  return fromEnv && /^[0-9a-f]{64}$/.test(fromEnv) ? fromEnv : DEFAULT_TAGR_BOT_PUBKEY_HEX
}

const DEFAULT_SETTINGS: ReportingSettings = {
  destination: 'public',
  privateRelayUrls: resolveDefaultPrivateRelayUrls(),
  moderatorRelayUrls: resolveDefaultModeratorRelayUrls(),
  moderatorPubkey: resolveDefaultModeratorPubkey(),
}

function emitUpdated(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(REPORTING_SETTINGS_UPDATED_EVENT))
}

function normalizeDestination(value: unknown): ReportPublishDestination {
  if (value === 'private' || value === 'moderator') return value
  return 'public'
}

function normalizeRelayUrls(values: unknown, fallback: string[]): string[] {
  if (!Array.isArray(values)) return [...fallback]
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    if (typeof value !== 'string') continue
    const relayUrl = value.trim()
    if (!isValidRelayURL(relayUrl) || seen.has(relayUrl)) continue
    seen.add(relayUrl)
    normalized.push(relayUrl)
  }

  if (normalized.length === 0) return [...fallback]
  return normalized.slice(0, 12)
}

function normalizeModeratorPubkey(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SETTINGS.moderatorPubkey
  const normalized = value.trim().toLowerCase()
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : DEFAULT_SETTINGS.moderatorPubkey
}

function normalizeSettings(raw: unknown): ReportingSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      destination: DEFAULT_SETTINGS.destination,
      privateRelayUrls: [...DEFAULT_SETTINGS.privateRelayUrls],
      moderatorRelayUrls: [...DEFAULT_SETTINGS.moderatorRelayUrls],
      moderatorPubkey: DEFAULT_SETTINGS.moderatorPubkey,
    }
  }

  const parsed = raw as Partial<ReportingSettings>
  return {
    destination: normalizeDestination(parsed.destination),
    privateRelayUrls: normalizeRelayUrls(parsed.privateRelayUrls, DEFAULT_SETTINGS.privateRelayUrls),
    moderatorRelayUrls: normalizeRelayUrls(parsed.moderatorRelayUrls, DEFAULT_SETTINGS.moderatorRelayUrls),
    moderatorPubkey: normalizeModeratorPubkey(parsed.moderatorPubkey),
  }
}

export function getReportingSettings(): ReportingSettings {
  if (typeof window === 'undefined') {
    return {
      destination: DEFAULT_SETTINGS.destination,
      privateRelayUrls: [...DEFAULT_SETTINGS.privateRelayUrls],
      moderatorRelayUrls: [...DEFAULT_SETTINGS.moderatorRelayUrls],
      moderatorPubkey: DEFAULT_SETTINGS.moderatorPubkey,
    }
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {
        destination: DEFAULT_SETTINGS.destination,
        privateRelayUrls: [...DEFAULT_SETTINGS.privateRelayUrls],
        moderatorRelayUrls: [...DEFAULT_SETTINGS.moderatorRelayUrls],
        moderatorPubkey: DEFAULT_SETTINGS.moderatorPubkey,
      }
    }
    return normalizeSettings(JSON.parse(raw) as unknown)
  } catch {
    return {
      destination: DEFAULT_SETTINGS.destination,
      privateRelayUrls: [...DEFAULT_SETTINGS.privateRelayUrls],
      moderatorRelayUrls: [...DEFAULT_SETTINGS.moderatorRelayUrls],
      moderatorPubkey: DEFAULT_SETTINGS.moderatorPubkey,
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
