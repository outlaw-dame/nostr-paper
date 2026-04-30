/**
 * URL normalization utilities for link-mention indexing.
 *
 * Canonical form groups discussions of the same article together regardless
 * of tracking parameters, fragments, or minor URL variations.
 *
 * Safe to call from both the main thread and the DB worker context —
 * no DOM or browser-API dependencies beyond `URL`.
 */

const MAX_URL_LENGTH = 2_048

/**
 * Query parameters that carry no content meaning — only tracking identity.
 * Removing them lets different sharers of the same article be grouped.
 */
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'msclkid', 'twclid', 'yclid', 'dclid',
  'mc_cid', 'mc_eid', '_hsenc', '_hsmi', '_ga', '_gl',
  'igshid', 's_cid', 'tracking_id',
])

/**
 * File extensions that are direct media or binary assets rather than
 * human-readable articles or pages.  URLs ending in these are skipped
 * so the news feed isn't polluted with image and video links.
 */
const MEDIA_EXTENSIONS = new Set([
  // Images
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'apng', 'bmp', 'ico',
  'jfif', 'svg', 'tif', 'tiff', 'heic', 'heif', 'jxl',
  // Video / audio
  'mp4', 'webm', 'mov', 'm4v', 'ogv',
  'mp3', 'ogg', 'oga', 'flac', 'wav', 'aac', 'm4a', 'opus',
  // Archives / executables
  'pdf', 'zip', 'gz', 'tar', 'rar', '7z', 'exe', 'dmg', 'apk', 'ipa',
])

/** Hostnames that must never be indexed (local / private-network addresses). */
const PRIVATE_HOST = /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i

// ── Public API ───────────────────────────────────────────────

/**
 * Normalize a URL for consistent grouping of the same article across
 * different sharers.  Returns `null` if the URL is invalid or unsupported.
 *
 * Steps applied (in order):
 *   1. Parse and validate — http / https only
 *   2. Upgrade http → https
 *   3. Lowercase host
 *   4. Strip credentials (username / password)
 *   5. Remove fragment (#hash)
 *   6. Delete known tracking query parameters
 *   7. Sort remaining parameters for stability
 *   8. Remove trailing slash on root path only
 */
export function normalizeLinkUrl(raw: string): string | null {
  if (typeof raw !== 'string') return null
  if (raw.length > MAX_URL_LENGTH) return null

  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return null
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null

  parsed.protocol = 'https:'
  parsed.host     = parsed.host.toLowerCase()
  parsed.username = ''
  parsed.password = ''
  parsed.hash     = ''

  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      parsed.searchParams.delete(key)
    }
  }
  parsed.searchParams.sort()

  let href = parsed.href
  // Remove the trailing slash only when the path is exactly "/" (root).
  // Preserving slashes on real paths (e.g. /section/) avoids false collisions.
  if (parsed.pathname === '/' && href.endsWith('/')) {
    href = href.slice(0, -1)
  }

  return href
}

/**
 * Extract the display-friendly domain from a URL.
 * Strips the `www.` prefix.  Returns an empty string on parse failure.
 */
export function extractLinkDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Decide whether a (already normalized) URL should be indexed for
 * trending-link discovery.
 *
 * Excluded:
 *   - Private / loopback hostnames
 *   - Single-label hosts (no dot — likely a local dev alias)
 *   - Root-only paths (`/`) — site homepages add noise without article context
 *   - Known media / binary file extensions
 */
export function isLinkIndexable(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (PRIVATE_HOST.test(parsed.hostname)) return false
  if (!parsed.hostname.includes('.'))     return false
  if (parsed.pathname === '/' || parsed.pathname === '') return false

  const ext = parsed.pathname.split('.').pop()?.toLowerCase() ?? ''
  if (ext && MEDIA_EXTENSIONS.has(ext)) return false

  return true
}
