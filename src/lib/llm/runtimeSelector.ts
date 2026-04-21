export type LlmRuntime = 'transformers' | 'webllm' | 'litert'

function normalizeRuntime(value: unknown): LlmRuntime {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (normalized === 'webllm') return 'webllm'
  if (normalized === 'litert') return 'litert'
  return 'transformers'
}

export function getRouterRuntime(): LlmRuntime {
  return normalizeRuntime(import.meta.env.VITE_ROUTER_RUNTIME)
}
