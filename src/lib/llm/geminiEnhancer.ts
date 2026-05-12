/**
 * Gemini Enhancer
 *
 * Disabled by default for privacy and key-safety reasons. Build-time VITE_*
 * variables are browser-delivered public configuration, so this module must not
 * read API keys from import.meta.env. Remote enhancement should be added through
 * a server-side proxy or an explicit user-provided runtime key flow.
 */

const ENHANCER_ENABLED = false

export async function enhanceSearchQuery(query: string): Promise<string> {
  return query
}

export async function enrichModerationContext(text: string): Promise<string> {
  return text
}

export function isGeminiEnhancerActive(): boolean {
  return ENHANCER_ENABLED
}

export const _geminiEnhancerConfig = {
  enabled: ENHANCER_ENABLED,
  hasKey: false,
  model: 'disabled',
  timeoutMs: 0,
} as const
