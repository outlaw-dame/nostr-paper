import { getRouterRuntime } from '@/lib/llm/runtimeSelector'
import {
  DEFAULT_LITERT_MODEL_PATH,
  DEFAULT_LITERT_WASM_ROOT,
} from '@/lib/llm/litert'
import { DEFAULT_MODERATION_MODEL_ID } from '@/lib/moderation/policy'
import {
  DEFAULT_MEDIA_NSFW_MODEL_ID,
  DEFAULT_MEDIA_VIOLENCE_MODEL_ID,
} from '@/lib/moderation/mediaPolicy'

export interface ModelResponsibilityRow {
  component: string
  runtime: string
  model: string
  job: string
  output: string
  source: string
  status: 'active' | 'configured' | 'missing' | 'not-wired'
}

const DEFAULT_ROUTER_TRANSFORMERS_MODEL = 'onnx-community/gemma-3-270m-it-ONNX'
const DEFAULT_ROUTER_WEBLLM_MODEL = 'Llama-3.2-1B-Instruct-q4f32_1-MLC'
const DEFAULT_SEMANTIC_MODEL = 'Xenova/all-MiniLM-L6-v2'

function envString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function getModelResponsibilityRows(): ModelResponsibilityRow[] {
  const routerRuntime = getRouterRuntime()

  const routerTransformersModel = envString(import.meta.env.VITE_ROUTER_MODEL_ID) || DEFAULT_ROUTER_TRANSFORMERS_MODEL
  const routerWebllmModel = envString(import.meta.env.VITE_WEBLLM_MODEL_ID) || DEFAULT_ROUTER_WEBLLM_MODEL
  const groundedLiteRtModel = envString(import.meta.env.VITE_LITERT_MODEL_PATH) || DEFAULT_LITERT_MODEL_PATH
  const groundedLiteRtWasm = envString(import.meta.env.VITE_LITERT_WASM_ROOT) || DEFAULT_LITERT_WASM_ROOT
  const routerLiteRtModel = envString(import.meta.env.VITE_ROUTER_LITERT_MODEL_PATH)
    || envString(import.meta.env.VITE_LITERT_MODEL_PATH)
    || DEFAULT_LITERT_MODEL_PATH

  const semanticModel = envString(import.meta.env.VITE_SEMANTIC_MODEL_ID) || DEFAULT_SEMANTIC_MODEL
  const moderationModel = envString(import.meta.env.VITE_MODERATION_MODEL_ID) || DEFAULT_MODERATION_MODEL_ID
  const nsfwModel = envString(import.meta.env.VITE_MEDIA_MODERATION_NSFW_MODEL_ID) || DEFAULT_MEDIA_NSFW_MODEL_ID
  const violenceModel = envString(import.meta.env.VITE_MEDIA_MODERATION_VIOLENCE_MODEL_ID) || DEFAULT_MEDIA_VIOLENCE_MODEL_ID

  const geminiKey = envString(import.meta.env.VITE_GEMINI_API_KEY).trim()

  return [
    {
      component: 'Search intent router (transformers)',
      runtime: 'transformers.js worker',
      model: routerTransformersModel,
      job: 'Classify query intent: lexical/semantic/hybrid',
      output: 'single label',
      source: 'VITE_ROUTER_MODEL_ID',
      status: routerRuntime === 'transformers' ? 'active' : 'configured',
    },
    {
      component: 'Search intent router (WebLLM)',
      runtime: 'webllm worker',
      model: routerWebllmModel,
      job: 'Classify query intent: lexical/semantic/hybrid',
      output: 'single label',
      source: 'VITE_WEBLLM_MODEL_ID',
      status: routerRuntime === 'webllm' ? 'active' : 'configured',
    },
    {
      component: 'Search intent router (LiteRT)',
      runtime: 'litert worker',
      model: routerLiteRtModel,
      job: 'Classify query intent with deterministic decode (temp=0, topK=1)',
      output: 'single label',
      source: 'VITE_ROUTER_LITERT_MODEL_PATH',
      status: routerRuntime === 'litert' ? 'active' : 'configured',
    },
    {
      component: 'Search grounded answer',
      runtime: `litert ui session (${groundedLiteRtWasm})`,
      model: groundedLiteRtModel,
      job: 'Generate grounded answer from retrieved events/profiles',
      output: 'free-form text',
      source: 'VITE_LITERT_MODEL_PATH',
      status: 'active',
    },
    {
      component: 'Semantic retrieval/rerank',
      runtime: 'transformers.js semantic worker',
      model: semanticModel,
      job: 'Create embeddings and rerank candidates by cosine similarity',
      output: 'scored matches',
      source: 'VITE_SEMANTIC_MODEL_ID',
      status: 'active',
    },
    {
      component: 'Text moderation',
      runtime: 'transformers.js moderation worker',
      model: moderationModel,
      job: 'Score toxicity/threat labels then apply policy thresholds',
      output: 'allow/block decision',
      source: 'VITE_MODERATION_MODEL_ID',
      status: 'active',
    },
    {
      component: 'Media moderation NSFW',
      runtime: 'transformers.js media worker',
      model: nsfwModel,
      job: 'Detect explicit/adult visual content',
      output: 'nsfw score and decision input',
      source: 'VITE_MEDIA_MODERATION_NSFW_MODEL_ID',
      status: 'active',
    },
    {
      component: 'Media moderation violence',
      runtime: 'transformers.js media worker',
      model: violenceModel,
      job: 'Detect violence/gore visual content',
      output: 'violence score and decision input',
      source: 'VITE_MEDIA_MODERATION_VIOLENCE_MODEL_ID',
      status: 'active',
    },
    {
      component: 'Google Gemini enhancer',
      runtime: 'remote API (not currently invoked)',
      model: geminiKey ? 'API key present' : 'No API key in runtime env',
      job: 'Potential query/content enhancement',
      output: 'n/a',
      source: 'VITE_GEMINI_API_KEY',
      status: geminiKey ? 'not-wired' : 'missing',
    },
  ]
}
