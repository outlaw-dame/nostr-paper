import { withRetry } from '@/lib/retry'
import { buildSearchIntentSystemPrompt, buildSearchIntentUserPrompt } from '@/lib/llm/promptPlaybook'
import { createLiteRtSession, type LiteRtSession } from '@/lib/llm/litert'
import type { SearchIntent } from '@/types'
import type { LlmRuntime } from '@/lib/llm/runtimeSelector'
import type * as TransformersModule from '@huggingface/transformers'

const MODEL_ID = import.meta.env.VITE_ROUTER_MODEL_ID ?? 'onnx-community/gemma-3-270m-it-ONNX'
const MODEL_DTYPE = import.meta.env.VITE_ROUTER_MODEL_DTYPE ?? 'q4'
const ALLOW_REMOTE_MODELS = import.meta.env.VITE_ROUTER_ALLOW_REMOTE_MODELS !== 'false'
const LOCAL_MODEL_PATH = typeof import.meta.env.VITE_ROUTER_LOCAL_MODEL_PATH === 'string'
  ? import.meta.env.VITE_ROUTER_LOCAL_MODEL_PATH.trim()
  : ''
const WEBLLM_MODEL_ID = import.meta.env.VITE_WEBLLM_MODEL_ID ?? 'Llama-3.2-1B-Instruct-q4f32_1-MLC'
// Router-specific LiteRT model path. Use VITE_ROUTER_LITERT_MODEL_PATH to deploy a small
// classification-optimised model (e.g. Gemma 2B int4 or a fine-tuned intent classifier).
// Falls back to VITE_LITERT_MODEL_PATH so existing single-model deployments keep working,
// but keeping them separate is strongly recommended: the router needs 4-token deterministic
// output (temp=0, topK=1) while the grounded-answer model needs free-form generation.
const LITERT_ROUTER_MODEL_PATH =
  import.meta.env.VITE_ROUTER_LITERT_MODEL_PATH
  ?? import.meta.env.VITE_LITERT_MODEL_PATH
  ?? '/assets/gemma-3n-E2B-it-int4-Web.litertlm'
const LITERT_ROUTER_WASM_ROOT = import.meta.env.VITE_LITERT_WASM_ROOT
  ?? 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@latest/wasm'
const CACHE_MAX = 500
const SYSTEM_PROMPT = buildSearchIntentSystemPrompt()

type SupportedModelDtype = 'auto' | 'fp32' | 'fp16' | 'q8' | 'int8' | 'uint8' | 'q4' | 'bnb4' | 'q4f16'
type TextGenMessage = { role: string; content: string }
type TextGenerationPipeline = (
  ...args: [TextGenMessage[], { max_new_tokens: number; do_sample: boolean }]
) => Promise<Array<{ generated_text: TextGenMessage[] }>>
type WebllmChatEngine = { chat: { completions: { create: (...args: [unknown]) => Promise<unknown> } } }

export interface RouterRuntimeSession {
  readonly runtime: LlmRuntime
  readonly modelId: string
  init: () => Promise<void>
  classify: (...args: [string]) => Promise<SearchIntent>
  close: () => Promise<void>
}

const intentCaches: Record<LlmRuntime, Map<string, SearchIntent>> = {
  transformers: new Map(),
  webllm: new Map(),
  litert: new Map(),
}

let generatorPromise: Promise<TextGenerationPipeline> | null = null
let transformersPromise: Promise<typeof TransformersModule> | null = null
let webllmEnginePromise: Promise<unknown> | null = null
let litertSessionPromise: Promise<LiteRtSession> | null = null

function normalizeModelDtype(value: unknown): SupportedModelDtype {
  switch (value) {
    case 'auto':
    case 'fp32':
    case 'fp16':
    case 'q8':
    case 'int8':
    case 'uint8':
    case 'q4':
    case 'bnb4':
    case 'q4f16':
      return value
    default:
      return 'q4'
  }
}

function getCachedIntent(runtime: LlmRuntime, query: string): SearchIntent | undefined {
  return intentCaches[runtime].get(query)
}

function setCachedIntent(runtime: LlmRuntime, query: string, intent: SearchIntent): void {
  const cache = intentCaches[runtime]
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value
    if (firstKey !== undefined) cache.delete(firstKey)
  }
  cache.set(query, intent)
}

export function parseRouterIntent(raw: string): SearchIntent {
  const word = raw.trim().toLowerCase().split(/\s+/)[0] ?? ''
  if (word.startsWith('lex')) return 'lexical'
  if (word.startsWith('sem')) return 'semantic'
  if (word.startsWith('hyb')) return 'hybrid'
  return 'hybrid'
}

async function getGenerator(): Promise<TextGenerationPipeline> {
  if (!generatorPromise) {
    if (!LOCAL_MODEL_PATH && !ALLOW_REMOTE_MODELS) {
      throw new Error('Router model loading is disabled by configuration.')
    }

    if (!transformersPromise) {
      transformersPromise = import('@huggingface/transformers')
    }

    const { env, pipeline } = await transformersPromise

    env.allowLocalModels = LOCAL_MODEL_PATH.length > 0
    env.allowRemoteModels = ALLOW_REMOTE_MODELS
    if (LOCAL_MODEL_PATH) {
      env.localModelPath = LOCAL_MODEL_PATH
    }

    const attemptedDtypes = new Set<SupportedModelDtype | undefined>([
      normalizeModelDtype(MODEL_DTYPE),
      'q4',
      undefined,
    ])

    generatorPromise = (async () => {
      for (const dtype of attemptedDtypes) {
        try {
          return await withRetry(
            async () => (
              await pipeline('text-generation', MODEL_ID, dtype ? { dtype } : {})
            ) as unknown as TextGenerationPipeline,
            { maxAttempts: 2, baseDelayMs: 1_000 },
          )
        } catch {
          continue
        }
      }
      throw new Error(`Unable to load router model ${MODEL_ID}`)
    })()
  }

  return generatorPromise
}

async function getWebllmEngine(): Promise<WebllmChatEngine> {
  if (!webllmEnginePromise) {
    webllmEnginePromise = (async () => {
      const webllm = await import('@mlc-ai/web-llm')
      return webllm.CreateMLCEngine(WEBLLM_MODEL_ID)
    })()
  }

  return webllmEnginePromise as Promise<WebllmChatEngine>
}

// Classification parameters for the router LiteRT session:
//   maxTokens: 64  — only a single intent word is needed; caps waste on generative models
//   topK: 1        — greedy decode for deterministic classification
//   temperature: 0 — no sampling; must match grounded-answer session (temp=0.2, topK=8)
async function getLiteRtSession(): Promise<LiteRtSession> {
  if (!litertSessionPromise) {
    litertSessionPromise = createLiteRtSession({
      modelPath: LITERT_ROUTER_MODEL_PATH,
      wasmRoot: LITERT_ROUTER_WASM_ROOT,
      maxTokens: 64,
      topK: 1,
      temperature: 0,
    })
  }
  return litertSessionPromise
}

async function classifyWithTransformers(query: string): Promise<SearchIntent> {
  const cached = getCachedIntent('transformers', query)
  if (cached !== undefined) return cached

  const generator = await getGenerator()
  const messages: TextGenMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildSearchIntentUserPrompt(query) },
  ]
  const output = await generator(messages, { max_new_tokens: 4, do_sample: false })
  const generated = output[0]?.generated_text
  const lastMsg = Array.isArray(generated) ? generated[generated.length - 1] : undefined
  const intent = parseRouterIntent(lastMsg?.content ?? '')
  setCachedIntent('transformers', query, intent)
  return intent
}

async function classifyWithWebllm(query: string): Promise<SearchIntent> {
  const cached = getCachedIntent('webllm', query)
  if (cached !== undefined) return cached

  const engine = await getWebllmEngine()
  const response = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildSearchIntentUserPrompt(query) },
    ],
    temperature: 0,
    top_p: 1,
    max_tokens: 4,
  }) as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ text?: string }>
      }
    }>
  }

  const content = response.choices?.[0]?.message?.content
  const text = Array.isArray(content)
    ? content.map(part => part.text ?? '').join(' ')
    : (content ?? '')
  const intent = parseRouterIntent(text)
  setCachedIntent('webllm', query, intent)
  return intent
}

async function classifyWithLiteRt(query: string): Promise<SearchIntent> {
  const cached = getCachedIntent('litert', query)
  if (cached !== undefined) return cached

  const llm = await getLiteRtSession()
  const response = await llm.generateResponse(`${SYSTEM_PROMPT}\n\n${buildSearchIntentUserPrompt(query)}`)
  const intent = parseRouterIntent(response)
  setCachedIntent('litert', query, intent)
  return intent
}

export function createRouterRuntimeSession(runtime: LlmRuntime): RouterRuntimeSession {
  if (runtime === 'webllm') {
    return {
      runtime,
      modelId: WEBLLM_MODEL_ID,
      init: async () => { await getWebllmEngine() },
      classify: classifyWithWebllm,
      close: async () => {
        webllmEnginePromise = null
        intentCaches.webllm.clear()
      },
    }
  }

  if (runtime === 'litert') {
    return {
      runtime,
      modelId: LITERT_ROUTER_MODEL_PATH,
      init: async () => { await getLiteRtSession() },
      classify: classifyWithLiteRt,
      close: async () => {
        if (litertSessionPromise) {
          const session = await litertSessionPromise
          await session.close?.()
          litertSessionPromise = null
        }
        intentCaches.litert.clear()
      },
    }
  }

  return {
    runtime: 'transformers',
    modelId: MODEL_ID,
    init: async () => { await getGenerator() },
    classify: classifyWithTransformers,
    close: async () => {
      generatorPromise = null
      transformersPromise = null
      intentCaches.transformers.clear()
    },
  }
}
