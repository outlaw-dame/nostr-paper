/**
 * Relay Settings
 *
 * Persists the user's custom relay list to localStorage.
 * The stored list is keyed by device (not user-scoped) since relay
 * preferences are typically per-device. NIP-65 publish support TBD.
 *
 * Storage key: nostr-paper:relays:v1
 */

import { isValidRelayURL } from '@/lib/security/sanitize'

const STORAGE_KEY = 'nostr-paper:relays:v1'

export const RELAY_SETTINGS_UPDATED_EVENT = 'nostr-paper:relay-settings-updated'

/**
 * Returns the user's stored relay URLs, or null if they have never customized them.
 * Null means "use defaults" — distinguishable from an empty array.
 */
export function getStoredRelayUrls(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.filter((u): u is string => typeof u === 'string' && isValidRelayURL(u))
  } catch {
    return null
  }
}

/**
 * Persists the relay URL list and dispatches an update event so live
 * listeners (e.g. RelaysPage) can react across same-tab updates.
 */
export function setStoredRelayUrls(urls: string[]): void {
  const valid = urls.filter(isValidRelayURL)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(valid))
  window.dispatchEvent(new CustomEvent(RELAY_SETTINGS_UPDATED_EVENT))
}

/**
 * Clears the stored relay list, reverting to app defaults on next boot.
 */
export function clearStoredRelayUrls(): void {
  localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new CustomEvent(RELAY_SETTINGS_UPDATED_EVENT))
}
