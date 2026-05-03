import { useState, useEffect, useRef } from 'react'
import { getLinkMentionCount, type LinkMentionCount } from '@/lib/db/nostr'
import { normalizeLinkUrl } from '@/lib/url/normalize'

const EMPTY: LinkMentionCount = { postCount: 0, authorCount: 0 }

/**
 * Fetches the discussion count (posts + unique authors) for a URL from the
 * local link_mentions table.
 *
 * Pass `enabled: false` to skip the query entirely — use this when there is
 * no handler to wire the result up to (avoids unnecessary DB round-trips).
 */
export function useLinkDiscussionCount(
  rawUrl: string | null | undefined,
  { enabled = true }: { enabled?: boolean } = {},
): { count: LinkMentionCount; loading: boolean } {
  const [count, setCount] = useState<LinkMentionCount>(EMPTY)
  const [loading, setLoading] = useState(false)
  const lastNormalized = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !rawUrl) {
      setCount(EMPTY)
      setLoading(false)
      lastNormalized.current = null
      return
    }

    const normalized = normalizeLinkUrl(rawUrl)
    if (!normalized) {
      setCount(EMPTY)
      setLoading(false)
      lastNormalized.current = null
      return
    }

    if (lastNormalized.current === normalized) return

    lastNormalized.current = normalized
    let cancelled = false
    setLoading(true)

    getLinkMentionCount(normalized).then((result) => {
      if (!cancelled) {
        setCount(result)
        setLoading(false)
      }
    }).catch(() => {
      if (!cancelled) {
        setCount(EMPTY)
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [rawUrl, enabled])

  return { count, loading }
}
