export type AiAssistProvider = 'auto' | 'gemma' | 'gemini'

const STORAGE_KEY = 'nostr-paper:ai-assist-provider:v1'
export const AI_ASSIST_PROVIDER_UPDATED_EVENT = 'nostr-paper:ai-assist-provider-updated'

function normalizeProvider(value: unknown): AiAssistProvider {
  if (value === 'gemma' || value === 'gemini') return value
  return 'auto'
}

export function getAiAssistProvider(): AiAssistProvider {
  if (typeof window === 'undefined') return 'auto'

  try {
    return normalizeProvider(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return 'auto'
  }
}

export function setAiAssistProvider(provider: AiAssistProvider): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(STORAGE_KEY, provider)
  } catch {
    return
  }

  window.dispatchEvent(new CustomEvent(AI_ASSIST_PROVIDER_UPDATED_EVENT, {
    detail: { provider },
  }))
}
