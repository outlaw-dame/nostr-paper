/**
 * Cloudflare Workers AI Integration Guide
 * 
 * This file documents how to integrate the new Cloudflare AI providers
 * into existing components and workflows across the nostr-paper app.
 */

// ────────────────────────────────────────────────────────────────
// 1. COMPOSE ASSISTANCE INTEGRATION
// ────────────────────────────────────────────────────────────────

// OLD: src/components/compose/ComposeAssist.tsx
// BEFORE:
/*
import { generateText } from '@/lib/gemma/client'

export function ComposeAssist() {
  const [suggestion, setSuggestion] = useState('')
  
  const handleImprove = async () => {
    try {
      const improved = await generateText(userDraft)
      setSuggestion(improved)
    } catch (err) {
      setSuggestion('Could not generate suggestion')
    }
  }
}
*/

// AFTER: Add Cloudflare support
/*
import { generateComposeAssistText } from '@/lib/ai/enhancedAssist'

export function ComposeAssist() {
  const [suggestion, setSuggestion] = useState('')
  const [source, setSource] = useState<'cloudflare' | 'gemma' | 'gemini' | 'fallback'>('fallback')
  
  const handleImprove = async (signal?: AbortSignal) => {
    try {
      const result = await generateComposeAssistText(userDraft, signal)
      setSuggestion(result.text)
      setSource(result.source)
      
      // Optional: Show badge indicating quality/source
      if (result.quality > 0.8) {
        showNotification('High-quality suggestion from ' + result.source)
      }
    } catch (err) {
      setSuggestion('Could not generate suggestion')
      setSource('fallback')
    }
  }
}
*/

// ────────────────────────────────────────────────────────────────
// 2. PROFILE INSIGHTS INTEGRATION
// ────────────────────────────────────────────────────────────────

// OLD: src/components/profile/ProfileInsights.tsx
// BEFORE:
/*
export function ProfileInsights({ profile }) {
  const insights = [
    `${profile.displayName} is active on Nostr`,
    `Interests: ${profile.hashtags?.join(', ')}`,
    'Follow to stay updated with their posts'
  ]
}
*/

// AFTER: Add Cloudflare AI generation
/*
import { generateProfileInsights } from '@/lib/ai/enhancedAssist'

export function ProfileInsights({ profile }: { profile: NDKUser }) {
  const [insights, setInsights] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [source, setSource] = useState<'cloudflare' | 'gemma' | 'gemini' | 'fallback'>()
  
  useEffect(() => {
    const generateInsights = async () => {
      setIsLoading(true)
      try {
        const result = await generateProfileInsights(
          profile.profile?.displayName ?? '',
          profile.profile?.about ?? '',
          profile.profile?.hashtags ?? [],
          [], // recent posts if available
        )
        setInsights(result.insights)
        setSource(result.source)
      } catch (err) {
        console.error('Failed to generate insights:', err)
        // Fallback to basic insights
        setInsights([
          `${profile.profile?.displayName ?? 'User'} on Nostr`,
        ])
      } finally {
        setIsLoading(false)
      }
    }
    
    generateInsights()
  }, [profile.pubkey])
  
  return (
    <div>
      {insights.map((insight, i) => (
        <p key={i}>{insight}</p>
      ))}
      {source && source !== 'fallback' && (
        <small>Generated via {source}</small>
      )}
    </div>
  )
}
*/

// ────────────────────────────────────────────────────────────────
// 3. CONTENT MODERATION INTEGRATION
// ────────────────────────────────────────────────────────────────

// OLD: src/lib/moderation/policy.ts
// BEFORE:
/*
import { moderateTextOnnx } from '@/lib/moderation/onnx'

export async function checkContentPolicy(text: string) {
  return moderateTextOnnx(text) // Always uses ONNX
}
*/

// AFTER: Add Cloudflare option
/*
import { moderateContent } from '@/lib/moderation/cloudflareModeration'

export async function checkContentPolicy(text: string) {
  // Try Cloudflare first (faster, more accurate)
  // Falls back to ONNX if unavailable
  const decision = await moderateContent(text)
  
  // Check if safe
  if (!decision.isSafe) {
    console.warn('Content flagged as unsafe:', decision.labels)
    return {
      allowed: false,
      reason: decision.labels.join(', '),
      confidence: decision.confidence
    }
  }
  
  return { allowed: true }
}
*/

// ────────────────────────────────────────────────────────────────
// 4. TRANSLATION INTEGRATION
// ────────────────────────────────────────────────────────────────

// OLD: src/components/translation/TranslationComponent.tsx
// BEFORE:
/*
import { GeminiTranslator } from '@/lib/translation/engines/gemini'

export function TranslateContent({ text }) {
  const translate = async (lang: string) => {
    return GeminiTranslator.translate(text, lang)
  }
}
*/

// AFTER: Use Cloudflare M2M100
/*
import { translateText, getSupportedLanguages, detectLanguageSimple } from '@/lib/translation/cloudflareTranslation'

export function TranslateContent({ text }) {
  const [languages] = useState(() => getSupportedLanguages())
  
  const translate = async (targetLang: string) => {
    const sourceLang = detectLanguageSimple(text)
    const result = await translateText(text, sourceLang, targetLang)
    return result.translated // Uses Cloudflare M2M100 with fallback
  }
  
  return (
    <select onChange={(e) => translate(e.target.value)}>
      <option>Select language</option>
      {languages.map(lang => (
        <option key={lang.code} value={lang.code}>
          {lang.name}
        </option>
      ))}
    </select>
  )
}
*/

// ────────────────────────────────────────────────────────────────
// 5. SEARCH INTENT CLASSIFICATION (Already Integrated)
// ────────────────────────────────────────────────────────────────

// CURRENT: src/lib/llm/routerHarness.ts already uses Cloudflare fast model
// Ready to use! No changes needed, but can optimize:

// OPTIONAL: If making large-scale search routing
/*
import { generateWithFastLlm } from '@/lib/ai/cloudflareAiProviders'
import { routeSearchIntentClassify } from '@/lib/ai/taskRouting'

export async function classifySearchIntentAdvanced(query: string) {
  const decision = routeSearchIntentClassify()
  
  if (decision.tier === 'cloudflare_fast') {
    // Use Cloudflare 8B model for fast classification
    const prompt = `Classify this search as: lexical | semantic | hybrid\n\nQuery: ${query}`
    const classification = await generateWithFastLlm(prompt, { maxTokens: 16 })
    return classification.trim()
  }
  
  // Fall back to existing logic
  return classifySearchIntentLegacy(query)
}
*/

// ────────────────────────────────────────────────────────────────
// 6. SEMANTIC SEARCH WITH EMBEDDINGS
// ────────────────────────────────────────────────────────────────

// NEW: When implementing semantic search
/*
import { generateEmbedding, rerankResults } from '@/lib/ai/cloudflareAiProviders'

export async function semanticSearch(query: string, documents: string[]) {
  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query)
  
  // Generate embeddings for documents
  const docEmbeddings = await Promise.all(
    documents.map(doc => generateEmbedding(doc))
  )
  
  // Calculate similarity (cosine distance)
  const similarities = docEmbeddings.map(docEmb => 
    cosineSimilarity(queryEmbedding, docEmb)
  )
  
  // Get top results
  const topResults = similarities
    .map((sim, idx) => ({ document: documents[idx], score: sim }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
  
  // Optional: Re-rank with BGE reranker for better ordering
  const reranked = await rerankResults(query, topResults.map(r => r.document))
  
  return reranked
}
*/

// ────────────────────────────────────────────────────────────────
// 7. ENVIRONMENT SETUP
// ────────────────────────────────────────────────────────────────

// Create .env with:
/*
# Cloudflare Workers AI
VITE_CLOUDFLARE_ACCOUNT_ID=your_account_id_here
VITE_CLOUDFLARE_API_TOKEN=your_api_token_here

# Keep existing vars for fallbacks
VITE_GEMINI_API_KEY=...
*/

// ────────────────────────────────────────────────────────────────
// 8. TESTING EXAMPLE
// ────────────────────────────────────────────────────────────────

/*
// src/__tests__/cloudflare-ai.test.ts

import { describe, it, expect, beforeEach } from 'vitest'
import { generateComposeAssistText } from '@/lib/ai/enhancedAssist'
import { moderateContent } from '@/lib/moderation/cloudflareModeration'
import { translateText } from '@/lib/translation/cloudflareTranslation'

describe('Cloudflare AI Integration', () => {
  it('should improve compose text', async () => {
    const result = await generateComposeAssistText('hey hows it going')
    expect(result.text).toBeTruthy()
    expect(['cloudflare', 'gemma', 'gemini', 'fallback']).toContain(result.source)
  })
  
  it('should moderate unsafe content', async () => {
    const result = await moderateContent('This is unsafe content with curses')
    expect(!result.isSafe).toBe(true)
    expect(result.labels.length).toBeGreaterThan(0)
  })
  
  it('should translate to Spanish', async () => {
    const result = await translateText('Hello world', 'en', 'es')
    expect(result.translated).toBeTruthy()
  })
})
*/

// ────────────────────────────────────────────────────────────────
// 9. MONITORING & DEBUGGING
// ────────────────────────────────────────────────────────────────

// Track provider performance:
/*
export interface ProviderMetrics {
  task: string
  provider: string
  latency_ms: number
  success: boolean
  fallback_used: boolean
}

const metricsBuffer: ProviderMetrics[] = []

export function recordMetric(metric: ProviderMetrics) {
  metricsBuffer.push(metric)
  if (metricsBuffer.length >= 100) {
    // Send batch to analytics
    reportMetrics(metricsBuffer)
    metricsBuffer.length = 0
  }
}

export function reportMetrics(metrics: ProviderMetrics[]) {
  const byProvider = metrics.reduce((acc, m) => {
    const key = m.provider
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
  
  console.log('Provider usage:', byProvider)
  // Could send to Sentry, LogRocket, etc.
}
*/

// ────────────────────────────────────────────────────────────────
// SUMMARY: QUICK START
// ────────────────────────────────────────────────────────────────

/*
1. Add credentials to .env:
   VITE_CLOUDFLARE_ACCOUNT_ID=...
   VITE_CLOUDFLARE_API_TOKEN=...

2. Import enhanced providers:
   - Compose: import { generateComposeAssistText } from '@/lib/ai/enhancedAssist'
   - Insights: import { generateProfileInsights } from '@/lib/ai/enhancedAssist'
   - Moderation: import { moderateContent } from '@/lib/moderation/cloudflareModeration'
   - Translation: import { translateText } from '@/lib/translation/cloudflareTranslation'

3. All functions handle fallbacks automatically:
   - Cloudflare edge (primary)
   - Browser/API models (secondary)
   - Rule-based heuristics (final fallback)

4. Return values include source & confidence for monitoring
   
5. Mobile & low-memory devices automatically use lighter models

Ready to integrate!
*/
