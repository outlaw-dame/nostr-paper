/**
 * Enhanced AI Assist with Cloudflare Workers AI fallback/upgrade.
 * 
 * Strategy:
 * - Try Cloudflare edge first for heavy tasks (if available & online)
 * - Fall back to Gemma (browser) if edge fails
 * - Final fallback to Gemini API if available
 * - Heuristic rules if all AI is unavailable
 */

import { generateText, isGemmaAvailable } from '@/lib/gemma/client'
import { generateGeminiAssistText } from '@/lib/ai/gemmaAssist'
import {
  generateWithPrimaryLlm,
  generateWithFastLlm,
  isCloudflareAiAvailable,
} from '@/lib/ai/cloudflareAiProviders'
import {
  routeAiTask,
  type AiTaskType,
  type TaskRoutingDecision,
} from '@/lib/ai/taskRouting'
import { withRetry } from '@/lib/retry'

// ── Configuration ───────────────────────────────────────────────

const MAX_OUTPUT_CHARS = 1200
const ASSIST_QUALITY_THRESHOLD = 0.52

// ── Utilities ────────────────────────────────────────────────────

function sanitizeModelOutput(value: string): string {
  const withoutFences = value
    .replace(/```[a-zA-Z]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (withoutFences.length <= MAX_OUTPUT_CHARS) return withoutFences
  return `${withoutFences.slice(0, MAX_OUTPUT_CHARS - 1)}…`
}

function shouldRetryCloudflareError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return false
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('401') || message.includes('403')) return false
  if (message.includes('rate limit')) return true
  if (message.includes('timeout')) return true
  return true
}

// ── Task-Specific Assist Functions ──────────────────────────────

/**
 * Generate compose assistance text with intelligent routing.
 * Uses Cloudflare for quality improvement, falls back to Gemma.
 */
export async function generateComposeAssistText(
  prompt: string,
  signal?: AbortSignal
): Promise<{ text: string; source: 'cloudflare' | 'gemma' | 'gemini' | 'fallback'; quality: number }> {
  const decision = routeAiTask('compose_assist_quality', { textLength: prompt.length })

  // Try Cloudflare primary LLM first (best quality)
  if (decision.tier === 'cloudflare_primary' && isCloudflareAiAvailable()) {
    try {
      const text = await withRetry(
        () => generateWithPrimaryLlm(prompt, { maxTokens: 512, temperature: 0.25 }),
        { maxAttempts: 1, baseDelayMs: 300, shouldRetry: shouldRetryCloudflareError }
      )
      return { text: sanitizeModelOutput(text), source: 'cloudflare', quality: 0.9 }
    } catch (err) {
      console.warn('Cloudflare primary LLM failed, falling back:', err)
    }
  }

  // Try Gemma (local browser)
  if (isGemmaAvailable()) {
    try {
      const text = await generateText(prompt, signal ? { signal } : {})
      return { text: sanitizeModelOutput(text), source: 'gemma', quality: 0.7 }
    } catch (err) {
      console.warn('Gemma failed, trying Gemini:', err)
    }
  }

  // Try Gemini API
  try {
    const text = await generateGeminiAssistText(prompt, [], signal)
    return { text: sanitizeModelOutput(text), source: 'gemini', quality: 0.85 }
  } catch (err) {
    console.warn('Gemini failed, using fallback:', err)
  }

  // Fallback to simple heuristic
  return {
    text: 'Consider reviewing your message for clarity and tone.',
    source: 'fallback',
    quality: 0.2,
  }
}

/**
 * Generate profile insights with edge/browser routing.
 */
export async function generateProfileInsights(
  displayName: string,
  about: string,
  hashtags: string[],
  recentPosts: string[],
  signal?: AbortSignal
): Promise<{ insights: string[]; source: 'cloudflare' | 'gemma' | 'gemini' | 'fallback' }> {
  const decision = routeAiTask('profile_insights')
  const context = `Name: ${displayName}\nBio: ${about}\nTopics: ${hashtags.join(', ')}`

  const prompt = [
    'Generate 3 insightful sentences about this social profile.',
    'Cover: (1) main topics & writing style, (2) audience or community fit, (3) engagement suggestion.',
    'Format: Plain text, one sentence per line, concise and actionable.',
    `Profile: ${context}`,
    `Posts: ${recentPosts.slice(0, 5).join(', ')}`,
  ].join('\n')

  // Try Cloudflare primary LLM
  if (decision.tier === 'cloudflare_primary' && isCloudflareAiAvailable()) {
    try {
      const text = await withRetry(() => generateWithPrimaryLlm(prompt, { maxTokens: 256 }), {
        maxAttempts: 1,
        shouldRetry: shouldRetryCloudflareError,
      })
      const insights = text.split('\n').filter((line) => line.trim().length > 10)
      return { insights: insights.slice(0, 3), source: 'cloudflare' }
    } catch (err) {
      console.warn('Cloudflare insights generation failed:', err)
    }
  }

  // Try Gemma
  if (isGemmaAvailable()) {
    try {
      const text = await generateText(prompt, signal ? { signal } : {})
      const insights = text.split('\n').filter((line) => line.trim().length > 10)
      return { insights: insights.slice(0, 3), source: 'gemma' }
    } catch (err) {
      console.warn('Gemma insights failed:', err)
    }
  }

  // Try Gemini
  try {
    const text = await generateGeminiAssistText(prompt, [], signal)
    const insights = text.split('\n').filter((line) => line.trim().length > 10)
    return { insights: insights.slice(0, 3), source: 'gemini' }
  } catch {
    // Continue to fallback
  }

  return { insights: [], source: 'fallback' }
}

/**
 * Generate article/thread summary using Cloudflare or local models.
 */
export async function summarizeArticle(
  content: string,
  signal?: AbortSignal
): Promise<{ summary: string; source: 'cloudflare' | 'gemma' | 'gemini' | 'fallback' }> {
  const decision = routeAiTask('article_summary', { textLength: content.length })

  const prompt = [
    'Summarize this article or thread in 2-3 sentences.',
    'Focus on key points and conclusions.',
    'Return plain text only.',
    `Content: ${content.slice(0, 2000)}`,
  ].join('\n')

  // Try Cloudflare
  if (decision.tier === 'cloudflare_primary' && isCloudflareAiAvailable()) {
    try {
      const text = await withRetry(() => generateWithPrimaryLlm(prompt, { maxTokens: 256 }), {
        maxAttempts: 1,
        shouldRetry: shouldRetryCloudflareError,
      })
      return { summary: sanitizeModelOutput(text), source: 'cloudflare' }
    } catch (err) {
      console.warn('Cloudflare summary failed:', err)
    }
  }

  // Try Gemma
  if (isGemmaAvailable()) {
    try {
      const text = await generateText(prompt, signal ? { signal } : {})
      return { summary: sanitizeModelOutput(text), source: 'gemma' }
    } catch (err) {
      console.warn('Gemma summary failed:', err)
    }
  }

  // Try Gemini
  try {
    const text = await generateGeminiAssistText(prompt, [], signal)
    return { summary: sanitizeModelOutput(text), source: 'gemini' }
  } catch {
    // Continue to fallback
  }

  return { summary: '', source: 'fallback' }
}

/**
 * Detect caution signals in compose draft using fast routing.
 */
export async function detectComposeCaution(
  draft: string,
  signal?: AbortSignal
): Promise<{ cautious: boolean; reasons: string[]; source: 'cloudflare' | 'gemma' | 'gemini' | 'fallback' }> {
  const decision = routeAiTask('compose_assist_caution', { textLength: draft.length })

  const prompt = [
    'Analyze this draft message for caution signals.',
    'Respond with JSON: { "cautious": boolean, "reasons": string[] }',
    'Look for: harsh tone, potentially offensive content, double-posting, unclear messaging.',
    `Draft: ${draft.slice(0, 500)}`,
  ].join('\n')

  // Try Cloudflare fast model
  if (decision.tier === 'cloudflare_fast' && isCloudflareAiAvailable()) {
    try {
      const text = await withRetry(() => generateWithFastLlm(prompt, { maxTokens: 128 }), {
        maxAttempts: 1,
        shouldRetry: shouldRetryCloudflareError,
      })
      try {
        const parsed = JSON.parse(text) as { cautious?: boolean; reasons?: string[] }
        return {
          cautious: parsed.cautious ?? false,
          reasons: parsed.reasons ?? [],
          source: 'cloudflare',
        }
      } catch {
        return { cautious: draft.length > 280, reasons: [], source: 'cloudflare' }
      }
    } catch (err) {
      console.warn('Cloudflare caution detection failed:', err)
    }
  }

  // Try Gemma
  if (isGemmaAvailable()) {
    try {
      const text = await generateText(prompt, signal ? { signal } : {})
      try {
        const parsed = JSON.parse(text) as { cautious?: boolean; reasons?: string[] }
        return {
          cautious: parsed.cautious ?? false,
          reasons: parsed.reasons ?? [],
          source: 'gemma',
        }
      } catch {
        return { cautious: draft.length > 280, reasons: [], source: 'gemma' }
      }
    } catch (err) {
      console.warn('Gemma caution detection failed:', err)
    }
  }

  // Fallback heuristic
  return {
    cautious: draft.length > 280 || draft.includes('!!!') || /[A-Z]{5,}/.test(draft),
    reasons: [],
    source: 'fallback',
  }
}

/**
 * Export for backward compatibility
 */
export { isCloudflareAiAvailable }
