/**
 * Blossom URL validation utilities.
 *
 * Blossom servers must be reachable over HTTPS.
 * HTTP is intentionally rejected — blobs contain user content and
 * auth tokens, which must not travel over plaintext connections.
 */

/**
 * Returns true if the string is a valid https:// Blossom server URL.
 * Strips trailing slashes for normalisation checks.
 */
export function isValidBlossomUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Normalise a Blossom server URL — lowercase scheme+host, strip trailing slash.
 * Returns null if the URL is invalid.
 */
export function normaliseBlossomUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return null
    // Keep pathname if it's non-trivial (some servers are at a subpath)
    const path = parsed.pathname.replace(/\/+$/, '')
    return `https://${parsed.host}${path}`
  } catch {
    return null
  }
}
