import { normalizeStatusReferenceUri } from '@/lib/nostr/status'

export const MUSIC_PRESENCE_AUTOPUBLISH_KEY = 'nostr-paper:music-presence-autopublish'
export const MUSIC_PRESENCE_SETTINGS_UPDATED_EVENT = 'nostr-paper:music-presence-settings-updated'

const DEFAULT_EXPIRATION_SECONDS = 5 * 60

export interface MediaSessionMusicSnapshot {
  content: string
  reference?: string
  expiresAt: number
  signature: string
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function cleanSongSegment(value: string | null | undefined): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ').slice(0, 160)
}

function getPossibleReference(metadata: MediaMetadata): string | null {
  const unsafeMetadata = metadata as unknown as Record<string, unknown>
  const candidates = [
    unsafeMetadata.url,
    unsafeMetadata.src,
    unsafeMetadata.source,
    unsafeMetadata.permalink,
  ]

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const normalized = normalizeStatusReferenceUri(candidate)
    if (normalized) return normalized
  }

  return null
}

export function getMusicPresenceAutopublishEnabled(): boolean {
  if (!canUseStorage()) return false
  return window.localStorage.getItem(MUSIC_PRESENCE_AUTOPUBLISH_KEY) === '1'
}

export function setMusicPresenceAutopublishEnabled(enabled: boolean): void {
  if (!canUseStorage()) return

  if (enabled) {
    window.localStorage.setItem(MUSIC_PRESENCE_AUTOPUBLISH_KEY, '1')
  } else {
    window.localStorage.removeItem(MUSIC_PRESENCE_AUTOPUBLISH_KEY)
  }

  window.dispatchEvent(new CustomEvent(MUSIC_PRESENCE_SETTINGS_UPDATED_EVENT, {
    detail: { enabled },
  }))
}

export function getMediaSessionMusicSnapshot(nowSeconds = Math.floor(Date.now() / 1000)): MediaSessionMusicSnapshot | null {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return null

  const metadata = navigator.mediaSession?.metadata
  if (!metadata) return null

  const title = cleanSongSegment(metadata.title)
  const artist = cleanSongSegment(metadata.artist)
  const album = cleanSongSegment(metadata.album)

  if (!title && !artist) return null

  const content = title && artist
    ? `${artist} - ${title}`
    : (title || artist)

  if (!content) return null

  const reference = getPossibleReference(metadata) ?? undefined
  const signature = [content, reference ?? '', album].join('|')

  return {
    content,
    ...(reference ? { reference } : {}),
    expiresAt: nowSeconds + DEFAULT_EXPIRATION_SECONDS,
    signature,
  }
}

export function isMediaSessionPlaying(): boolean {
  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    if (navigator.mediaSession?.playbackState === 'playing') return true
  }

  if (typeof document === 'undefined') return false
  const mediaElements = document.querySelectorAll('audio,video')
  for (const element of mediaElements) {
    if (!(element instanceof HTMLMediaElement)) continue
    if (!element.paused && !element.ended) return true
  }

  return false
}