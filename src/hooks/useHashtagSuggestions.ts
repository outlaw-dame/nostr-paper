import { useDeferredValue, useEffect, useState } from 'react'
import { suggestHashtagsForDraft, type HashtagSuggestion } from '@/lib/compose/hashtags'

const DEFAULT_DEBOUNCE_MS = 350

export function useHashtagSuggestions(
  draft: string,
  options: {
    enabled?: boolean
    limit?: number
    debounceMs?: number
  } = {},
): {
  suggestions: HashtagSuggestion[]
  loading: boolean
  error: string | null
} {
  const enabled = options.enabled ?? true
  const limit = options.limit ?? 6
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const deferredDraft = useDeferredValue(draft)
  const [suggestions, setSuggestions] = useState<HashtagSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setSuggestions([])
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError(null)

      suggestHashtagsForDraft(deferredDraft, {
        limit,
        signal: controller.signal,
      }).then((nextSuggestions) => {
        if (controller.signal.aborted) return
        setSuggestions(nextSuggestions)
        setLoading(false)
      }).catch((suggestionError: unknown) => {
        if (controller.signal.aborted) return
        setSuggestions([])
        setError(suggestionError instanceof Error ? suggestionError.message : 'Hashtag suggestions unavailable.')
        setLoading(false)
      })
    }, debounceMs)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [deferredDraft, debounceMs, enabled, limit])

  return {
    suggestions,
    loading,
    error,
  }
}
