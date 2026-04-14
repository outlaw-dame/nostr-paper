/**
 * Relay Settings
 *
 * Persists the user's custom relay list to localStorage.
 * The stored list is keyed by device (not user-scoped) since relay
 * preferences are typically per-device. When a signer is available we publish
 * the effective relay set as kind:10002 so NIP-65/outbox clients can discover it.
 *
 * Storage keys: nostr-paper:relays:v2 (current), nostr-paper:relays:v1 (legacy)
 */

import { isValidRelayURL } from '@/lib/security/sanitize'

const STORAGE_KEY = 'nostr-paper:relays:v2'
const LEGACY_STORAGE_KEY = 'nostr-paper:relays:v1'

export const RELAY_SETTINGS_UPDATED_EVENT = 'nostr-paper:relay-settings-updated'

export interface RelayPreference {
  url: string
  read: boolean
  write: boolean
}

function normalizeRelayPreference(value: unknown): RelayPreference | null {
  if (typeof value === 'string') {
    return isValidRelayURL(value) ? { url: value, read: true, write: true } : null
  }

  if (!value || typeof value !== 'object') return null

  const record = value as {
    url?: unknown
    read?: unknown
    write?: unknown
  }

  if (typeof record.url !== 'string' || !isValidRelayURL(record.url)) {
    return null
  }

  const read = typeof record.read === 'boolean' ? record.read : true
  const write = typeof record.write === 'boolean' ? record.write : true
  if (!read && !write) return null

  return {
    url: record.url,
    read,
    write,
  }
}

export function normalizeRelayPreferences(values: readonly unknown[]): RelayPreference[] {
  const merged = new Map<string, RelayPreference>()

  for (const value of values) {
    const normalized = normalizeRelayPreference(value)
    if (!normalized) continue

    const existing = merged.get(normalized.url)
    if (existing) {
      existing.read = existing.read || normalized.read
      existing.write = existing.write || normalized.write
      continue
    }

    merged.set(normalized.url, { ...normalized })
  }

  return [...merged.values()]
}

function dispatchRelaySettingsUpdated(): void {
  window.dispatchEvent(new CustomEvent(RELAY_SETTINGS_UPDATED_EVENT))
}

function parseStoredRelayPreferences(raw: string | null): RelayPreference[] | null {
  if (!raw) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return normalizeRelayPreferences(parsed)
  } catch {
    return null
  }
}

export function getStoredRelayPreferences(): RelayPreference[] | null {
  const current = parseStoredRelayPreferences(localStorage.getItem(STORAGE_KEY))
  if (current) return current
  return parseStoredRelayPreferences(localStorage.getItem(LEGACY_STORAGE_KEY))
}

/**
 * Returns the user's stored read-capable relay URLs, or null if they have
 * never customized them. Null means "use defaults".
 */
export function getStoredRelayUrls(): string[] | null {
  const preferences = getStoredRelayPreferences()
  if (!preferences) return null
  return preferences.filter(preference => preference.read).map(preference => preference.url)
}

export function setStoredRelayPreferences(preferences: readonly RelayPreference[]): void {
  const normalized = normalizeRelayPreferences(preferences)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  localStorage.removeItem(LEGACY_STORAGE_KEY)
  dispatchRelaySettingsUpdated()
}

/**
 * Persists a legacy "all relays are read/write" list.
 */
export function setStoredRelayUrls(urls: string[]): void {
  setStoredRelayPreferences(urls.map(url => ({ url, read: true, write: true })))
}

/**
 * Clears the stored relay list, reverting to app defaults on next boot.
 */
export function clearStoredRelayUrls(): void {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(LEGACY_STORAGE_KEY)
  dispatchRelaySettingsUpdated()
}
