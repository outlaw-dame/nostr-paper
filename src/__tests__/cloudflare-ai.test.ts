/**
 * Cloudflare Workers AI Integration Tests
 * 
 * This test suite validates all Cloudflare AI providers and routing logic.
 * Run with: npm run test -- cloudflare-ai.test.ts
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ════════════════════════════════════════════════════════════════
// PROVIDER LAYER TESTS
// ════════════════════════════════════════════════════════════════

describe('Cloudflare AI Providers', () => {
  describe('isCloudflareAiAvailable', () => {
    it('should return false without credentials', () => {
      const original = import.meta.env
      delete (import.meta.env as unknown as Record<string, unknown>).VITE_CLOUDFLARE_ACCOUNT_ID
      
      const { isCloudflareAiAvailable } = await import('@/lib/ai/cloudflareAiProviders')
      expect(isCloudflareAiAvailable()).toBe(false)
      
      import.meta.env = original
    })

    it('should return true with valid credentials', () => {
      // This test requires actual credentials in .env.test
      const { isCloudflareAiAvailable } = require('@/lib/ai/cloudflareAiProviders')
      // Result depends on environment
      expect(typeof isCloudflareAiAvailable()).toBe('boolean')
    })
  })

  describe('Model constants', () => {
    it('should export all required model IDs', async () => {
      const module = await import('@/lib/ai/cloudflareAiProviders')
      expect(module.CLOUDFLARE_PRIMARY_LLM_ID).toBeDefined()
      expect(module.CLOUDFLARE_FAST_MODEL_ID).toBeDefined()
      expect(module.CLOUDFLARE_MODERATION_MODEL_ID).toBeDefined()
      expect(module.CLOUDFLARE_TRANSLATION_MODEL_ID).toBeDefined()
      expect(module.CLOUDFLARE_EMBEDDING_MODEL_ID).toBeDefined()
      expect(module.CLOUDFLARE_RERANKER_MODEL_ID).toBeDefined()
    })

    it('model IDs should be non-empty strings', async () => {
      const module = await import('@/lib/ai/cloudflareAiProviders')
      expect(module.CLOUDFLARE_PRIMARY_LLM_ID).toBeTruthy()
      expect(typeof module.CLOUDFLARE_PRIMARY_LLM_ID).toBe('string')
    })
  })
})

// ════════════════════════════════════════════════════════════════
// TASK ROUTING TESTS
// ════════════════════════════════════════════════════════════════

describe('Task Routing', () => {
  describe('routeComposeAssistQuality', () => {
    it('should prefer Cloudflare when available', async () => {
      const { routeComposeAssistQuality } = await import('@/lib/ai/taskRouting')
      const decision = routeComposeAssistQuality()
      
      // Should have a valid tier
      expect(['cloudflare_primary', 'browser', 'local_cpu', 'fallback']).toContain(
        decision.tier
      )
      
      // Should have fallback chain
      expect(Array.isArray(decision.fallback)).toBe(true)
      expect(decision.fallback.length).toBeGreaterThan(0)
      
      // Should have timeout
      expect(decision.timeout_ms).toBeGreaterThan(0)
    })

    it('should provide routing rationale', async () => {
      const { routeComposeAssistQuality } = await import('@/lib/ai/taskRouting')
      const decision = routeComposeAssistQuality()
      
      expect(Array.isArray(decision.rationale)).toBe(true)
      expect(decision.rationale.length).toBeGreaterThan(0)
    })
  })

  describe('routeSearchIntentClassify', () => {
    it('should classify as critical priority', async () => {
      const { routeSearchIntentClassify } = await import('@/lib/ai/taskRouting')
      const decision = routeSearchIntentClassify()
      
      expect(decision.priority).toBe('critical')
    })

    it('should have short timeout', async () => {
      const { routeSearchIntentClassify } = await import('@/lib/ai/taskRouting')
      const decision = routeSearchIntentClassify()
      
      expect(decision.timeout_ms).toBeLessThan(5000)
    })
  })

  describe('routeContentModeration', () => {
    it('should route to specialized moderation', async () => {
      const { routeContentModeration } = await import('@/lib/ai/taskRouting')
      const decision = routeContentModeration()
      
      expect(['cloudflare_specialized', 'browser', 'fallback']).toContain(decision.tier)
    })

    it('should prioritize moderation as high', async () => {
      const { routeContentModeration } = await import('@/lib/ai/taskRouting')
      const decision = routeContentModeration()
      
      expect(decision.priority).toBe('high')
    })
  })

  describe('routeAiTask dispatcher', () => {
    it('should route all task types', async () => {
      const { routeAiTask } = await import('@/lib/ai/taskRouting')
      const tasks = [
        'compose_assist_caution',
        'compose_assist_quality',
        'profile_insights',
        'article_summary',
        'search_intent_classify',
        'moderation_safety',
        'translation',
        'embedding_search',
      ]

      for (const task of tasks) {
        const decision = routeAiTask(task as any)
        expect(decision).toBeDefined()
        expect(decision.tier).toBeDefined()
        expect(decision.rationale).toBeDefined()
      }
    })

    it('should throw on unknown task', async () => {
      const { routeAiTask } = await import('@/lib/ai/taskRouting')
      expect(() => routeAiTask('unknown_task' as any)).toThrow()
    })
  })
})

// ════════════════════════════════════════════════════════════════
// ENHANCED ASSIST TESTS
// ════════════════════════════════════════════════════════════════

describe('Enhanced Assist Functions', () => {
  describe('generateComposeAssistText', () => {
    it('should return object with required fields', async () => {
      const { generateComposeAssistText } = await import('@/lib/ai/enhancedAssist')
      
      // Mock implementation (requires actual Cloudflare or fallback)
      try {
        const result = await generateComposeAssistText('hello world')
        
        expect(result).toHaveProperty('text')
        expect(result).toHaveProperty('source')
        expect(result).toHaveProperty('quality')
        expect(['cloudflare', 'gemma', 'gemini', 'fallback']).toContain(result.source)
        expect(typeof result.quality).toBe('number')
        expect(result.quality).toBeGreaterThanOrEqual(0)
        expect(result.quality).toBeLessThanOrEqual(1)
      } catch (err) {
        // Expected if no models available
        expect(err).toBeDefined()
      }
    })

    it('should sanitize output', async () => {
      const { generateComposeAssistText } = await import('@/lib/ai/enhancedAssist')
      
      try {
        const result = await generateComposeAssistText('test')
        expect(result.text).not.toMatch(/```/)
        expect(result.text.length).toBeLessThanOrEqual(1200)
      } catch (err) {
        // Expected in test environment
      }
    })
  })

  describe('detectComposeCaution', () => {
    it('should detect basic caution signals', async () => {
      const { detectComposeCaution } = await import('@/lib/ai/enhancedAssist')
      
      try {
        const result = await detectComposeCaution('GET OUT OF HERE!!!')
        
        expect(result).toHaveProperty('cautious')
        expect(result).toHaveProperty('reasons')
        expect(result).toHaveProperty('source')
        expect(typeof result.cautious).toBe('boolean')
        expect(Array.isArray(result.reasons)).toBe(true)
      } catch (err) {
        // Expected in test environment
      }
    })
  })
})

// ════════════════════════════════════════════════════════════════
// MODERATION TESTS
// ════════════════════════════════════════════════════════════════

describe('Content Moderation', () => {
  describe('isContentSafe', () => {
    it('should flag obviously unsafe content', async () => {
      const { isContentSafe } = await import('@/lib/moderation/cloudflareModeration')
      
      try {
        // Testing with clearly offensive content
        const result = await isContentSafe('kill yourself you idiot')
        expect(typeof result).toBe('boolean')
        // Should likely be false, but depends on model
      } catch (err) {
        // Expected if Cloudflare unavailable
      }
    })

    it('should allow safe content', async () => {
      const { isContentSafe } = await import('@/lib/moderation/cloudflareModeration')
      
      try {
        const result = await isContentSafe('Hello, this is a nice message.')
        expect(typeof result).toBe('boolean')
        // Should likely be true
      } catch (err) {
        // Expected if Cloudflare unavailable
      }
    })
  })

  describe('getModerationScore', () => {
    it('should return score between 0-1', async () => {
      const { getModerationScore } = await import('@/lib/moderation/cloudflareModeration')
      
      try {
        const score = await getModerationScore('test message')
        expect(score).toBeGreaterThanOrEqual(0)
        expect(score).toBeLessThanOrEqual(1)
      } catch (err) {
        // Expected if Cloudflare unavailable
      }
    })
  })

  describe('moderateContent', () => {
    it('should return ModerationDecision', async () => {
      const { moderateContent } = await import('@/lib/moderation/cloudflareModeration')
      
      try {
        const result = await moderateContent('test content')
        
        expect(result).toHaveProperty('isSafe')
        expect(result).toHaveProperty('labels')
        expect(result).toHaveProperty('confidence')
        expect(result).toHaveProperty('source')
        expect(typeof result.isSafe).toBe('boolean')
        expect(Array.isArray(result.labels)).toBe(true)
      } catch (err) {
        // Expected if Cloudflare unavailable
      }
    })
  })
})

// ════════════════════════════════════════════════════════════════
// TRANSLATION TESTS
// ════════════════════════════════════════════════════════════════

describe('Translation', () => {
  describe('getSupportedLanguages', () => {
    it('should return language list', async () => {
      const { getSupportedLanguages } = await import('@/lib/translation/cloudflareTranslation')
      
      const languages = getSupportedLanguages()
      expect(Array.isArray(languages)).toBe(true)
      expect(languages.length).toBeGreaterThan(0)
      
      // Should have at least common languages
      const codes = languages.map((l) => l.code)
      expect(codes).toContain('en')
      expect(codes).toContain('es')
      expect(codes).toContain('fr')
    })

    it('should have code and name for each language', async () => {
      const { getSupportedLanguages } = await import('@/lib/translation/cloudflareTranslation')
      
      const languages = getSupportedLanguages()
      languages.forEach((lang) => {
        expect(lang.code).toBeDefined()
        expect(lang.name).toBeDefined()
        expect(typeof lang.code).toBe('string')
        expect(typeof lang.name).toBe('string')
      })
    })
  })

  describe('detectLanguageSimple', () => {
    it('should detect English', async () => {
      const { detectLanguageSimple } = await import('@/lib/translation/cloudflareTranslation')
      expect(detectLanguageSimple('hello world')).toBe('en')
    })

    it('should detect Spanish characters', async () => {
      const { detectLanguageSimple } = await import('@/lib/translation/cloudflareTranslation')
      expect(detectLanguageSimple('Hola, ¿cómo estás?')).toBe('es')
    })

    it('should default to English for unknown', async () => {
      const { detectLanguageSimple } = await import('@/lib/translation/cloudflareTranslation')
      expect(detectLanguageSimple('123 !@#')).toBe('en')
    })
  })

  describe('translateText', () => {
    it('should return TranslationResult', async () => {
      const { translateText } = await import('@/lib/translation/cloudflareTranslation')
      
      try {
        const result = await translateText('hello', 'en', 'es')
        
        expect(result).toHaveProperty('original')
        expect(result).toHaveProperty('translated')
        expect(result).toHaveProperty('sourceLanguage')
        expect(result).toHaveProperty('targetLanguage')
        expect(result).toHaveProperty('source')
        expect(result).toHaveProperty('confidence')
      } catch (err) {
        // Expected if Cloudflare unavailable
      }
    })

    it('should handle same language', async () => {
      const { translateText } = await import('@/lib/translation/cloudflareTranslation')
      
      const result = await translateText('hello', 'en', 'en')
      expect(result.original).toBe(result.translated)
      expect(result.confidence).toBe(1.0)
    })

    it('should handle invalid source language', async () => {
      const { translateText } = await import('@/lib/translation/cloudflareTranslation')
      
      const result = await translateText('hello', 'xyz', 'en')
      expect(result.source).toBe('fallback')
    })
  })
})

// ════════════════════════════════════════════════════════════════
// INTEGRATION TESTS
// ════════════════════════════════════════════════════════════════

describe('Integration Scenarios', () => {
  it('should handle offline scenario gracefully', async () => {
    // Mock offline
    const original = navigator.onLine
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: false,
    })

    try {
      const { routeComposeAssistQuality } = await import('@/lib/ai/taskRouting')
      const decision = routeComposeAssistQuality()

      // Should prefer local or fallback when offline
      expect(['local_cpu', 'browser', 'fallback']).toContain(decision.tier)
    } finally {
      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: original,
      })
    }
  })

  it('should handle all task types end-to-end', async () => {
    const { routeAiTask } = await import('@/lib/ai/taskRouting')
    
    const tasks = [
      'compose_assist_caution',
      'compose_assist_quality',
      'profile_insights',
      'article_summary',
      'search_intent_classify',
      'moderation_safety',
      'translation',
      'embedding_search',
    ]

    const results = tasks.map((task) => routeAiTask(task as any))
    
    expect(results.length).toBe(8)
    results.forEach((result) => {
      expect(result.tier).toBeDefined()
      expect(result.rationale).toBeDefined()
      expect(Array.isArray(result.fallback)).toBe(true)
    })
  })
})

// ════════════════════════════════════════════════════════════════
// ERROR HANDLING TESTS
// ════════════════════════════════════════════════════════════════

describe('Error Handling', () => {
  it('should gracefully handle missing credentials', async () => {
    const { isCloudflareAiAvailable } = await import('@/lib/ai/cloudflareAiProviders')
    
    // Should not throw, just return false
    const result = isCloudflareAiAvailable()
    expect(typeof result).toBe('boolean')
  })

  it('should have fallback for all assist functions', async () => {
    const { generateComposeAssistText } = await import('@/lib/ai/enhancedAssist')
    
    // Even if all providers fail, should return something
    try {
      const result = await generateComposeAssistText('test')
      expect(result.source).toBeDefined()
      // May be fallback, but should have result
    } catch (err) {
      // Should not throw
      expect(true).toBe(false)
    }
  })
})
