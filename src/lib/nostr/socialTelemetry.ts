export type SocialPublishFeature = 'reaction' | 'repost' | 'zap' | 'dm'

export type SocialPublishFailureCategory =
  | 'abort'
  | 'signer'
  | 'relay'
  | 'network'
  | 'validation'
  | 'unknown'

type CounterKey = `${SocialPublishFeature}:${SocialPublishFailureCategory}`

const counters = new Map<CounterKey, number>()

export function classifySocialPublishFailure(error: unknown): SocialPublishFailureCategory {
  if (error instanceof DOMException && error.name === 'AbortError') return 'abort'

  const message = error instanceof Error
    ? error.message.toLowerCase()
    : String(error).toLowerCase()

  if (
    message.includes('signer') ||
    message.includes('nip-07') ||
    message.includes('nip07') ||
    message.includes('permission') ||
    message.includes('rejected')
  ) {
    return 'signer'
  }

  if (
    message.includes('invalid') ||
    message.includes('malformed') ||
    message.includes('requires') ||
    message.includes('must')
  ) {
    return 'validation'
  }

  if (
    message.includes('relay') ||
    message.includes('eose') ||
    message.includes('publish')
  ) {
    return 'relay'
  }

  if (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('timeout') ||
    message.includes('offline') ||
    message.includes('http')
  ) {
    return 'network'
  }

  return 'unknown'
}

export function recordSocialPublishFailure(
  feature: SocialPublishFeature,
  category: SocialPublishFailureCategory,
): void {
  const key: CounterKey = `${feature}:${category}`
  counters.set(key, (counters.get(key) ?? 0) + 1)
}

export function getSocialTelemetrySnapshot(): Record<CounterKey, number> {
  const snapshot: Record<string, number> = {}
  for (const [key, value] of counters.entries()) {
    snapshot[key] = value
  }
  return snapshot as Record<CounterKey, number>
}

export function resetSocialTelemetryForTests(): void {
  counters.clear()
}
