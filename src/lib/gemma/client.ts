/**
 * Gemma 4 on-device inference client
 *
 * Manages a singleton Web Worker that runs @mediapipe/tasks-genai + WebGPU.
 *
 * Usage:
 *   import { generateText, isGemmaAvailable } from '@/lib/gemma/client'
 *
 *   const text = await generateText('Summarise this note: ...', {
 *     onToken: (partial) => appendToUI(partial),
 *     signal:  abortController.signal,
 *   })
 *
 * Requirements:
 *   - Browser with WebGPU support (Chrome ≥ 113, Edge ≥ 113)
 *   - VITE_GEMMA_E2B_MODEL_PATH **or** VITE_GEMMA_E4B_MODEL_PATH set in .env
 *     pointing to the downloaded .task model file in public/models/
 *
 * Model download:
 *   E2B (~1.5 GB): https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.task
 *   E4B (~2.5 GB): https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it-web.task
 */

import type { GemmaModel, GemmaInitPayload, GemmaWorkerRequest, GemmaWorkerResponse } from '@/types'

type GemmaWorkerRequestWithoutId = GemmaWorkerRequest extends infer Request
  ? Request extends { id: number }
    ? Omit<Request, 'id'>
    : never
  : never

// ── Configuration ───────────────────────────────────────────────

const INIT_TIMEOUT_MS   = 180_000 // model can take a while to load from disk
const QUERY_TIMEOUT_MS  = 120_000

/**
 * Resolve which model path to use. Prefers E4B when both are configured,
 * or falls back to E2B. Returns null if neither is set.
 */
function resolveModelPath(variant?: GemmaModel): string | null {
  if (variant === 'E2B') return import.meta.env.VITE_GEMMA_E2B_MODEL_PATH ?? null
  if (variant === 'E4B') return import.meta.env.VITE_GEMMA_E4B_MODEL_PATH ?? null
  // Auto: prefer E4B, fall back to E2B
  return (
    import.meta.env.VITE_GEMMA_E4B_MODEL_PATH ??
    import.meta.env.VITE_GEMMA_E2B_MODEL_PATH ??
    null
  )
}

// ── Worker lifecycle ─────────────────────────────────────────────

let gemmaWorker: Worker | null = null
let seq = 0
let fatalError: Error | null = null
let initPromise: Promise<void> | null = null

interface PendingEntry {
  resolve: (value: string) => void
  reject:  (reason: unknown) => void
  onToken: ((partial: string) => void) | undefined
  timer:   ReturnType<typeof setTimeout>
  cleanup: () => void
}

const pending = new Map<number, PendingEntry>()

function rejectAll(reason: Error): void {
  for (const [id, entry] of pending) {
    entry.cleanup()
    entry.reject(reason)
    pending.delete(id)
  }
}

function getWorker(): Worker {
  if (!gemmaWorker) {
    gemmaWorker = new Worker(
      new URL('../../workers/gemma.worker.ts', import.meta.url),
      { type: 'module', name: 'nostr-paper-gemma' },
    )

    gemmaWorker.onmessage = (event: MessageEvent<GemmaWorkerResponse>) => {
      const msg = event.data
      const entry = pending.get(msg.id)
      if (!entry) return

      if (msg.type === 'token') {
        // Partial token — fire onToken but leave pending in place
        entry.onToken?.(msg.partial)
        return
      }

      // Terminal messages: done / init_ok / error
      entry.cleanup()
      pending.delete(msg.id)

      if (msg.type === 'error') {
        entry.reject(new Error(msg.error))
      } else if (msg.type === 'done') {
        entry.resolve(msg.fullText)
      } else if (msg.type === 'init_ok') {
        entry.resolve('')
      }
    }

    gemmaWorker.onerror = (event) => {
      const message = event.message || 'Gemma worker crashed'
      fatalError = new Error(message)
      initPromise = null
      rejectAll(fatalError)
      gemmaWorker?.terminate()
      gemmaWorker = null
    }

    gemmaWorker.onmessageerror = () => {
      const err = new Error('Gemma worker returned an unreadable message')
      rejectAll(err)
    }
  }
  return gemmaWorker
}

function send<T = string>(
  request: GemmaWorkerRequestWithoutId,
  timeoutMs: number,
  onToken?: (partial: string) => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const id = ++seq
    const cleanup = () => {
      clearTimeout(timer)
      if (signal) {
        signal.removeEventListener('abort', onAbort)
      }
    }

    const onAbort = () => {
      if (!pending.has(id)) return
      cleanup()
      pending.delete(id)
      reject(new DOMException('Aborted', 'AbortError'))
    }

    const timer = setTimeout(() => {
      cleanup()
      pending.delete(id)
      reject(new Error(`Gemma worker request timed out (${timeoutMs}ms)`))
    }, timeoutMs)

    const entry: PendingEntry = {
      resolve: resolve as (value: string) => void,
      reject,
      onToken,
      timer,
      cleanup,
    }

    pending.set(id, entry)
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }

    const message = { id, ...request } as GemmaWorkerRequest
    getWorker().postMessage(message)
  })
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return parsed
}

// ── Init ─────────────────────────────────────────────────────────

function ensureInit(variant?: GemmaModel): Promise<void> {
  if (fatalError) return Promise.reject(fatalError)
  if (initPromise) return initPromise

  const modelPath = resolveModelPath(variant)
  if (!modelPath) {
    fatalError = new Error(
      'No Gemma model path configured. ' +
      'Set VITE_GEMMA_E2B_MODEL_PATH or VITE_GEMMA_E4B_MODEL_PATH in your .env file.',
    )
    return Promise.reject(fatalError)
  }

  const payload: GemmaInitPayload = { modelPath }

  if (import.meta.env.VITE_GEMMA_WASM_PATH) {
    payload.wasmPath = import.meta.env.VITE_GEMMA_WASM_PATH
  }

  const maxTokens = parseOptionalNumber(import.meta.env.VITE_GEMMA_MAX_TOKENS)
  if (typeof maxTokens === 'number') payload.maxTokens = maxTokens

  const temperature = parseOptionalNumber(import.meta.env.VITE_GEMMA_TEMPERATURE)
  if (typeof temperature === 'number') payload.temperature = temperature

  const topK = parseOptionalNumber(import.meta.env.VITE_GEMMA_TOP_K)
  if (typeof topK === 'number') payload.topK = topK

  initPromise = send<string>(
    { type: 'init', payload },
    INIT_TIMEOUT_MS,
  ).then(() => undefined).catch((err) => {
    fatalError = err
    initPromise = null
    throw err
  })

  return initPromise
}

// ── Public API ───────────────────────────────────────────────────

export interface GenerateOptions {
  /** Called with each streaming token as it arrives. */
  onToken?: (partial: string) => void
  /** AbortSignal to cancel the operation before it starts. */
  signal?:  AbortSignal
  /** Which model variant to use (auto-detected from env if not specified). */
  variant?: GemmaModel
}

/**
 * Returns true if at least one model path is configured and the browser
 * reports WebGPU support. Does NOT pre-initialise the worker.
 */
export function isGemmaAvailable(): boolean {
  const hasModel = Boolean(
    import.meta.env.VITE_GEMMA_E2B_MODEL_PATH ||
    import.meta.env.VITE_GEMMA_E4B_MODEL_PATH,
  )
  const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator
  return hasModel && hasWebGPU
}

/**
 * Generate a text response from the on-device Gemma 4 model.
 *
 * @param prompt  The full prompt string to pass to the model.
 * @param options Streaming callback, abort signal, and model variant.
 * @returns The complete generated response text.
 */
export async function generateText(
  prompt: string,
  options: GenerateOptions = {},
): Promise<string> {
  const { onToken, signal, variant } = options

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  await ensureInit(variant)

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  return send<string>(
    { type: 'generate', payload: { prompt } },
    QUERY_TIMEOUT_MS,
    onToken,
    signal,
  )
}

/**
 * Gracefully close the worker and release GPU resources.
 * The next call to generateText() will reinitialise the model.
 */
export async function closeGemma(): Promise<void> {
  if (!gemmaWorker) return
  await send({ type: 'close' }, 10_000).catch(() => undefined)
  gemmaWorker?.terminate()
  gemmaWorker = null
  initPromise = null
  fatalError = null
}
