import type { ParsedVideoEvent } from '@/lib/nostr/video'
import { extractURLs, isSafeURL } from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

const STORY_SOURCE_TAG_NAMES = new Set(['r', 'url', 'source', 'canonical'])
const DIRECT_MEDIA_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif',
  'mp4', 'webm', 'mov', 'm3u8', 'mpd',
  'mp3', 'ogg', 'flac',
])

export function isArticleStoryKind(kind: number): boolean {
  return kind === Kind.LongFormContent || kind === Kind.LongFormDraft
}

export function isVideoStoryKind(kind: number): boolean {
  return (
    kind === Kind.Video ||
    kind === Kind.ShortVideo ||
    kind === Kind.AddressableVideo ||
    kind === Kind.AddressableShortVideo
  )
}

function appendCandidate(
  candidates: string[],
  seen: Set<string>,
  url: string | null | undefined,
): void {
  if (typeof url !== 'string' || !isSafeURL(url) || seen.has(url)) return
  seen.add(url)
  candidates.push(url)
}

function getEventStoryTagUrls(event: NostrEvent): string[] {
  const urls: string[] = []
  const seen = new Set<string>()

  for (const tag of event.tags) {
    const tagName = typeof tag[0] === 'string' ? tag[0].toLowerCase() : ''
    const rawUrl = typeof tag[1] === 'string' ? tag[1].trim() : ''
    if (!STORY_SOURCE_TAG_NAMES.has(tagName)) continue
    appendCandidate(urls, seen, rawUrl)
  }

  return urls
}

function getEventStoryContentUrls(event: NostrEvent): string[] {
  return extractURLs(event.content).filter((url) => !isLikelyDirectMediaFile(url))
}

function isLikelyDirectMediaFile(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    const extension = pathname.split('.').pop() ?? ''
    return extension.length > 0 && DIRECT_MEDIA_EXTENSIONS.has(extension)
  } catch {
    return false
  }
}

export function getPrimaryStorySourceUrl(
  event: NostrEvent,
  video?: ParsedVideoEvent | null,
): string | null {
  const candidates: string[] = []
  const seen = new Set<string>()

  appendCandidate(candidates, seen, video?.origin?.originalUrl)

  const referenceUrls = [
    ...(video?.references ?? []),
    ...getEventStoryTagUrls(event),
    ...getEventStoryContentUrls(event),
  ]

  for (const url of referenceUrls) {
    if (!isLikelyDirectMediaFile(url)) {
      appendCandidate(candidates, seen, url)
    }
  }

  for (const url of referenceUrls) {
    appendCandidate(candidates, seen, url)
  }

  return candidates[0] ?? null
}

export function getStoryHostname(url: string | null | undefined): string | undefined {
  if (!url) return undefined

  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

export function pickStorySummary(
  localSummary: string,
  sourceUrl: string | null,
  externalDescription: string | undefined,
): string {
  const fallback = externalDescription?.trim() ?? ''
  const trimmed = localSummary.trim()
  if (!trimmed) return fallback
  if (sourceUrl && trimmed === sourceUrl.trim()) return fallback

  const withoutUrls = trimmed.replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim()
  if (!withoutUrls) return fallback

  return trimmed
}
