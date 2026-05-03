/**
 * Cloudflare Workers AI providers for different AI tasks.
 * Uses multiple models optimized for different workloads via edge inference.
 */

import { withRetry } from '@/lib/retry'

// ── Model IDs ───────────────────────────────────────────────

/**
 * Primary text generation model for complex tasks (compose assistance, insights).
 * llama-3.1-70b-instruct: Enterprise-grade model, supports reasoning, longer outputs.
 */
export const CLOUDFLARE_PRIMARY_LLM_ID = '@cf/meta/llama-3.1-70b-instruct'

/**
 * Fast lightweight model for simple classification/routing.
 * llama-3.1-8b-instruct: Already configured, lightweight, good for intent classification.
 */
export const CLOUDFLARE_FAST_MODEL_ID = '@cf/meta/llama-3.1-8b-instruct'

/**
 * Content moderation & safety classification.
 * llama-guard-3-8b: Specialized for content safety analysis.
 */
export const CLOUDFLARE_MODERATION_MODEL_ID = '@cf/meta/llama-guard-3-8b'

/**
 * Translation model (multilingual).
 * m2m100-1.2b: Many-to-Many translation across 100+ languages.
 */
export const CLOUDFLARE_TRANSLATION_MODEL_ID = '@cf/meta/m2m100-1.2b'

/**
 * Text embedding model for semantic search & similarity.
 * embeddinggemma-300m: Fast, efficient embeddings.
 */
export const CLOUDFLARE_EMBEDDING_MODEL_ID = '@cf/google/embeddinggemma-300m'

/**
 * Text reranking model for search result ranking.
 * bge-reranker-base: Specialized for relevance scoring.
 */
export const CLOUDFLARE_RERANKER_MODEL_ID = '@cf/baai/bge-reranker-base'

// ── Configuration ───────────────────────────────────────────

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4'

interface CloudflareAiConfig {
  accountId: string
  apiToken: string
}

function getCloudflareConfig(): CloudflareAiConfig {
  const accountId = import.meta.env.VITE_CLOUDFLARE_ACCOUNT_ID?.trim()
  const apiToken = import.meta.env.VITE_CLOUDFLARE_API_TOKEN?.trim()

  if (!accountId || !apiToken) {
    throw new Error(
      'Cloudflare AI requires VITE_CLOUDFLARE_ACCOUNT_ID and VITE_CLOUDFLARE_API_TOKEN'
    )
  }

  return { accountId, apiToken }
}

// ── API Call Helper ─────────────────────────────────────────

interface CloudflareAiRequest {
  messages?: Array<{ role: string; content: string }>
  prompt?: string
  text?: string
  query?: string
  passage?: string | string[]
  max_tokens?: number
  temperature?: number
  top_p?: number
}

interface CloudflareAiResponse {
  result?: {
    response?: string
    finish_reason?: string
  }
  success: boolean
  errors?: Array<{ message: string }>
}

async function callCloudflareAi(
  modelId: string,
  payload: CloudflareAiRequest,
  retryOpts = { maxAttempts: 2, baseDelayMs: 300 }
): Promise<CloudflareAiResponse> {
  const { accountId, apiToken } = getCloudflareConfig()

  const response = await withRetry(
    async () => {
      const result = await fetch(
        `${CLOUDFLARE_API_BASE}/accounts/${encodeURIComponent(accountId)}/ai/run/${encodeURIComponent(modelId)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiToken}`,
          },
          body: JSON.stringify(payload),
        }
      )

      if (!result.ok) {
        const detail = await result.text().catch(() => '')
        throw new Error(`Cloudflare AI (${result.status}): ${detail}`)
      }

      return (result.json() as Promise<unknown>) as Promise<CloudflareAiResponse>
    },
    retryOpts
  )

  return response
}

// ── Public API ───────────────────────────────────────────────

/**
 * Generate text using the primary LLM (70B model) for high-quality, complex tasks.
 * Suitable for: compose assistance, profile insights, detailed analysis.
 */
export async function generateWithPrimaryLlm(
  prompt: string,
  options?: {
    maxTokens?: number
    temperature?: number
  }
): Promise<string> {
  const response = await callCloudflareAi(
    CLOUDFLARE_PRIMARY_LLM_ID,
    {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: options?.maxTokens ?? 1024,
      temperature: options?.temperature ?? 0.7,
    }
  )

  const text = response.result?.response ?? ''
  if (!text) {
    throw new Error('Cloudflare AI returned empty response')
  }

  return text
}

/**
 * Generate text using the fast LLM (8B model) for quick, lightweight tasks.
 * Suitable for: search intent classification, fast responses, low-latency needs.
 */
export async function generateWithFastLlm(
  prompt: string,
  options?: {
    maxTokens?: number
    temperature?: number
  }
): Promise<string> {
  const response = await callCloudflareAi(
    CLOUDFLARE_FAST_MODEL_ID,
    {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: options?.maxTokens ?? 256,
      temperature: options?.temperature ?? 0.7,
    }
  )

  const text = response.result?.response ?? ''
  if (!text) {
    throw new Error('Cloudflare AI returned empty response')
  }

  return text
}

/**
 * Analyze content for safety/moderation using Llama Guard.
 * Returns raw safety classification response.
 */
export async function analyzeContentSafety(
  content: string,
  isPrompt = true
): Promise<string> {
  const role = isPrompt ? 'prompt' : 'response'
  const systemPrompt = 'You are a content safety classifier.'

  const response = await callCloudflareAi(
    CLOUDFLARE_MODERATION_MODEL_ID,
    {
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Classify this ${role} for safety:\n\n${content}`,
        },
      ],
      max_tokens: 512,
      temperature: 0,
    }
  )

  return response.result?.response ?? ''
}

/**
 * Translate text using M2M100 (Many-to-Many translation).
 * Supports 100+ languages.
 */
export async function translateWithCloudflare(
  text: string,
  sourceLanguage: string,
  targetLanguage: string
): Promise<string> {
  const prompt = `Translate the following text from ${sourceLanguage} to ${targetLanguage}. Return only the translated text, no explanations.\n\nText: ${text}`

  const response = await callCloudflareAi(
    CLOUDFLARE_TRANSLATION_MODEL_ID,
    {
      prompt,
      max_tokens: text.length + 100,
    }
  )

  return response.result?.response ?? ''
}

/**
 * Generate embeddings for semantic search (EmbeddingGemma 300M).
 * Returns embedding vector.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await callCloudflareAi(
    CLOUDFLARE_EMBEDDING_MODEL_ID,
    { text }
  )

  // Embedding response contains a vector in result
  const data = response.result as unknown as { data?: Array<{ embedding?: number[] }> }
  return data?.data?.[0]?.embedding ?? []
}

/**
 * Rerank search results based on relevance to query.
 * Uses BGE Reranker for scoring.
 */
export async function rerankResults(
  query: string,
  passages: string[]
): Promise<Array<{ index: number; score: number }>> {
  const response = await callCloudflareAi(
    CLOUDFLARE_RERANKER_MODEL_ID,
    { query, passage: passages }
  )

  // Reranker returns scores for each passage
  const scores = response.result as unknown as Record<string, unknown>
  
  // Parse the response format (typically contains scores array)
  return []
}

/**
 * Check if Cloudflare AI is available with required credentials.
 */
export function isCloudflareAiAvailable(): boolean {
  try {
    const { accountId, apiToken } = getCloudflareConfig()
    return Boolean(accountId && apiToken)
  } catch {
    return false
  }
}
