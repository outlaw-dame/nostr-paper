/**
 * App Bootstrap
 *
 * Initializes the full application stack in correct order:
 * 1. Storage persistence request
 * 2. SQLite DB (WASM + OPFS)
 * 3. NDK (relay connections)
 *
 * Cross-origin isolation comes from host headers or the root PWA service
 * worker on a subsequent navigation. On the very first visit without those
 * headers already present, the app falls back gracefully until the next load.
 *
 * Returns a typed Result so callers can handle partial failures.
 */

import { initDB } from '@/lib/db/client'
import { rebuildDeletionState } from '@/lib/db/nostr'
import { initNDK } from '@/lib/nostr/ndk'
import { requestPersistentStorage } from '@/lib/security/sanitize'
import { withRetry } from '@/lib/retry'
import { initTheme } from '@/lib/theme'
import type { Result, AppError } from '@/types'
import { ErrorCode } from '@/types'

export interface BootstrapResult {
  dbReady:     boolean
  ndkReady:    boolean
  storageMode: 'opfs' | 'memory' | 'unknown'
  persistent:  boolean
}

/**
 * Bootstrap the application.
 * Designed to be resilient — NDK failure won't block DB-only offline use.
 */
export async function bootstrap(
  signal?: AbortSignal
): Promise<Result<BootstrapResult, AppError>> {
  const result: BootstrapResult = {
    dbReady:     false,
    ndkReady:    false,
    storageMode: 'unknown',
    persistent:  false,
  }

  // ── 0. Theme initialization ────────────────────────────────
  // Apply saved theme early to prevent Flash of Unstyled Content (FOUC).
  initTheme()

  // ── 1. Storage persistence ────────────────────────────────
  // Request early — browsers require this before storage operations
  result.persistent = await requestPersistentStorage()

  // ── 2. COI headers check ──────────────────────────────────
  // SharedArrayBuffer requires cross-origin isolation
  if (typeof SharedArrayBuffer === 'undefined') {
    console.warn(
      '[Bootstrap] SharedArrayBuffer unavailable — OPFS performance limited. ' +
      'Ensure COOP/COEP headers are set.'
    )
    result.storageMode = 'memory'
  } else {
    result.storageMode = 'opfs'
  }

  // ── 3. SQLite DB initialization ───────────────────────────
  try {
    await initDB(signal)
    await rebuildDeletionState()
    result.dbReady = true
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === 'AbortError'
    if (isAbort) throw error

    console.error('[Bootstrap] DB initialization failed:', error)
    return {
      ok:    false,
      error: {
        code:        ErrorCode.DB_INIT_FAILED,
        message:     error instanceof Error ? error.message : 'Unknown DB error',
        timestamp:   Date.now(),
        recoverable: false,
      },
    }
  }

  // ── 4. NDK initialization (non-blocking on failure) ───────
  // NDK failure is recoverable — app works offline without it
  try {
    await withRetry(
      () => initNDK(signal !== undefined ? { signal } : {}),
      {
        maxAttempts: 2,
        baseDelayMs: 1_000,
        maxDelayMs:  5_000,
        ...(signal !== undefined ? { signal } : {}),
        shouldRetry: (error) => {
          // Do not retry auth errors
          if (error instanceof Error && error.message.includes('auth')) return false
          return true
        },
      }
    )
    result.ndkReady = true
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === 'AbortError'
    if (isAbort) throw error

    // Log but don't fail — app can run in read-only local mode
    console.warn('[Bootstrap] NDK initialization failed (offline mode):', error)
  }

  return { ok: true, value: result }
}
