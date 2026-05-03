/**
 * LLM-powered search answer synthesis (post-retrieval)
 *
 * After the hybrid ranker returns results, this module asks an LLM to
 * synthesize a brief direct answer across the top-N result snippets.
 *
 * Only runs for semantic-intent queries when ≥3 events are returned.
 * Keyword / hashtag / handle queries are skipped — they have no "answer",
 * only a list of matching items.
 *
 * Provider priority:
 *   1. Gemma (on-device)
 *   2. Gemini (cloud fallback)
 */
import { isGemmaAvailable } from '@/lib/gemma/client'
import { canUseGeminiAssist, generateGeminiAssistText, generateGemmaAssistText } from '@/lib/ai/gemmaAssist'
import { classifyQueryIntent } from './hybrid'
import { sanitizeText } from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'

/** Source model that produced the synthesis */
export type SynthesisSource = 'gemma' | 'gemini'

export interface SearchSynthesisResult {
  text: string
  source: SynthesisSource
}

const MAX_SNIPPET_CHARS = 280
const MAX_EVENTS_FOR_SYNTHESIS = 6
const MIN_EVENTS_FOR_SYNTHESIS = 3
const MAX_SYNTHESIS_OUTPUT_CHARS = 420
const SYNTHESIS_TIMEOUT_MS = 6_000

function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
  const validSignals = signals.filter(Boolean)
  const withAny = AbortSignal as typeof AbortSignal & {
    any?: (values: AbortSignal[]) => AbortSignal
  }

  if (withAny.any) return withAny.any(validSignals)

  const controller = new AbortController()
  for (const current of validSignals) {
    if (current.aborted) {
      controller.abort(current.reason)
      return controller.signal
    }
  }

  const onAbort = (event: Event) => {
    const source = event.target as AbortSignal
    controller.abort(source.reason)
    for (const current of validSignals) {
      current.removeEventListener('abort', onAbort)
    }
  }

  for (const current of validSignals) {
    current.addEventListener('abort', onAbort, { once: true })
  }

  return controller.signal
}

function truncate(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

function buildSynthesisPrompt(query: string, snippets: string[]): string {
  const numbered = snippets
    .map((s, i) => `[${i + 1}] ${s}`)
    .join('\n')

  return [
    'You are a search assistant. Based ONLY on the posts below, write a concise 1–3 sentence answer to the question.',
    'If the posts do not contain enough information, say so briefly.',
    'Return plain text only — no bullet points, no markdown.',
    '',
    `Question: ${query}`,
    '',
    'Posts:',
    numbered,
    '',
    'Answer:',
  ].join('\n')
}

function sanitizeSynthesisOutput(raw: string): string {
  const cleaned = raw
    .replace(/^answer[:\s]*/i, '')
    .replace(/```[a-z]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return truncate(cleaned, MAX_SYNTHESIS_OUTPUT_CHARS)
}

/**
 * Synthesize a brief answer across the top search results for a semantic query.
 *
 * Returns `null` if:
 * - the query is not semantic intent
 * - fewer than MIN_EVENTS_FOR_SYNTHESIS results
 * - no LLM is available
 * - the LLM returns empty or unusable output
 */
export async function synthesizeSearchAnswer(
  query: string,
  events: NostrEvent[],
  signal?: AbortSignal,
): Promise<SearchSynthesisResult | null> {
  const trimmed = query.trim()
  if (!trimmed) return null

  const intent = classifyQueryIntent(trimmed)
  if (intent !== 'semantic') return null

  if (events.length < MIN_EVENTS_FOR_SYNTHESIS) return null

  const snippets = events
    .slice(0, MAX_EVENTS_FOR_SYNTHESIS)
    .map((event) => truncate(sanitizeText(event.content), MAX_SNIPPET_CHARS))
    .filter((s) => s.length > 10)

  if (snippets.length < MIN_EVENTS_FOR_SYNTHESIS) return null

  const prompt = buildSynthesisPrompt(trimmed, snippets)

  const timeoutSignal = AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS)
  const combined = signal
    ? combineAbortSignals([signal, timeoutSignal])
    : timeoutSignal

  try {
    if (isGemmaAvailable()) {
      const raw = await generateGemmaAssistText(prompt, combined)
      const text = sanitizeSynthesisOutput(raw)
      if (!text) return null
      return { text, source: 'gemma' }
    }

    if (await canUseGeminiAssist()) {
      const raw = await generateGeminiAssistText(prompt, [], combined)
      const text = sanitizeSynthesisOutput(raw)
      if (!text) return null
      return { text, source: 'gemini' }
    }

    return null
  } catch {
    return null
  }
}
