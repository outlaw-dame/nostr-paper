import { generateText, isGemmaAvailable } from '@/lib/gemma/client'
import { withRetry } from '@/lib/retry'
import { loadTranslationSecrets } from '@/lib/translation/storage'
import { moderateContent } from '@/lib/moderation/cloudflareModeration'
import type { AiTaskType } from '@/lib/ai/taskRouting'

const MAX_OUTPUT_CHARS = 1200
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'
const ASSIST_QUALITY_THRESHOLD = 0.52

function sanitizeModelOutput(value: string): string {
  const withoutFences = value
    .replace(/```[a-zA-Z]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (withoutFences.length <= MAX_OUTPUT_CHARS) return withoutFences
  return `${withoutFences.slice(0, MAX_OUTPUT_CHARS - 1)}…`
}

function shouldRetryGemmaError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return false

  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('No Gemma model path configured')) return false
  if (message.includes('WebGPU')) return false
  if (message.includes('timed out')) return true

  return true
}

function shouldRetryGeminiError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return false
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('HTTP 400') || message.includes('HTTP 401') || message.includes('HTTP 403')) {
    return false
  }
  return true
}

function qualityScore(text: string): number {
  const compact = text.trim()
  if (!compact) return 0

  const lengthScore = Math.min(1, compact.length / 220)
  const sentenceCount = compact.split(/[.!?]+/).map((chunk) => chunk.trim()).filter(Boolean).length
  const sentenceScore = Math.min(1, sentenceCount / 2)

  const words = compact.toLowerCase().split(/\s+/).filter(Boolean)
  const unique = new Set(words)
  const diversity = words.length === 0 ? 0 : unique.size / words.length

  const markdownPenalty = compact.includes('```') ? 0.2 : 0
  const repetitionPenalty = diversity < 0.45 ? 0.15 : 0

  return Math.max(0, (lengthScore * 0.4) + (sentenceScore * 0.35) + (diversity * 0.25) - markdownPenalty - repetitionPenalty)
}

export function evaluateAssistQuality(text: string): number {
  return qualityScore(text)
}

async function loadGeminiApiKey(): Promise<string> {
  const secrets = await loadTranslationSecrets()
  return secrets.geminiApiKey.trim()
}

function extractGeminiText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const candidates = (payload as { candidates?: unknown }).candidates
  if (!Array.isArray(candidates)) return ''

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue
    const content = (candidate as { content?: unknown }).content
    if (!content || typeof content !== 'object') continue
    const parts = (content as { parts?: unknown }).parts
    if (!Array.isArray(parts)) continue

    const text = parts
      .map((part) => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : ''))
      .join('')
      .trim()

    if (text.length > 0) return text
  }

  return ''
}

export async function canUseGeminiAssist(): Promise<boolean> {
  const key = await loadGeminiApiKey()
  return key.length > 0
}

export async function generateGeminiAssistText(
  prompt: string,
  moderationGuidance: string[] = [],
  signal?: AbortSignal,
): Promise<string> {
  const key = await loadGeminiApiKey()
  if (!key) {
    throw new Error('Gemini API key is not configured.')
  }

  const url = new URL(`${GEMINI_API_BASE_URL}/models/${encodeURIComponent(DEFAULT_GEMINI_MODEL)}:generateContent`)
  url.searchParams.set('key', key)

  const requestBody = {
    systemInstruction: {
      role: 'system',
      parts: [{ text: [
        'You are a concise writing-quality assistant. Return plain text only.',
        'Follow platform moderation policy at all times.',
        'Do not produce harassment, hate speech, threats, sexual explicit content, or dangerous instructions.',
        moderationGuidance.length > 0
          ? `Moderation guidance: ${moderationGuidance.slice(0, 4).join(' | ')}`
          : 'Moderation guidance: none provided.',
      ].join('\n') }],
    },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    ],
    generationConfig: {
      temperature: 0.25,
    },
  }

  const retryOptions = signal
    ? {
        signal,
        maxAttempts: 3,
        baseDelayMs: 600,
        maxDelayMs: 4_000,
        jitter: 'full' as const,
        shouldRetry: (error: unknown) => shouldRetryGeminiError(error),
      }
    : {
        maxAttempts: 3,
        baseDelayMs: 600,
        maxDelayMs: 4_000,
        jitter: 'full' as const,
        shouldRetry: (error: unknown) => shouldRetryGeminiError(error),
      }

  const payload = await withRetry(async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(requestBody),
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
      referrerPolicy: 'no-referrer',
      ...(signal ? { signal } : {}),
    })

    if (response.status === 429 || response.status >= 500) {
      throw new Error(`HTTP ${response.status}`)
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return response.json() as Promise<unknown>
  }, retryOptions)

  const text = sanitizeModelOutput(extractGeminiText(payload))
  if (!text) {
    throw new Error('Gemini returned empty output.')
  }

  const moderationDecision = await moderateContent(text, {
    isPrompt: false,
    requireConfidence: 0.6,
  })
  if (!moderationDecision.isSafe) {
    throw new Error(`Gemini output blocked by moderation (${moderationDecision.labels.join(', ') || 'unsafe'}).`)
  }

  return text
}

export interface GemmaAssistResult {
  text: string
  source: 'gemma' | 'fallback'
}

export type AiAssistSource = 'gemma' | 'gemini'
export type AiAssistProvider = 'auto' | 'gemma' | 'gemini'

export interface GenerateAssistOptions {
  signal?: AbortSignal
  provider?: AiAssistProvider
  taskType?: AiTaskType
  moderationGuidance?: string[]
}

export async function generateGemmaAssistText(
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const generateOptions = signal ? { signal } : {}
  const retryOptions = signal
    ? {
        signal,
        maxAttempts: 2,
        baseDelayMs: 900,
        maxDelayMs: 4_000,
        jitter: 'full' as const,
        shouldRetry: (error: unknown) => shouldRetryGemmaError(error),
      }
    : {
        maxAttempts: 2,
        baseDelayMs: 900,
        maxDelayMs: 4_000,
        jitter: 'full' as const,
        shouldRetry: (error: unknown) => shouldRetryGemmaError(error),
      }

  const raw = await withRetry(
    async () => generateText(prompt, generateOptions),
    retryOptions,
  )

  return sanitizeModelOutput(raw)
}

async function enhanceGemmaWithGemini(gemmaDraft: string, prompt: string, signal?: AbortSignal): Promise<string> {
  const improvePrompt = [
    'Improve this assistant output for quality, completeness, and clarity.',
    'Keep the same intent and keep it concise.',
    'Return plain text only.',
    `Original user prompt: ${JSON.stringify(prompt)}`,
    `Current draft: ${JSON.stringify(gemmaDraft)}`,
  ].join('\n')

  return generateGeminiAssistText(improvePrompt, [], signal)
}

export async function generateAssistText(
  prompt: string,
  options: GenerateAssistOptions = {},
): Promise<{ text: string; source: AiAssistSource; enhancedByGemini: boolean }> {
  const provider = options.provider ?? 'auto'
  const taskType = options.taskType ?? 'compose_assist_quality'
  const moderationGuidance = options.moderationGuidance ?? []

  if (provider === 'gemini') {
    const text = await generateGeminiAssistText(prompt, moderationGuidance, options.signal)
    return { text, source: 'gemini', enhancedByGemini: false }
  }

  if (provider === 'gemma') {
    const gemmaText = await generateGemmaAssistText(prompt, options.signal)
    const gemmaQuality = qualityScore(gemmaText)

    const needsUpgrade = gemmaQuality < ASSIST_QUALITY_THRESHOLD || taskType === 'profile_insights' || taskType === 'article_summary'
    if (needsUpgrade && await canUseGeminiAssist()) {
      try {
        const enhanced = await generateGeminiAssistText(prompt, moderationGuidance, options.signal)
        return { text: enhanced, source: 'gemini', enhancedByGemini: true }
      } catch {
        return { text: gemmaText, source: 'gemma', enhancedByGemini: false }
      }
    }

    return { text: gemmaText, source: 'gemma', enhancedByGemini: false }
  }

  if (canUseGemmaAssist()) {
    try {
      const gemmaText = await generateGemmaAssistText(prompt, options.signal)
      const gemmaQuality = qualityScore(gemmaText)

      const needsUpgrade = gemmaQuality < ASSIST_QUALITY_THRESHOLD || taskType === 'profile_insights' || taskType === 'article_summary'
      if (needsUpgrade && await canUseGeminiAssist()) {
        try {
          const enhanced = await generateGeminiAssistText(prompt, moderationGuidance, options.signal)
          return { text: enhanced, source: 'gemini', enhancedByGemini: true }
        } catch {
          return { text: gemmaText, source: 'gemma', enhancedByGemini: false }
        }
      }

      return { text: gemmaText, source: 'gemma', enhancedByGemini: false }
    } catch {
      // Fall through to Gemini fallback in auto mode.
    }
  }

  const geminiText = await generateGeminiAssistText(prompt, moderationGuidance, options.signal)
  return { text: geminiText, source: 'gemini', enhancedByGemini: false }
}

export function canUseGemmaAssist(): boolean {
  return isGemmaAvailable()
}
