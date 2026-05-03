/**
 * LLM-powered query rewriting (pre-retrieval)
 *
 * Converts ambiguous natural-language queries into concise retrieval-optimized
 * keyword phrases before they reach the bi-encoder.
 *
 * Only activates for semantic-intent queries (≥6 tokens or conversational
 * phrasing). Keyword / hashtag / handle queries are returned unchanged.
 *
 * Provider priority:
 *   1. Gemma (on-device, zero latency cost)
 *   2. Gemini (cloud fallback, only if Gemma unavailable)
 *
 * Fails silently — any error returns the original query so search is unaffected.
 */
import { isGemmaAvailable } from '@/lib/gemma/client'
import { canUseGeminiAssist, generateGeminiAssistText, generateGemmaAssistText } from '@/lib/ai/gemmaAssist'
import { classifyQueryIntent } from './hybrid'

const REWRITE_TIMEOUT_MS = 3_500

/** Minimum token count before we consider rewriting. */
const MIN_REWRITE_TOKENS = 5

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

function buildRewritePrompt(query: string): string {
  return [
    'Rewrite the following search query into 3–7 concise retrieval keywords.',
    'Rules: output ONLY the keywords separated by spaces, no punctuation, no explanation.',
    'Preserve named entities (people, places, projects) exactly.',
    `Query: ${JSON.stringify(query)}`,
    'Keywords:',
  ].join('\n')
}

function sanitizeRewriteOutput(raw: string): string {
  // Strip any preamble the model may have included (e.g. "Keywords: ...")
  const cleaned = raw
    .replace(/^keywords?[:\s]*/i, '')
    .replace(/["""]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  // Reject if output looks like a full sentence (contains punctuation or is too long)
  if (cleaned.includes('.') || cleaned.includes('?') || cleaned.split(' ').length > 12) {
    return ''
  }

  return cleaned
}

/**
 * Attempt to rewrite `query` into a set of tighter retrieval keywords.
 * Returns the rewritten string, or `null` if the query doesn't need rewriting
 * or if the LLM is unavailable / produces unusable output.
 */
export async function rewriteSearchQuery(
  query: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const trimmed = query.trim()
  if (!trimmed) return null

  // Only rewrite semantic-intent queries
  const intent = classifyQueryIntent(trimmed)
  if (intent !== 'semantic') return null

  // Double-check token count
  const tokens = trimmed.split(/\s+/).filter(Boolean)
  if (tokens.length < MIN_REWRITE_TOKENS) return null

  const prompt = buildRewritePrompt(trimmed)

  const timeoutSignal = AbortSignal.timeout(REWRITE_TIMEOUT_MS)
  const combined = signal
    ? combineAbortSignals([signal, timeoutSignal])
    : timeoutSignal

  try {
    let raw: string

    if (isGemmaAvailable()) {
      raw = await generateGemmaAssistText(prompt, combined)
    } else if (await canUseGeminiAssist()) {
      raw = await generateGeminiAssistText(prompt, [], combined)
    } else {
      return null
    }

    const rewritten = sanitizeRewriteOutput(raw)

    // Only use the rewrite if it's meaningfully different from the original
    if (!rewritten || rewritten === trimmed.toLowerCase()) return null

    return rewritten
  } catch {
    // Fail silently — callers should fall back to the original query
    return null
  }
}
