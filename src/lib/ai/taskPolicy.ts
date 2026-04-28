import type { TranslationConfiguration, TranslationProvider } from '@/lib/translation/storage'
import type { AiAssistProvider } from '@/lib/ai/gemmaAssist'
import { recordTaskPolicyDecision } from '@/lib/ai/taskPolicyTelemetry'

export type RouterRuntime = 'transformers' | 'webllm' | 'litert' | 'cloudflare'
export type AiTask = 'search_intent' | 'translation' | 'moderation_referee'
export type AiExecutionTier = 'local' | 'browser' | 'edge' | 'api'

export interface TaskPolicyDecision {
  task: AiTask
  tier: AiExecutionTier
  runtime: string
  fallback: string[]
  routerModel: string
  confidence: number
  rationale: string[]
}

const DEFAULT_FUNCTION_GEMMA_MODEL = 'FunctionGemma-v1'

function envString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function getTaskRouterModel(): string {
  const configured = envString(import.meta.env.VITE_AI_POLICY_ROUTER_MODEL)
  return configured || DEFAULT_FUNCTION_GEMMA_MODEL
}

function hasCloudflareEdgeAccess(): boolean {
  return Boolean(envString(import.meta.env.VITE_CLOUDFLARE_ACCOUNT_ID) && envString(import.meta.env.VITE_CLOUDFLARE_API_TOKEN))
}

function hasGeminiApiAccess(): boolean {
  return Boolean(envString(import.meta.env.VITE_GEMINI_API_KEY))
}

function isHybridTranslationPolicyEnabled(): boolean {
  return import.meta.env.VITE_AI_POLICY_HYBRID_TRANSLATION === 'true'
}

function isHybridModerationPolicyEnabled(): boolean {
  return import.meta.env.VITE_AI_POLICY_HYBRID_MODERATION === 'true'
}

function isLikelyOffline(): boolean {
  if (typeof navigator === 'undefined') return false
  return navigator.onLine === false
}

function estimateDeviceClass(): 'low' | 'high' {
  if (typeof navigator === 'undefined') return 'high'
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  return typeof mem === 'number' && mem > 0 && mem <= 4 ? 'low' : 'high'
}

export function decideRouterRuntime(query: string): { runtime: RouterRuntime; fallback: RouterRuntime[]; decision: TaskPolicyDecision } {
  const routerModel = getTaskRouterModel()
  const offline = isLikelyOffline()
  const lowDevice = estimateDeviceClass() === 'low'
  const edgeAvailable = hasCloudflareEdgeAccess()
  const longQuery = query.trim().length >= 140

  let runtime: RouterRuntime = 'transformers'
  let fallback: RouterRuntime[] = ['litert', 'webllm']
  let tier: AiExecutionTier = 'browser'
  let confidence = 0.66
  const rationale: string[] = []

  // FunctionGemma policy: keep private/fast work local when possible.
  if (offline) {
    runtime = 'litert'
    fallback = ['transformers']
    tier = 'local'
    confidence = 0.95
    rationale.push('offline_mode')
  } else if (longQuery && edgeAvailable && lowDevice) {
    runtime = 'cloudflare'
    fallback = ['litert', 'transformers']
    tier = 'edge'
    confidence = 0.86
    rationale.push('long_query', 'low_memory_device', 'edge_available')
  } else if (lowDevice && edgeAvailable) {
    runtime = 'cloudflare'
    fallback = ['litert', 'transformers']
    tier = 'edge'
    confidence = 0.81
    rationale.push('low_memory_device', 'edge_available')
  } else {
    runtime = 'litert'
    fallback = edgeAvailable ? ['cloudflare', 'transformers'] : ['transformers', 'webllm']
    tier = 'local'
    confidence = 0.74
    rationale.push('local_first')
  }

  const decision: TaskPolicyDecision = {
    task: 'search_intent',
    tier,
    runtime,
    fallback,
    routerModel,
    confidence,
    rationale,
  }

  recordTaskPolicyDecision(decision, {
    queryLength: query.trim().length,
    edgeAvailable,
    deviceClass: lowDevice ? 'low' : 'high',
  })

  return {
    runtime,
    fallback,
    decision,
  }
}

export function decideTranslationProvider(
  configuration: TranslationConfiguration,
  normalizedText: string,
): { provider: TranslationProvider; decision: TaskPolicyDecision } {
  const routerModel = getTaskRouterModel()
  const explicitProvider = configuration.provider
  if (!isHybridTranslationPolicyEnabled()) {
    const decision: TaskPolicyDecision = {
      task: 'translation',
      tier: explicitProvider === 'gemini' ? 'api' : 'browser',
      runtime: explicitProvider,
      fallback: ['opusmt'],
      routerModel,
      confidence: 0.9,
      rationale: ['hybrid_translation_disabled', 'respect_explicit_provider'],
    }
    recordTaskPolicyDecision(decision)
    return {
      provider: explicitProvider,
      decision,
    }
  }

  const geminiAvailable = hasGeminiApiAccess() || envString(configuration.geminiApiKey).length > 0
  const offline = isLikelyOffline()
  const lowDevice = estimateDeviceClass() === 'low'
  const textLength = normalizedText.length

  if (explicitProvider === 'gemma' || explicitProvider === 'gemini') {
    const decision: TaskPolicyDecision = {
      task: 'translation',
      tier: explicitProvider === 'gemini' ? 'api' : 'local',
      runtime: explicitProvider,
      fallback: explicitProvider === 'gemini' ? ['gemma', 'opusmt'] : ['opusmt', 'gemini'],
      routerModel,
      confidence: 0.93,
      rationale: ['explicit_provider_selected'],
    }
    recordTaskPolicyDecision(decision, { textLength })
    return {
      provider: explicitProvider,
      decision,
    }
  }

  if (!offline && geminiAvailable && textLength >= 1000) {
    const decision: TaskPolicyDecision = {
      task: 'translation',
      tier: 'api',
      runtime: 'gemini',
      fallback: ['gemma', 'opusmt'],
      routerModel,
      confidence: 0.84,
      rationale: ['long_text', 'gemini_available'],
    }
    recordTaskPolicyDecision(decision, { textLength })
    return {
      provider: 'gemini',
      decision,
    }
  }

  if (offline || lowDevice || textLength <= 320) {
    const decision: TaskPolicyDecision = {
      task: 'translation',
      tier: 'local',
      runtime: 'gemma',
      fallback: ['opusmt', 'gemini'],
      routerModel,
      confidence: 0.8,
      rationale: [
        ...(offline ? ['offline_mode'] : []),
        ...(lowDevice ? ['low_memory_device'] : []),
        ...(textLength <= 320 ? ['short_text'] : []),
      ],
    }
    recordTaskPolicyDecision(decision, { textLength })
    return {
      provider: 'gemma',
      decision,
    }
  }

  const decision: TaskPolicyDecision = {
    task: 'translation',
    tier: 'browser',
    runtime: explicitProvider,
    fallback: ['opusmt', 'gemma', 'gemini'],
    routerModel,
    confidence: 0.72,
    rationale: ['provider_default_fallback_path'],
  }
  recordTaskPolicyDecision(decision, { textLength })

  return {
    provider: explicitProvider,
    decision,
  }
}

export function decideModerationAssistProvider(input: {
  allowRemote: boolean
  candidateCount: number
  maxDocumentLength: number
}): { provider: AiAssistProvider; decision: TaskPolicyDecision } {
  const routerModel = getTaskRouterModel()
  if (!isHybridModerationPolicyEnabled()) {
    const provider: AiAssistProvider = input.allowRemote ? 'auto' : 'gemma'
    const decision: TaskPolicyDecision = {
      task: 'moderation_referee',
      tier: provider === 'auto' ? 'local' : 'local',
      runtime: provider,
      fallback: provider === 'auto' ? ['gemma', 'gemini'] : ['auto'],
      routerModel,
      confidence: 0.9,
      rationale: ['hybrid_moderation_disabled'],
    }
    recordTaskPolicyDecision(decision, input)
    return {
      provider,
      decision,
    }
  }

  const offline = isLikelyOffline()
  const geminiAvailable = hasGeminiApiAccess()

  if (!input.allowRemote || offline) {
    const decision: TaskPolicyDecision = {
      task: 'moderation_referee',
      tier: 'local',
      runtime: 'gemma',
      fallback: ['auto'],
      routerModel,
      confidence: 0.92,
      rationale: [
        ...(!input.allowRemote ? ['remote_disallowed'] : []),
        ...(offline ? ['offline_mode'] : []),
      ],
    }
    recordTaskPolicyDecision(decision, input)
    return {
      provider: 'gemma',
      decision,
    }
  }

  if (geminiAvailable && (input.maxDocumentLength >= 900 || input.candidateCount >= 12)) {
    const decision: TaskPolicyDecision = {
      task: 'moderation_referee',
      tier: 'api',
      runtime: 'gemini',
      fallback: ['auto', 'gemma'],
      routerModel,
      confidence: 0.83,
      rationale: ['complex_or_large_payload', 'gemini_available'],
    }
    recordTaskPolicyDecision(decision, input)
    return {
      provider: 'gemini',
      decision,
    }
  }

  const decision: TaskPolicyDecision = {
    task: 'moderation_referee',
    tier: 'local',
    runtime: 'auto',
    fallback: ['gemma', 'gemini'],
    routerModel,
    confidence: 0.7,
    rationale: ['default_auto_provider'],
  }
  recordTaskPolicyDecision(decision, input)

  return {
    provider: 'auto',
    decision,
  }
}
