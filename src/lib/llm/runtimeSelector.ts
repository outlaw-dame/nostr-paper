import { decideRouterRuntime } from '@/lib/ai/taskPolicy'

export type LlmRuntime = 'transformers' | 'webllm' | 'litert' | 'cloudflare'

function normalizeRuntime(value: unknown): LlmRuntime {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (normalized === 'cloudflare' || normalized === 'cf') return 'cloudflare'
  if (normalized === 'webllm') return 'webllm'
  if (normalized === 'litert' || normalized === 'mediapipe' || normalized === 'mediapipeline') return 'litert'
  return 'transformers'
}

export function getRouterRuntime(): LlmRuntime {
  const raw = typeof import.meta.env.VITE_ROUTER_RUNTIME === 'string'
    ? import.meta.env.VITE_ROUTER_RUNTIME.trim().toLowerCase()
    : ''

  if (raw === 'auto' || raw === 'functiongemma') {
    return decideRouterRuntime('').runtime
  }

  return normalizeRuntime(import.meta.env.VITE_ROUTER_RUNTIME)
}
