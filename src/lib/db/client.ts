/**
 * DB Client
 *
 * Typed proxy for communicating with the SQLite Web Worker.
 * Provides Promise-based API over postMessage.
 *
 * Features:
 * - Pending request map with sequential IDs
 * - Timeout handling per query
 * - Worker error propagation
 * - Transaction helpers
 * - Graceful shutdown
 */

import type { DBWorkerRequest, DBWorkerResponse } from '@/types'
import { withRetry } from '@/lib/retry'

const QUERY_TIMEOUT_MS = 8_000    // 8s base query timeout (5s was too tight for iOS on complex FTS queries)
const INIT_TIMEOUT_MS  = 25_000   // 25s for WASM init (iOS WASM load + migrations can be slow)
const MAX_QUEUE_TIMEOUT_SLOP_MS = 3_000  // 3ms per pending query (was 10s slop)

// ── Worker Singleton ─────────────────────────────────────────

let worker: Worker | null = null
let seq = 0
let initPromise: Promise<void> | null = null
let initialized = false
const pending = new Map<number, {
  resolve: (value: unknown) => void
  reject:  (reason: unknown) => void
  timer:   ReturnType<typeof setTimeout>
}>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL('../../workers/db.worker.ts', import.meta.url),
      { type: 'module', name: 'nostr-paper-db' }
    )

    worker.onmessage = (e: MessageEvent<DBWorkerResponse>) => {
      const { id } = e.data
      const pending_ = pending.get(id)
      if (!pending_) return

      clearTimeout(pending_.timer)
      pending.delete(id)

      if ('error' in e.data) {
        pending_.reject(new DBError(e.data.error, id))
      } else {
        pending_.resolve(e.data.result)
      }
    }

    worker.onerror = (e) => {
      console.error('[DB Client] Worker error:', e.message)
      // Reject all pending requests on unrecoverable worker error
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer)
        entry.reject(new DBError(`Worker crashed: ${e.message}`, id))
        pending.delete(id)
      }
      // Null out worker so next call creates a fresh one
      initialized = false
      initPromise = null
      worker = null
    }
  }

  return worker
}

// ── Error Type ───────────────────────────────────────────────

export class DBError extends Error {
  constructor(
    message: string,
    public readonly requestId?: number,
  ) {
    super(message)
    this.name = 'DBError'
  }
}

// ── Core Send ────────────────────────────────────────────────

// Distributive omit preserves the discriminated union structure
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never

function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'))
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(new DOMException('Aborted', 'AbortError'))
    }

    signal.addEventListener('abort', onAbort, { once: true })

    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function send<T>(
  request: DistributiveOmit<DBWorkerRequest, 'id'>,
  timeoutMs = QUERY_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = seq++
    const w = getWorker()
    const effectiveTimeoutMs = timeoutMs + Math.min(pending.size * 100, MAX_QUEUE_TIMEOUT_SLOP_MS)

    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new DBError(`Query timeout after ${effectiveTimeoutMs}ms`, id))
    }, effectiveTimeoutMs)

    pending.set(id, {
      resolve: resolve as (v: unknown) => void,
      reject,
      timer,
    })

    w.postMessage({ id, ...request } satisfies DBWorkerRequest)
  })
}

// ── Public API ───────────────────────────────────────────────

/** Initialize the SQLite database (runs migrations, sets PRAGMA) */
export async function initDB(signal?: AbortSignal): Promise<void> {
  if (initialized) return

  if (!initPromise) {
    initPromise = withRetry(
      () => send({ type: 'init' }, INIT_TIMEOUT_MS),
      {
        maxAttempts: 3,
        baseDelayMs: 1_000,
        onRetry: (attempt, delay) => {
          console.warn(`[DB] Init retry ${attempt}, delay ${delay}ms`)
        },
      },
    )
      .then(() => {
        initialized = true
      })
      .finally(() => {
        initPromise = null
      })
  }

  await awaitWithAbort(initPromise, signal)
}

/**
 * Execute a SELECT query, returns typed rows.
 *
 * @example
 * const events = await dbQuery<DBEvent>(
 *   'SELECT * FROM events WHERE kind = ? LIMIT ?',
 *   [1, 50]
 * )
 */
export async function dbQuery<T = Record<string, unknown>>(
  sql: string,
  bind?: unknown[],
): Promise<T[]> {
  return send<T[]>({ type: 'exec', payload: bind !== undefined ? { sql, bind } : { sql } })
}

/**
 * Execute a write statement (INSERT, UPDATE, DELETE).
 * Returns number of affected rows.
 */
export async function dbRun(
  sql: string,
  bind?: unknown[],
): Promise<number> {
  const result = await send<{ changes: number }>({
    type: 'run',
    payload: bind !== undefined ? { sql, bind } : { sql },
  })
  return result.changes
}

/**
 * Execute multiple statements in a single transaction.
 * Rolls back on any failure.
 */
export async function dbTransaction(
  operations: Array<{ sql: string; bind?: unknown[] }>
): Promise<void> {
  if (operations.length === 0) return
  await send({ type: 'transaction', payload: operations })
}

/** Close the worker and database cleanly */
export async function closeDB(): Promise<void> {
  if (!worker) return
  try {
    await send({ type: 'close' })
  } finally {
    initialized = false
    initPromise = null
    worker.terminate()
    worker = null
    pending.clear()
  }
}
