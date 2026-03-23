import { buildAttachmentPlaybackPlan, rankVideoPlaybackCandidates } from '@/lib/media/playback'
import { parseContentWarning } from '@/lib/nostr/contentWarning'
import { getEventExpiration, isEventExpired } from '@/lib/nostr/expiration'
import {
  canRenderMediaAttachmentInline,
  getEventMediaAttachments,
  getMediaAttachmentKind,
  getMediaAttachmentPreviewUrl,
} from '@/lib/nostr/imeta'
import { getVideoPreviewImage, parseVideoEvent } from '@/lib/nostr/video'
import { sanitizeText } from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

export const STORY_EXPIRATION_SECONDS = 24 * 60 * 60
export const STORY_LOOKBACK_SECONDS = 7 * 24 * 60 * 60
export const STORY_QUERY_KINDS = [
  Kind.ShortNote,
  Kind.Video,
  Kind.ShortVideo,
  Kind.AddressableVideo,
  Kind.AddressableShortVideo,
]

export interface StoryPlaybackSource {
  url: string
  type?: string
}

export interface StoryImageMedia {
  kind: 'image'
  src: string
  alt?: string
}

export interface StoryVideoMedia {
  kind: 'video'
  poster?: string
  sources: StoryPlaybackSource[]
  alt?: string
}

export type StoryMedia = StoryImageMedia | StoryVideoMedia

export interface StoryItem {
  id: string
  event: NostrEvent
  pubkey: string
  createdAt: number
  expiresAt: number
  route: string
  media: StoryMedia
  title?: string
  caption?: string
  isSensitive: boolean
  sensitiveReason?: string
}

export interface StoryGroup {
  pubkey: string
  items: StoryItem[]
  latestCreatedAt: number
  latestExpiresAt: number
  previewImage?: string
}

function normalizeStoryText(value: string | undefined): string | undefined {
  const normalized = sanitizeText(value ?? '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return normalized.length > 0 ? normalized : undefined
}

function buildNoteStoryMedia(event: NostrEvent): StoryMedia | null {
  for (const attachment of getEventMediaAttachments(event)) {
    if (!canRenderMediaAttachmentInline(attachment)) continue

    const kind = getMediaAttachmentKind(attachment)

    if (kind === 'image') {
      const preview = getMediaAttachmentPreviewUrl(attachment)
      if (!preview) continue

      return {
        kind: 'image',
        src: preview,
        ...(attachment.alt ? { alt: attachment.alt } : {}),
      }
    }

    if (kind === 'video') {
      const playbackPlan = buildAttachmentPlaybackPlan(attachment, 'video')
      const poster = getMediaAttachmentPreviewUrl(attachment) ?? undefined

      if (playbackPlan.sources.length > 0) {
        return {
          kind: 'video',
          sources: playbackPlan.sources,
          ...(poster ? { poster } : {}),
          ...(attachment.alt ? { alt: attachment.alt } : {}),
        }
      }

      if (poster) {
        return {
          kind: 'image',
          src: poster,
          ...(attachment.alt ? { alt: attachment.alt } : {}),
        }
      }
    }
  }

  return null
}

function buildVideoStoryMedia(event: NostrEvent): StoryMedia | null {
  const video = parseVideoEvent(event)
  if (!video) return null

  const playbackPlan = rankVideoPlaybackCandidates(video.variants)[0]
  const poster = getVideoPreviewImage(video) ?? undefined

  if ((playbackPlan?.sources.length ?? 0) > 0) {
    return {
      kind: 'video',
      sources: playbackPlan?.sources ?? [],
      ...(poster ? { poster } : {}),
      ...(video.alt ? { alt: video.alt } : {}),
    }
  }

  if (poster) {
    return {
      kind: 'image',
      src: poster,
      ...(video.alt ? { alt: video.alt } : {}),
    }
  }

  return null
}

export function parseStoryEvent(
  event: NostrEvent,
  now = Math.floor(Date.now() / 1000),
): StoryItem | null {
  const expiresAt = getEventExpiration(event)
  if (expiresAt === undefined || isEventExpired(event, now)) return null

  const parsedVideo = parseVideoEvent(event)
  const media = parsedVideo ? buildVideoStoryMedia(event) : buildNoteStoryMedia(event)
  if (!media) return null

  const contentWarning = parseContentWarning(event)
  const title = normalizeStoryText(parsedVideo?.title)
  const caption = parsedVideo
    ? normalizeStoryText(parsedVideo.summary || event.content)
    : normalizeStoryText(event.content)

  return {
    id: event.id,
    event,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    expiresAt,
    route: parsedVideo?.route ?? `/note/${event.id}`,
    media,
    ...(title ? { title } : {}),
    ...(caption ? { caption } : {}),
    isSensitive: contentWarning !== null,
    ...(contentWarning?.reason ? { sensitiveReason: contentWarning.reason } : {}),
  }
}

export function collectStoryGroups(
  events: NostrEvent[],
  now = Math.floor(Date.now() / 1000),
): StoryGroup[] {
  const itemsByAuthor = new Map<string, StoryItem[]>()
  const seen = new Set<string>()

  for (const event of events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)

    const item = parseStoryEvent(event, now)
    if (!item) continue

    const items = itemsByAuthor.get(item.pubkey) ?? []
    items.push(item)
    itemsByAuthor.set(item.pubkey, items)
  }

  return [...itemsByAuthor.entries()]
    .map(([pubkey, items]) => {
      const sortedItems = items.sort((left, right) => (
        left.createdAt - right.createdAt || left.id.localeCompare(right.id)
      ))
      const latest = sortedItems[sortedItems.length - 1]
      const previewImage = latest?.media.kind === 'image'
        ? latest.media.src
        : latest?.media.poster
      const baseGroup = {
        pubkey,
        items: sortedItems,
        latestCreatedAt: latest?.createdAt ?? 0,
        latestExpiresAt: Math.max(...sortedItems.map((item) => item.expiresAt)),
      }

      return previewImage ? { ...baseGroup, previewImage } : baseGroup
    })
    .sort((left, right) => (
      right.latestCreatedAt - left.latestCreatedAt || left.pubkey.localeCompare(right.pubkey)
    ))
}
