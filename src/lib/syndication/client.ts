import { fetchSyndicationSource } from '@/lib/syndication/fetch'
import { parseSyndicationFeedDocument } from '@/lib/syndication/parse'
import type { SyndicationFeed } from '@/lib/syndication/types'

const MAX_CACHE = 100

const cache = new Map<string, SyndicationFeed | null>()
const inflight = new Map<string, Promise<SyndicationFeed | null>>()

function evictIfNeeded(): void {
  if (cache.size <= MAX_CACHE) return
  const firstKey = cache.keys().next().value
  if (firstKey !== undefined) cache.delete(firstKey)
}

async function doFetch(url: string): Promise<SyndicationFeed | null> {
  const source = await fetchSyndicationSource(url)
  if (!source) return null

  return parseSyndicationFeedDocument(source.content, source.url)
}

export function peekSyndicationFeed(url: string): SyndicationFeed | null | undefined {
  if (!cache.has(url)) return undefined
  return cache.get(url) ?? null
}

export async function fetchSyndicationFeed(url: string): Promise<SyndicationFeed | null> {
  if (cache.has(url)) return cache.get(url) ?? null

  const existing = inflight.get(url)
  if (existing) return existing

  const promise = doFetch(url).then((result) => {
    inflight.delete(url)

    if (result !== null) {
      cache.set(url, result)
      evictIfNeeded()
    }

    return result
  })

  inflight.set(url, promise)
  return promise
}
