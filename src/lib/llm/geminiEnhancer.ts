/**
 * Gemini Enhancer
 *
 * Role contract:
 *   MAY enhance/augment:
 *     - Search queries (rewrite for better Nostr retrieval)
 *     - Moderation context (add context annotations before classification)
 *   MUST NOT:
 *     - Make final moderation decisions (allow/block) — that is evaluateModerationScores() in policy.ts
 *     - Select or influence the search routing strategy — that is the router worker
 *     - Generate the grounded answer — that is SearchAiAnswer / LiteRT
 *
 * Feature flag: VITE_ENABLE_GEMINI_ENHANCER=true  (default: false — opt-in only)
 * Key:          VITE_GEMINI_API_KEY
 * Model:        VITE_GEMINI_MODEL (default: gemini-2.0-flash-lite)
 * Timeout:      VITE_GEMINI_ENHANCER_TIMEOUT_MS (default: 5000)
 *
 * All functions are non-throwing — they return the original input unchanged on any
 * failure (missing flag, missing key, network error, timeout, empty response).
 */

import { GoogleGenerativeAI } from '@google/generative-ai'

const ENHANCER_ENABLED = import.meta.env.VITE_ENABLE_GEMINI_ENHANCER === 'true'
const GEMINI_API_KEY: string = typeof import.meta.env.VITE_GEMINI_API_KEY === 'string'
  ? import.meta.env.VITE_GEMINI_API_KEY.trim()
  : ''
const GEMINI_MODEL: string = typeof import.meta.env.VITE_GEMINI_MODEL === 'string' && import.meta.env.VITE_GEMINI_MODEL.trim()
  ? import.meta.env.VITE_GEMINI_MODEL.trim()
  : 'gemini-2.0-flash-lite'
const TIMEOUT_MS: number = Number(import.meta.env.VITE_GEMINI_ENHANCER_TIMEOUT_MS) > 0
  ? Number(import.meta.env.VITE_GEMINI_ENHANCER_TIMEOUT_MS)
  : 5_000

let _client: GoogleGenerativeAI | null = null

function getClient(): GoogleGenerativeAI {
  if (!_client) {
    _client = new GoogleGenerativeAI(GEMINI_API_KEY)
  }
  return _client
}

async function withTimeout<T>(promise: Promise<T>, fallback: T, ms: number): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | undefined
  const timer = new Promise<T>((resolve) => {
    timerId = setTimeout(() => { resolve(fallback) }, ms)
  })
  return Promise.race([promise, timer]).finally(() => { clearTimeout(timerId) })
}

/**
 * Enhances a Nostr search query for better retrieval quality.
 *
 * Role: query text improvement only. Does NOT classify query intent (lexical/semantic/hybrid)
 * — that decision belongs exclusively to the router worker.
 *
 * Returns the original query unchanged when:
 *   - VITE_ENABLE_GEMINI_ENHANCER is not 'true'
 *   - VITE_GEMINI_API_KEY is absent
 *   - The request fails or times out
 *   - Gemini returns an empty string
 */
export async function enhanceSearchQuery(query: string): Promise<string> {
  if (!ENHANCER_ENABLED || !GEMINI_API_KEY) return query

  const run = async (): Promise<string> => {
    try {
      const model = getClient().getGenerativeModel({ model: GEMINI_MODEL })
      const prompt = [
        'You are a search query enhancer for a Nostr social media search engine.',
        'Rewrite the following user query to be clearer and more effective for retrieving',
        'relevant posts. Preserve the original intent exactly.',
        'Output ONLY the rewritten query — no explanation, no quotes, no labels.',
        '',
        `Query: ${query}`,
      ].join('\n')

      const result = await model.generateContent(prompt)
      const enhanced = result.response.text().trim()
      return enhanced || query
    } catch {
      return query
    }
  }

  return withTimeout(run(), query, TIMEOUT_MS)
}

/**
 * Enriches text with brief context annotations before moderation classification.
 *
 * Role: context annotation only. Prepends signals like [IRONY], [SARCASM], [METAPHOR],
 * or [QUOTE] when clearly applicable so the downstream classifier has richer input.
 *
 * IMPORTANT: This function NEVER makes a moderation decision. The final allow/block
 * determination is made exclusively by evaluateModerationScores() in policy.ts.
 *
 * Returns the original text unchanged when:
 *   - VITE_ENABLE_GEMINI_ENHANCER is not 'true'
 *   - VITE_GEMINI_API_KEY is absent
 *   - The request fails or times out
 *   - Gemini returns an empty string
 */
export async function enrichModerationContext(text: string): Promise<string> {
  if (!ENHANCER_ENABLED || !GEMINI_API_KEY) return text

  const run = async (): Promise<string> => {
    try {
      const model = getClient().getGenerativeModel({ model: GEMINI_MODEL })
      const prompt = [
        'You are a content analysis assistant. Your ONLY job is to add a brief context',
        'annotation to the text below if clearly applicable.',
        'Permitted annotation prefixes (use at most one): [IRONY] [SARCASM] [METAPHOR] [QUOTE] [PARODY]',
        'If no annotation applies, output the original text unchanged.',
        'Do NOT make any moderation judgment. Do NOT add or remove words beyond the prefix.',
        'Output ONLY the (optionally annotated) text — no explanation.',
        '',
        `Text: ${text}`,
      ].join('\n')

      const result = await model.generateContent(prompt)
      const enriched = result.response.text().trim()
      return enriched || text
    } catch {
      return text
    }
  }

  return withTimeout(run(), text, TIMEOUT_MS)
}

/**
 * Returns true when the enhancer is both enabled (feature flag) and has an API key.
 * Used by modelResponsibilities.ts to derive the live status badge.
 */
export function isGeminiEnhancerActive(): boolean {
  return ENHANCER_ENABLED && Boolean(GEMINI_API_KEY)
}

/**
 * Exported for testing and the model responsibility panel.
 */
export const _geminiEnhancerConfig = {
  enabled: ENHANCER_ENABLED,
  hasKey: Boolean(GEMINI_API_KEY),
  model: GEMINI_MODEL,
  timeoutMs: TIMEOUT_MS,
} as const
