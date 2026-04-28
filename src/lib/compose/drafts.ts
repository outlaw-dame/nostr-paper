/**
 * Compose Draft Management
 *
 * Persists draft text and thread titles in localStorage with:
 * - Namespaced keys per compose context (note, reply:{id}, quote:{id})
 * - 7-day TTL auto-expiry
 * - Corrupt-entry self-healing on read
 * - Debounced writes handled at call-site via the provided hook
 * - 256 KB max body size — well above the publish limit, safely captures raw drafts
 *
 * All localStorage access is wrapped to silently tolerate quota errors and
 * SSR/private-browsing environments where storage may be unavailable.
 */

const DRAFT_KEY_PREFIX = 'nostr-paper:draft:'
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1_000 // 7 days
const MAX_DRAFT_BODY_BYTES = 262_144 // 256 KB

/**
 * Scope for a compose draft.
 * Template-literal unions let TypeScript narrow the key type at call-sites.
 */
export type DraftContext =
  | 'note'
  | 'thread'
  | `reply:${string}`
  | `quote:${string}`

export interface StoredDraft {
  body: string
  threadTitle?: string
  savedAt: number // unix ms
}

// ── Internal helpers ──────────────────────────────────────────

function storageKey(ctx: DraftContext): string {
  return `${DRAFT_KEY_PREFIX}${ctx}`
}

function isValidDraft(value: unknown): value is StoredDraft {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.body === 'string' &&
    typeof v.savedAt === 'number' &&
    (v.threadTitle === undefined || typeof v.threadTitle === 'string')
  )
}

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch (err) {
    // Storage full or unavailable — non-fatal
    console.warn('[drafts] Failed to persist draft:', err)
  }
}

function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch { /* ignore */ }
}

// ── Public API ────────────────────────────────────────────────

/**
 * Read a stored draft.
 * Returns null on cache miss, corrupt JSON, or TTL expiry — self-heals in all cases.
 */
export function readDraft(ctx: DraftContext): StoredDraft | null {
  const key = storageKey(ctx)
  const raw = safeGetItem(key)
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    safeRemoveItem(key)
    return null
  }

  if (!isValidDraft(parsed)) {
    safeRemoveItem(key)
    return null
  }

  if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
    safeRemoveItem(key)
    return null
  }

  return parsed
}

/**
 * Persist a draft.
 * Silently refuses bodies that exceed MAX_DRAFT_BODY_BYTES.
 */
export function writeDraft(
  ctx: DraftContext,
  draft: Omit<StoredDraft, 'savedAt'>,
): void {
  if (new TextEncoder().encode(draft.body).length > MAX_DRAFT_BODY_BYTES) return

  const entry: StoredDraft = { ...draft, savedAt: Date.now() }
  safeSetItem(storageKey(ctx), JSON.stringify(entry))
}

/**
 * Remove a draft (e.g. after successful publish).
 */
export function clearDraft(ctx: DraftContext): void {
  safeRemoveItem(storageKey(ctx))
}

/**
 * Remove all drafts older than DRAFT_TTL_MS.
 * Safe to call on app boot — iterates storage once and is O(n) in storage keys.
 */
export function pruneExpiredDrafts(): void {
  const now = Date.now()
  try {
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(DRAFT_KEY_PREFIX)) continue
      const raw = safeGetItem(key)
      if (!raw) { keysToRemove.push(key); continue }

      let parsed: unknown
      try { parsed = JSON.parse(raw) } catch { keysToRemove.push(key); continue }

      if (!isValidDraft(parsed) || now - parsed.savedAt > DRAFT_TTL_MS) {
        keysToRemove.push(key)
      }
    }
    for (const key of keysToRemove) safeRemoveItem(key)
  } catch { /* localStorage enumeration unavailable */ }
}
