import { initAppleMusic, getAppleMusicUserToken } from './appleMusicAuth'
import type { AppleMusicWindow } from './appleMusicAuth'
import type { MusicSnapshot } from './types'

/**
 * Reads the currently playing item from the MusicKit JS player instance.
 *
 * NOTE: This only captures music playing through MusicKit JS within this app.
 * For music.apple.com playback in another tab, the existing Media Session
 * integration already handles that transparently (no auth needed).
 */
export async function getAppleMusicSnapshot(nowSeconds: number): Promise<MusicSnapshot | null> {
  if (!getAppleMusicUserToken()) return null

  const initialized = await initAppleMusic()
  if (!initialized) return null

  try {
    const mk = (window as AppleMusicWindow).MusicKit
    if (!mk) return null

    const item = mk.getInstance().nowPlayingItem
    if (!item) return null

    const artist = item.artistName ?? ''
    const title = item.title ?? ''
    if (!artist && !title) return null

    const content = artist && title
      ? `${artist} - ${title}`
      : (artist || title)

    const reference = item.songURL

    return {
      source: 'apple-music',
      content,
      ...(reference ? { reference } : {}),
      expiresAt: nowSeconds + 5 * 60,
      signature: content,
    }
  } catch {
    return null
  }
}
