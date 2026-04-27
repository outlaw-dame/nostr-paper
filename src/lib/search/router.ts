/**
 * Main-thread client for the search intent router worker.
 *
 * Provides `classifySearchIntent(query)` which sends a query to
 * router.worker.ts for intent classification and returns a SearchIntent.
 *
 * Design:
 *   - Lazy worker initialization (model loads on first classify call)
 *   - Short default timeout (5 s): a timed-out router falls back to 'hybrid',
 *     preserving the existing hybrid-search behaviour with no user-visible
 *     degradation
 *   - Pre-classification heuristics run synchronously before touching the
 *     worker, so common patterns (hashtags, pubkeys) are resolved instantly
 *
 * Opt-in via env: VITE_ENABLE_SEARCH_ROUTER=true (disabled by default so
 * existing deployments are unaffected until the model is explicitly wanted)
 */

import type { RouterWorkerRequest, RouterWorkerResponse, SearchIntent } from '@/types'

// ── Configuration ─────────────────────────────────────────────────────────────

const ROUTER_ENABLED = import.meta.env.VITE_ENABLE_SEARCH_ROUTER === 'true'
const INIT_TIMEOUT_MS = 60_000
const CLASSIFY_TIMEOUT_MS = Number(import.meta.env.VITE_ROUTER_TIMEOUT_MS) || 5_000

// ── Worker state ──────────────────────────────────────────────────────────────

let worker: Worker | null = null
let seq = 0
let fatalError: Error | null = null
let activeRouterModel: string | null = null

/* eslint-disable no-unused-vars */
const pending = new Map<number, {
  resolve: (...args: [unknown]) => void
  reject: (...args: [unknown]) => void
  timer: ReturnType<typeof setTimeout>
}>()
/* eslint-enable no-unused-vars */

function rejectPending(reason: unknown): void {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer)
    entry.reject(reason)
    pending.delete(id)
  }
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL('../../workers/router.worker.ts', import.meta.url),
      { type: 'module', name: 'nostr-paper-router' },
    )

    worker.onmessage = (event: MessageEvent<RouterWorkerResponse>) => {
      const entry = pending.get(event.data.id)
      if (!entry) return

      clearTimeout(entry.timer)
      pending.delete(event.data.id)

      if ('error' in event.data) {
        entry.reject(new Error(event.data.error))
      } else {
        entry.resolve(event.data.result)
      }
    }

    worker.onerror = (event) => {
      const message = event.message || 'Router worker crashed'
      const error = new Error(message)
      fatalError = error
      rejectPending(error)
      worker?.terminate()
      worker = null
    }

    worker.onmessageerror = () => {
      rejectPending(new Error('Router worker returned an unreadable message'))
      worker?.terminate()
      worker = null
    }
  }

  return worker
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

function send<T>(
  request: DistributiveOmit<RouterWorkerRequest, 'id'>,
  timeoutMs: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = seq++
    const routerWorker = getWorker()
    let settled = false

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      pending.delete(id)
      fn()
    }

    const timer = setTimeout(() => {
      settle(() => reject(new Error(`Router worker timeout after ${timeoutMs}ms`)))
    }, timeoutMs)

    pending.set(id, {
      resolve: (value) => settle(() => resolve(value as T)),
      reject: (reason) => settle(() => reject(reason)),
      timer,
    })

    routerWorker.postMessage({ id, ...request } satisfies RouterWorkerRequest)
  })
}

// ── Heuristic pre-classifier ──────────────────────────────────────────────────
// Handles unambiguous patterns synchronously before touching the worker.
// Returns null when the intent is ambiguous and LLM classification is needed.

const LEXICAL_PATTERNS = [
  /^#\S+/,                          // #hashtag
  /^@\S+/,                          // @mention
  /^n(?:pub|sec|ote|profile)1[a-z0-9]+$/i, // bech32 nostr keys
  /^[0-9a-f]{64}$/i,                // raw 32-byte hex pubkey / event id
]

export function heuristicClassifySearchIntent(query: string): SearchIntent | null {
  const trimmed = query.trim()
  if (!trimmed) return 'lexical'

  // If every token looks like a lexical pattern, it's lexical
  const tokens = trimmed.split(/\s+/)
  if (tokens.every(token => LEXICAL_PATTERNS.some(pattern => pattern.test(token)))) {
    return 'lexical'
  }

  // Natural language: query ends with '?' or contains many common words
  if (trimmed.endsWith('?')) return 'semantic'

  return null // ambiguous — let the LLM decide
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialise the router worker eagerly.
 * Optional: the worker init also happens lazily on first classifySearchIntent
 * call. Call this during app startup if you want the model ready before the
 * first search.
 */
/**
 * Returns the currently active router model identifier in "runtime:modelId" format
 * (e.g. "transformers:onnx-community/gemma-3-270m-it-ONNX" or "webllm:Llama-3.2-1B-...").
 * Returns null before the worker has been initialised.
 */
export function getActiveRouterModel(): string | null {
  return activeRouterModel
}

export async function initSearchRouter(): Promise<void> {
  if (!ROUTER_ENABLED) return
  if (fatalError) return

  const result = await send<{ model?: string }>({ type: 'init' }, INIT_TIMEOUT_MS).catch(() => null)
  if (result?.model) activeRouterModel = result.model
}

/**
 * Classify a search query as 'lexical', 'semantic', or 'hybrid'.
 *
 * Fast path: common patterns (hashtags, pubkeys, @mentions) are resolved via
 * heuristics without touching the worker.
 *
 * Slow path: an instruction-tuned LLM running in the router worker classifies
 * the query. Resolves in ≈ 50-200 ms once the model is loaded.
 *
 * Always resolves — never rejects. Fallback is 'hybrid' (preserves existing
 * hybrid search behaviour on any error or timeout).
 */
export async function classifySearchIntent(query: string): Promise<SearchIntent> {
  const heuristic = heuristicClassifySearchIntent(query)
  if (heuristic !== null) return heuristic

  if (!ROUTER_ENABLED) return 'hybrid'
  if (fatalError) return 'hybrid'

  try {
    const result = await send<{ intent?: SearchIntent; model?: string }>(
      { type: 'classify', payload: { query } },
      CLASSIFY_TIMEOUT_MS,
    )
    if (result.model) activeRouterModel = result.model
    return result.intent ?? 'hybrid'
  } catch {
    return 'hybrid'
  }
}

export async function closeSearchRouter(): Promise<void> {
  if (!worker) return

  try {
    await send({ type: 'close' }, 5_000)
  } finally {
    rejectPending(new Error('Router worker closed'))
    worker.terminate()
    worker = null
    fatalError = null
    activeRouterModel = null
  }
}
