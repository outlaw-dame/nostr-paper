/**
 * AI Task Routing: Intelligent decision system for choosing between
 * Cloudflare edge models, browser models, and local models.
 * 
 * Strategy:
 * - Heavy/complex tasks → Cloudflare primary LLM (70B) for best quality + edge latency
 * - Lightweight tasks → Cloudflare fast model (8B) for speed
 * - Low-memory devices → Always prefer Cloudflare edge
 * - Offline → Fall back to browser/local models
 * - Not configured → Use browser/local only
 */

import { isCloudflareAiAvailable } from '@/lib/ai/cloudflareAiProviders'

export type AiTaskType =
  | 'compose_assist_caution'    // Detect caution signals in compose
  | 'compose_assist_quality'     // Improve text quality
  | 'profile_insights'            // Generate profile insights
  | 'article_summary'             // Summarize articles/threads
  | 'search_intent_classify'      // Classify search intent
  | 'moderation_safety'           // Content safety classification
  | 'translation'                 // Translate text
  | 'embedding_search'            // Generate embeddings for search

export type TaskExecutionTier =
  | 'cloudflare_primary'   // Edge, 70B LLM, high quality
  | 'cloudflare_fast'      // Edge, 8B LLM, low latency
  | 'cloudflare_specialized' // Edge, specialized model (moderation, translation, etc)
  | 'browser'              // WebLLM or local ONNX
  | 'local_cpu'            // LiteRT or Transformers.js
  | 'fallback'             // Simple heuristic/rule-based

export interface TaskRoutingDecision {
  task: AiTaskType
  tier: TaskExecutionTier
  rationale: string[]
  priority: 'critical' | 'high' | 'normal' | 'low'
  timeout_ms: number
  fallback: TaskExecutionTier[]
}

// ── Device & Network Detection ──────────────────────────────────

function estimateDeviceClass(): 'low' | 'mid' | 'high' {
  if (typeof navigator === 'undefined') return 'high'

  // Check device memory (if available)
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (typeof mem === 'number' && mem > 0) {
    if (mem <= 2) return 'low'
    if (mem <= 8) return 'mid'
    return 'high'
  }

  // Fallback: assume high-end device
  return 'high'
}

function isLikelyOffline(): boolean {
  if (typeof navigator === 'undefined') return false
  return navigator.onLine === false
}

function isHighLatencyNetwork(): boolean {
  if (typeof navigator !== 'undefined' && 'connection' in navigator) {
    const conn = (navigator as Navigator & { connection?: { effectiveType: string } }).connection
    if (conn?.effectiveType === '4g' || conn?.effectiveType === 'wifi') return false
    if (conn?.effectiveType === '3g' || conn?.effectiveType === '2g') return true
  }
  return false
}

// ── Task-Specific Routing ───────────────────────────────────────

/**
 * Route compose assistance (caution detection) task.
 * Heavy task that benefits from edge inference.
 */
export function routeComposeAssistCaution(): TaskRoutingDecision {
  const offline = isLikelyOffline()
  const cloudflareAvailable = isCloudflareAiAvailable()
  const lowMemory = estimateDeviceClass() === 'low'

  const rationale: string[] = []
  let tier: TaskExecutionTier = 'local_cpu'
  let fallback: TaskExecutionTier[] = ['browser', 'fallback']

  if (offline) {
    tier = 'local_cpu'
    rationale.push('offline_mode')
  } else if (lowMemory && cloudflareAvailable) {
    tier = 'cloudflare_fast'
    fallback = ['local_cpu', 'browser', 'fallback']
    rationale.push('low_memory_device', 'cloudflare_available')
  } else if (cloudflareAvailable) {
    tier = 'cloudflare_fast'
    fallback = ['local_cpu', 'browser', 'fallback']
    rationale.push('cloudflare_fast_preferred')
  }

  return {
    task: 'compose_assist_caution',
    tier,
    rationale,
    priority: 'high',
    timeout_ms: tier === 'cloudflare_fast' ? 3000 : 8000,
    fallback,
  }
}

/**
 * Route compose assistance (quality improvement) task.
 * Heavy task best suited for Cloudflare primary LLM.
 */
export function routeComposeAssistQuality(): TaskRoutingDecision {
  const offline = isLikelyOffline()
  const cloudflareAvailable = isCloudflareAiAvailable()
  const lowMemory = estimateDeviceClass() === 'low'

  const rationale: string[] = []
  let tier: TaskExecutionTier = 'browser'
  let fallback: TaskExecutionTier[] = ['cloudflare_fast', 'local_cpu', 'fallback']

  if (offline) {
    tier = 'browser'
    rationale.push('offline_mode')
  } else if (cloudflareAvailable) {
    tier = 'cloudflare_primary'
    fallback = ['browser', 'cloudflare_fast', 'local_cpu']
    rationale.push('cloudflare_primary_best_quality')
  } else {
    tier = 'browser'
  }

  return {
    task: 'compose_assist_quality',
    tier,
    rationale,
    priority: 'high',
    timeout_ms: tier === 'cloudflare_primary' ? 4000 : 10000,
    fallback,
  }
}

/**
 * Route profile insights generation (complex, heavy task).
 * Best suited for Cloudflare primary LLM.
 */
export function routeProfileInsights(): TaskRoutingDecision {
  const offline = isLikelyOffline()
  const cloudflareAvailable = isCloudflareAiAvailable()

  const rationale: string[] = []
  let tier: TaskExecutionTier = 'browser'
  let fallback: TaskExecutionTier[] = ['cloudflare_fast', 'local_cpu', 'fallback']

  if (offline) {
    tier = 'fallback'
    rationale.push('offline_no_insights')
    fallback = []
  } else if (cloudflareAvailable) {
    tier = 'cloudflare_primary'
    fallback = ['browser', 'cloudflare_fast', 'fallback']
    rationale.push('cloudflare_primary_best_quality')
  } else {
    tier = 'browser'
  }

  return {
    task: 'profile_insights',
    tier,
    rationale,
    priority: 'normal',
    timeout_ms: tier === 'cloudflare_primary' ? 5000 : 15000,
    fallback,
  }
}

/**
 * Route article/thread summarization (heavy task).
 */
export function routeArticleSummary(): TaskRoutingDecision {
  const offline = isLikelyOffline()
  const cloudflareAvailable = isCloudflareAiAvailable()
  const highLatency = isHighLatencyNetwork()

  const rationale: string[] = []
  let tier: TaskExecutionTier = 'browser'
  let fallback: TaskExecutionTier[] = ['cloudflare_fast', 'local_cpu', 'fallback']

  if (offline) {
    tier = 'fallback'
    rationale.push('offline_no_summarization')
  } else if (highLatency) {
    tier = 'browser'
    rationale.push('high_latency_prefer_local')
  } else if (cloudflareAvailable) {
    tier = 'cloudflare_primary'
    fallback = ['browser', 'cloudflare_fast', 'fallback']
    rationale.push('cloudflare_primary_for_complex_summary')
  }

  return {
    task: 'article_summary',
    tier,
    rationale,
    priority: 'normal',
    timeout_ms: tier === 'cloudflare_primary' ? 6000 : 20000,
    fallback,
  }
}

/**
 * Route search intent classification (lightweight task).
 */
export function routeSearchIntentClassify(): TaskRoutingDecision {
  const offline = isLikelyOffline()
  const cloudflareAvailable = isCloudflareAiAvailable()
  const lowMemory = estimateDeviceClass() === 'low'

  const rationale: string[] = []
  let tier: TaskExecutionTier = 'local_cpu'
  let fallback: TaskExecutionTier[] = ['cloudflare_fast', 'browser', 'fallback']

  if (offline) {
    tier = 'local_cpu'
    rationale.push('offline_local_preferred')
  } else if (lowMemory && cloudflareAvailable) {
    tier = 'cloudflare_fast'
    fallback = ['local_cpu', 'browser']
    rationale.push('low_memory_cloudflare_edge')
  } else {
    tier = 'local_cpu'
  }

  return {
    task: 'search_intent_classify',
    tier,
    rationale,
    priority: 'critical',
    timeout_ms: tier === 'cloudflare_fast' ? 2000 : 3000,
    fallback,
  }
}

/**
 * Route content safety/moderation (specialized task).
 * Use Cloudflare's Llama Guard model when available.
 */
export function routeContentModeration(): TaskRoutingDecision {
  const offline = isLikelyOffline()
  const cloudflareAvailable = isCloudflareAiAvailable()

  const rationale: string[] = []
  let tier: TaskExecutionTier = 'browser'
  let fallback: TaskExecutionTier[] = ['cloudflare_specialized', 'fallback']

  if (offline) {
    tier = 'browser'
    rationale.push('offline_browser_only')
  } else if (cloudflareAvailable) {
    tier = 'cloudflare_specialized'
    fallback = ['browser', 'fallback']
    rationale.push('cloudflare_llama_guard_specialized')
  }

  return {
    task: 'moderation_safety',
    tier,
    rationale,
    priority: 'high',
    timeout_ms: tier === 'cloudflare_specialized' ? 2000 : 5000,
    fallback,
  }
}

/**
 * Route translation (specialized task).
 * Use Cloudflare's M2M100 model for multilingual support.
 */
export function routeTranslation(textLength: number): TaskRoutingDecision {
  const offline = isLikelyOffline()
  const cloudflareAvailable = isCloudflareAiAvailable()
  const longText = textLength > 500

  const rationale: string[] = []
  let tier: TaskExecutionTier = 'browser'
  let fallback: TaskExecutionTier[] = ['cloudflare_specialized', 'fallback']

  if (offline) {
    tier = 'browser'
    rationale.push('offline_browser_only')
  } else if (longText && cloudflareAvailable) {
    tier = 'cloudflare_specialized'
    fallback = ['browser', 'fallback']
    rationale.push('long_text_cloudflare_m2m100')
  } else if (cloudflareAvailable) {
    tier = 'cloudflare_specialized'
    fallback = ['browser', 'fallback']
    rationale.push('cloudflare_m2m100_multilingual')
  }

  return {
    task: 'translation',
    tier,
    rationale,
    priority: 'normal',
    timeout_ms: tier === 'cloudflare_specialized' ? 3000 : 8000,
    fallback,
  }
}

/**
 * Route embedding generation for semantic search.
 */
export function routeEmbeddingSearch(textLength: number): TaskRoutingDecision {
  const offline = isLikelyOffline()
  const cloudflareAvailable = isCloudflareAiAvailable()
  const longText = textLength > 1000

  const rationale: string[] = []
  let tier: TaskExecutionTier = 'browser'
  let fallback: TaskExecutionTier[] = ['cloudflare_specialized', 'fallback']

  if (offline) {
    tier = 'browser'
    rationale.push('offline_browser_embedding')
  } else if (cloudflareAvailable) {
    tier = 'cloudflare_specialized'
    fallback = ['browser', 'fallback']
    rationale.push('cloudflare_embeddinggemma_fast')
  }

  return {
    task: 'embedding_search',
    tier,
    rationale,
    priority: 'low',
    timeout_ms: tier === 'cloudflare_specialized' ? 1500 : 5000,
    fallback,
  }
}

/**
 * Central routing dispatcher for any AI task.
 */
export function routeAiTask(task: AiTaskType, context: Record<string, unknown> = {}): TaskRoutingDecision {
  switch (task) {
    case 'compose_assist_caution':
      return routeComposeAssistCaution()
    case 'compose_assist_quality':
      return routeComposeAssistQuality()
    case 'profile_insights':
      return routeProfileInsights()
    case 'article_summary':
      return routeArticleSummary()
    case 'search_intent_classify':
      return routeSearchIntentClassify()
    case 'moderation_safety':
      return routeContentModeration()
    case 'translation':
      return routeTranslation((context.textLength as number) ?? 0)
    case 'embedding_search':
      return routeEmbeddingSearch((context.textLength as number) ?? 0)
    default:
      throw new Error(`Unknown task: ${task}`)
  }
}
