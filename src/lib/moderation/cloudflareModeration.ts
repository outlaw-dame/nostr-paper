/**
 * Enhanced Content Moderation with Cloudflare Workers AI.
 * 
 * Supports:
 * - Cloudflare Llama Guard 3 (primary: specialized safety model)
 * - ONNX browser models (fallback)
 * - Rule-based classification (final fallback)
 */

import {
  analyzeContentSafety,
  isCloudflareAiAvailable,
} from '@/lib/ai/cloudflareAiProviders'
import { routeContentModeration } from '@/lib/ai/taskRouting'
import { withRetry } from '@/lib/retry'

export type ModerationLabel =
  | 'toxic'
  | 'severe_toxic'
  | 'obscene'
  | 'threat'
  | 'insult'
  | 'identity_hate'
  | 'safe'

export interface ModerationDecision {
  isSafe: boolean
  labels: ModerationLabel[]
  confidence: number
  source: 'cloudflare' | 'onnx_model' | 'rule_based'
  explanations?: string[]
}

// ── Cloudflare Moderation Provider ──────────────────────────────

/**
 * Use Cloudflare Llama Guard 3 for content safety analysis.
 * Specialized model trained for prompt/response classification.
 */
async function moderateWithCloudflare(content: string, isPrompt = true): Promise<ModerationDecision> {
  try {
    const response = await withRetry(
      () => analyzeContentSafety(content, isPrompt),
      { maxAttempts: 2, baseDelayMs: 300 }
    )

    // Llama Guard returns text like: "safe" or "unsafe\n<category>"
    const lines = response.toLowerCase().trim().split('\n')
    const status = lines[0]
    const isSafe = status.includes('safe') && !status.includes('unsafe')

    const labels: ModerationLabel[] = []
    if (!isSafe && lines.length > 1) {
      const categories = lines.slice(1).join(' ').split(',')
      for (const cat of categories) {
        const trimmed = cat.trim()
        if (
          trimmed.includes('toxic') ||
          trimmed.includes('violence') ||
          trimmed.includes('hate')
        ) {
          if (trimmed.includes('severe')) labels.push('severe_toxic')
          else labels.push('toxic')
        }
        if (trimmed.includes('obscene')) labels.push('obscene')
        if (trimmed.includes('threat') || trimmed.includes('violence'))
          labels.push('threat')
        if (trimmed.includes('insult') || trimmed.includes('abusive'))
          labels.push('insult')
        if (trimmed.includes('identity') || trimmed.includes('hate'))
          labels.push('identity_hate')
      }
    }

    return {
      isSafe,
      labels: [...new Set(labels)],
      confidence: 0.92,
      source: 'cloudflare',
      explanations: [response],
    }
  } catch (error) {
    console.warn('Cloudflare moderation failed:', error)
    throw error
  }
}

// ── Rule-Based Fallback Moderation ──────────────────────────────

interface ToxicityWeights {
  toxic: number
  severe_toxic: number
  obscene: number
  threat: number
  insult: number
  identity_hate: number
}

const KNOWN_TOXIC_PATTERNS: Record<string, ModerationLabel> = {
  // Severe threats
  'kill.*you': 'threat',
  'die.*hard': 'threat',
  'i.*hurt': 'threat',
  // Obscenity
  'fuck': 'obscene',
  'shit': 'obscene',
  // Identity hate
  'nigger': 'identity_hate',
  'faggot': 'identity_hate',
  // Insults
  'stupid': 'insult',
  'idiot': 'insult',
  'dumb': 'insult',
  'ass.*hole': 'insult',
  // Generic toxicity
  'asshole': 'toxic',
  'bastard': 'toxic',
  'bitch': 'toxic',
}

function ruleBasedModeration(content: string): ModerationDecision {
  const lowerContent = content.toLowerCase()
  const labels: Set<ModerationLabel> = new Set()
  let confidence = 0

  // Check for known toxic patterns
  for (const [pattern, label] of Object.entries(KNOWN_TOXIC_PATTERNS)) {
    if (new RegExp(pattern, 'i').test(lowerContent)) {
      labels.add(label)
      confidence = Math.max(confidence, 0.7)
    }
  }

  // Check for excessive caps
  const capsRatio = (content.match(/[A-Z]/g) ?? []).length / content.length
  if (capsRatio > 0.5 && content.length > 10) {
    labels.add('insult')
    confidence = Math.max(confidence, 0.6)
  }

  // Check for excessive punctuation
  const punctRatio = (content.match(/[!?]{2,}/g) ?? []).length
  if (punctRatio > 3) {
    labels.add('insult')
    confidence = Math.max(confidence, 0.5)
  }

  const isSafe = labels.size === 0

  return {
    isSafe,
    labels: Array.from(labels),
    confidence,
    source: 'rule_based',
  }
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Moderate content with intelligent routing.
 * Tries Cloudflare first, falls back to rule-based.
 */
export async function moderateContent(
  content: string,
  options?: {
    isPrompt?: boolean
    requireConfidence?: number
  }
): Promise<ModerationDecision> {
  const decision = routeContentModeration()
  const isPrompt = options?.isPrompt ?? true
  const minConfidence = options?.requireConfidence ?? 0.7

  // Try Cloudflare Llama Guard
  if (
    decision.tier === 'cloudflare_specialized' &&
    isCloudflareAiAvailable()
  ) {
    try {
      const result = await moderateWithCloudflare(content, isPrompt)
      if (result.confidence >= minConfidence) {
        return result
      }
    } catch (err) {
      console.warn('Cloudflare moderation failed, trying rule-based:', err)
    }
  }

  // Fall back to rule-based
  return ruleBasedModeration(content)
}

/**
 * Batch moderate multiple contents.
 */
export async function moderateContentBatch(
  contents: string[],
  options?: {
    isPrompt?: boolean
    requireConfidence?: number
  }
): Promise<ModerationDecision[]> {
  return Promise.all(
    contents.map((content) => moderateContent(content, options))
  )
}

/**
 * Get moderation score (0-1, where 1 is completely unsafe).
 */
export async function getModerationScore(content: string): Promise<number> {
  const decision = await moderateContent(content)
  const labelPenalties: Record<ModerationLabel, number> = {
    severe_toxic: 1.0,
    threat: 0.95,
    identity_hate: 0.9,
    toxic: 0.7,
    obscene: 0.6,
    insult: 0.4,
    safe: 0,
  }

  if (decision.isSafe) return 0

  const maxPenalty = Math.max(
    ...decision.labels.map((label) => labelPenalties[label] ?? 0.5)
  )
  return maxPenalty * (decision.confidence / 1.0)
}

/**
 * Check if content is safe for the platform.
 */
export async function isContentSafe(content: string, threshold = 0.5): Promise<boolean> {
  const score = await getModerationScore(content)
  return score < threshold
}
