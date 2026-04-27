import type { TranslationConfiguration, TranslationProvider } from '@/lib/translation/storage'
import type { AiAssistProvider } from '@/lib/ai/gemmaAssist'

export type RouterRuntime = 'transformers' | 'webllm' | 'litert' | 'cloudflare'
export type AiTask = 'search_intent' | 'translation' | 'moderation_referee'
export type AiExecutionTier = 'local' | 'browser' | 'edge' | 'api'

export interface TaskPolicyDecision {
  task: AiTask
  tier: AiExecutionTier
  runtime: string
  fallback: string[]
  routerModel: string
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

  // FunctionGemma policy: keep private/fast work local when possible.
  if (offline) {
    runtime = 'litert'
    fallback = ['transformers']
    tier = 'local'
  } else if (longQuery && edgeAvailable && lowDevice) {
    runtime = 'cloudflare'
    fallback = ['litert', 'transformers']
    tier = 'edge'
  } else if (lowDevice && edgeAvailable) {
    runtime = 'cloudflare'
    fallback = ['litert', 'transformers']
    tier = 'edge'
  } else {
    runtime = 'litert'
    fallback = edgeAvailable ? ['cloudflare', 'transformers'] : ['transformers', 'webllm']
    tier = 'local'
  }

  return {
    runtime,
    fallback,
    decision: {
      task: 'search_intent',
      tier,
      runtime,
      fallback,
      routerModel,
    },
  }
}

export function decideTranslationProvider(
  configuration: TranslationConfiguration,
  normalizedText: string,
): { provider: TranslationProvider; decision: TaskPolicyDecision } {
  const routerModel = getTaskRouterModel()
  const explicitProvider = configuration.provider
  if (!isHybridTranslationPolicyEnabled()) {
    return {
      provider: explicitProvider,
      decision: {
        task: 'translation',
        tier: explicitProvider === 'gemini' ? 'api' : 'browser',
        runtime: explicitProvider,
        fallback: ['opusmt'],
        routerModel,
      },
    }
  }

  const geminiAvailable = hasGeminiApiAccess() || envString(configuration.geminiApiKey).length > 0
  const offline = isLikelyOffline()
  const lowDevice = estimateDeviceClass() === 'low'
  const textLength = normalizedText.length

  if (explicitProvider === 'gemma' || explicitProvider === 'gemini') {
    return {
      provider: explicitProvider,
      decision: {
        task: 'translation',
        tier: explicitProvider === 'gemini' ? 'api' : 'local',
        runtime: explicitProvider,
        fallback: explicitProvider === 'gemini' ? ['gemma', 'opusmt'] : ['opusmt', 'gemini'],
        routerModel,
      },
    }
  }

  if (!offline && geminiAvailable && textLength >= 1000) {
    return {
      provider: 'gemini',
      decision: {
        task: 'translation',
        tier: 'api',
        runtime: 'gemini',
        fallback: ['gemma', 'opusmt'],
        routerModel,
      },
    }
  }

  if (offline || lowDevice || textLength <= 320) {
    return {
      provider: 'gemma',
      decision: {
        task: 'translation',
        tier: 'local',
        runtime: 'gemma',
        fallback: ['opusmt', 'gemini'],
        routerModel,
      },
    }
  }

  return {
    provider: explicitProvider,
    decision: {
      task: 'translation',
      tier: 'browser',
      runtime: explicitProvider,
      fallback: ['opusmt', 'gemma', 'gemini'],
      routerModel,
    },
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
    return {
      provider,
      decision: {
        task: 'moderation_referee',
        tier: provider === 'auto' ? 'local' : 'local',
        runtime: provider,
        fallback: provider === 'auto' ? ['gemma', 'gemini'] : ['auto'],
        routerModel,
      },
    }
  }

  const offline = isLikelyOffline()
  const geminiAvailable = hasGeminiApiAccess()

  if (!input.allowRemote || offline) {
    return {
      provider: 'gemma',
      decision: {
        task: 'moderation_referee',
        tier: 'local',
        runtime: 'gemma',
        fallback: ['auto'],
        routerModel,
      },
    }
  }

  if (geminiAvailable && (input.maxDocumentLength >= 900 || input.candidateCount >= 12)) {
    return {
      provider: 'gemini',
      decision: {
        task: 'moderation_referee',
        tier: 'api',
        runtime: 'gemini',
        fallback: ['auto', 'gemma'],
        routerModel,
      },
    }
  }

  return {
    provider: 'auto',
    decision: {
      task: 'moderation_referee',
      tier: 'local',
      runtime: 'auto',
      fallback: ['gemma', 'gemini'],
      routerModel,
    },
  }
}
