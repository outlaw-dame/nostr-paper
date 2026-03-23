/**
 * useLinkPreview
 *
 * Fetches Open Graph metadata for a single URL.
 * Returns { data, loading } — never throws.
 *
 * `data` is null when:
 *   - No proxy is configured (production without VITE_OG_PROXY_URL)
 *   - The fetch failed or timed out
 *   - The URL is null/empty
 */

import { useEffect, useState } from 'react'
import { fetchOGData, peekOGData } from '@/lib/og/fetch'
import type { OGData } from '@/lib/og/types'

interface LinkPreviewState {
  data:    OGData | null
  loading: boolean
}

interface UseLinkPreviewOptions {
  enabled?: boolean
}

function getCachedState(url: string | null | undefined, enabled: boolean): LinkPreviewState {
  if (!url || !enabled) return { data: null, loading: false }

  const cached = peekOGData(url)
  if (cached === undefined) {
    return { data: null, loading: true }
  }

  return { data: cached, loading: false }
}

export function useLinkPreview(
  url: string | null | undefined,
  options: UseLinkPreviewOptions = {},
): LinkPreviewState {
  const enabled = options.enabled ?? true
  const [state, setState] = useState<LinkPreviewState>(() => getCachedState(url, enabled))

  useEffect(() => {
    if (!url || !enabled) {
      setState(getCachedState(url, enabled))
      return
    }

    const cached = peekOGData(url)
    if (cached !== undefined) {
      setState({ data: cached, loading: false })
      return
    }

    let cancelled = false
    setState((current) => (current.loading ? current : { data: null, loading: true }))

    fetchOGData(url).then(data => {
      if (!cancelled) setState({ data, loading: false })
    })

    return () => { cancelled = true }
  }, [enabled, url])

  return state
}
