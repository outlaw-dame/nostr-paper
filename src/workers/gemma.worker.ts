/**
 * Gemma 4 on-device inference worker (Google AI Edge / MediaPipe Tasks GenAI)
 *
 * Uses @mediapipe/tasks-genai + WebGPU to run Gemma 4 E2B/E4B locally in the
 * browser without any server round-trip.
 *
 * Model files must be downloaded separately from HuggingFace:
 *   E2B (~1.5 GB): https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm
 *   E4B (~2.5 GB): https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm
 *
 * Place the .task file in public/models/ and configure VITE_GEMMA_E2B_MODEL_PATH
 * or VITE_GEMMA_E4B_MODEL_PATH in your .env file.
 */

import { FilesetResolver, LlmInference } from '@mediapipe/tasks-genai'
import type { GemmaWorkerRequest, GemmaWorkerResponse } from '@/types'

// ── Default configuration from env vars ───────────────────────

/**
 * Local WASM path relative to the worker origin.
 * @mediapipe/tasks-genai ships WASM files inside its package; Vite's
 * optimizeDeps.exclude ensures they are served verbatim.
 *
 * Override via VITE_GEMMA_WASM_PATH to use a CDN copy:
 *   https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm
 */
const DEFAULT_WASM_PATH =
  import.meta.env.VITE_GEMMA_WASM_PATH ??
  '/vendor/mediapipe/tasks-genai/wasm'

const DEFAULT_MAX_TOKENS = Number(import.meta.env.VITE_GEMMA_MAX_TOKENS ?? '1024')
const DEFAULT_TEMPERATURE = Number(import.meta.env.VITE_GEMMA_TEMPERATURE ?? '0.8')
const DEFAULT_TOP_K = Number(import.meta.env.VITE_GEMMA_TOP_K ?? '40')

// ── State ───────────────────────────────────────────────────────

let llm: LlmInference | null = null
/** Set once init fails to avoid retrying in the same session */
let fatalError: string | null = null

// ── Message handler ─────────────────────────────────────────────

self.addEventListener('message', async (event: MessageEvent<GemmaWorkerRequest>) => {
  const req = event.data

  // ── init ───────────────────────────────────────────────────
  if (req.type === 'init') {
    if (fatalError) {
      self.postMessage({ id: req.id, type: 'error', error: fatalError } satisfies GemmaWorkerResponse)
      return
    }
    if (llm) {
      self.postMessage({ id: req.id, type: 'init_ok' } satisfies GemmaWorkerResponse)
      return
    }

    const { modelPath, wasmPath, maxTokens, temperature, topK } = req.payload

    try {
      const genai = await FilesetResolver.forGenAiTasks(wasmPath ?? DEFAULT_WASM_PATH)
      llm = await LlmInference.createFromOptions(genai, {
        baseOptions: { modelAssetPath: modelPath },
        maxTokens:   maxTokens   ?? DEFAULT_MAX_TOKENS,
        temperature: temperature ?? DEFAULT_TEMPERATURE,
        topK:        topK        ?? DEFAULT_TOP_K,
      })
      self.postMessage({ id: req.id, type: 'init_ok' } satisfies GemmaWorkerResponse)
    } catch (err) {
      fatalError = err instanceof Error ? err.message : String(err)
      self.postMessage({ id: req.id, type: 'error', error: fatalError } satisfies GemmaWorkerResponse)
    }
    return
  }

  // ── generate ───────────────────────────────────────────────
  if (req.type === 'generate') {
    if (fatalError) {
      self.postMessage({ id: req.id, type: 'error', error: fatalError } satisfies GemmaWorkerResponse)
      return
    }
    if (!llm) {
      self.postMessage({
        id:    req.id,
        type:  'error',
        error: 'Gemma model not initialised. Call init first.',
      } satisfies GemmaWorkerResponse)
      return
    }

    try {
      const fullText = await llm.generateResponse(req.payload.prompt, (partial, done) => {
        if (!done) {
          self.postMessage({ id: req.id, type: 'token', partial } satisfies GemmaWorkerResponse)
        }
      })
      self.postMessage({ id: req.id, type: 'done', fullText } satisfies GemmaWorkerResponse)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      self.postMessage({ id: req.id, type: 'error', error: message } satisfies GemmaWorkerResponse)
    }
    return
  }

  // ── close ──────────────────────────────────────────────────
  if (req.type === 'close') {
    if (llm) {
      llm.close()
      llm = null
    }
    fatalError = null
    self.postMessage({ id: req.id, type: 'done', fullText: '' } satisfies GemmaWorkerResponse)
  }
})
