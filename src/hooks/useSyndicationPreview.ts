import { useEffect, useState } from 'react'
import { fetchSyndicationFeed, peekSyndicationFeed } from '@/lib/syndication/client'
import type { SyndicationFeed } from '@/lib/syndication/types'

interface SyndicationPreviewState {
  feed: SyndicationFeed | null
  loading: boolean
}

interface UseSyndicationPreviewOptions {
  enabled?: boolean
}

function getCachedState(url: string | null | undefined, enabled: boolean): SyndicationPreviewState {
  if (!url || !enabled) return { feed: null, loading: false }

  const cached = peekSyndicationFeed(url)
  if (cached === undefined) {
    return { feed: null, loading: true }
  }

  return { feed: cached, loading: false }
}

export function useSyndicationPreview(
  url: string | null | undefined,
  options: UseSyndicationPreviewOptions = {},
): SyndicationPreviewState {
  const enabled = options.enabled ?? true
  const [state, setState] = useState<SyndicationPreviewState>(() => getCachedState(url, enabled))

  useEffect(() => {
    if (!url || !enabled) {
      setState(getCachedState(url, enabled))
      return
    }

    const cached = peekSyndicationFeed(url)
    if (cached !== undefined) {
      setState({ feed: cached, loading: false })
      return
    }

    let cancelled = false
    setState((current) => (current.loading ? current : { feed: null, loading: true }))

    fetchSyndicationFeed(url).then((feed) => {
      if (!cancelled) setState({ feed, loading: false })
    })

    return () => {
      cancelled = true
    }
  }, [enabled, url])

  return state
}
