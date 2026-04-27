/**
 * Polls the Spotify Web API for the user's currently playing track.
 *
 * Requires a valid access token from `getValidSpotifyAccessToken()`.
 * Spotify's `GET /v1/me/player/currently-playing` returns data across
 * all of the user's Spotify clients (desktop app, mobile, web player, etc.)
 * — not just this browser tab. This makes it significantly more useful
 * than the Media Session API for Spotify users.
 */

import { getValidSpotifyAccessToken } from './spotifyAuth'
import type { MusicSnapshot } from './types'
import { withRetry, sleep } from '@/lib/retry'

const CURRENTLY_PLAYING_URL = 'https://api.spotify.com/v1/me/player/currently-playing'
const CURRENTLY_PLAYING_TIMEOUT_MS = 10_000

function createTimeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs)
  }

  const controller = new AbortController()
  globalThis.setTimeout(() => controller.abort(), timeoutMs)
  return controller.signal
}

interface SpotifyCurrentlyPlayingResponse {
  is_playing: boolean
  currently_playing_type: string
  item: SpotifyTrackObject | null
}

interface SpotifyTrackObject {
  name: string
  artists: Array<{ name: string }>
  album?: { name: string }
  external_urls?: { spotify?: string }
  uri?: string
}

/**
 * Fetches what's currently playing on the user's Spotify account.
 *
 * @returns A `MusicSnapshot` if something is actively playing, or `null`
 *          if nothing is playing, no tokens exist, or the request fails.
 */
export async function getSpotifySnapshot(nowSeconds: number): Promise<MusicSnapshot | null> {
  const accessToken = await getValidSpotifyAccessToken()
  if (!accessToken) return null

  let response: Response
  try {
    response = await withRetry(async () => {
      let fetched: Response
      try {
        fetched = await fetch(`${CURRENTLY_PLAYING_URL}?additional_types=track`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: createTimeoutSignal(CURRENTLY_PLAYING_TIMEOUT_MS),
        })
      } catch {
        throw new Error('NETWORK_ERROR')
      }

      if (fetched.status === 429) {
        const retryAfterSeconds = Number.parseInt(fetched.headers.get('retry-after') ?? '0', 10)
        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
          await sleep(Math.min(retryAfterSeconds * 1_000, 12_000))
        }
        throw new Error('HTTP_429')
      }

      if (fetched.status >= 500) {
        throw new Error(`HTTP_${fetched.status}`)
      }

      return fetched
    }, {
      maxAttempts: 3,
      baseDelayMs: 250,
      maxDelayMs: 3_000,
      jitter: 'full',
      shouldRetry: (error) => {
        if (!(error instanceof Error)) return false
        return error.message === 'NETWORK_ERROR' || error.message.startsWith('HTTP_429') || error.message.startsWith('HTTP_5')
      },
    })
  } catch {
    return null
  }

  // 204 = endpoint returned successfully but nothing is playing
  if (response.status === 204) return null
  if (!response.ok) return null

  let data: SpotifyCurrentlyPlayingResponse
  try {
    data = await response.json() as SpotifyCurrentlyPlayingResponse
  } catch {
    return null
  }

  if (!data.is_playing) return null
  if (data.currently_playing_type !== 'track' || !data.item) return null

  const track = data.item
  const artist = track.artists.map(a => a.name).join(', ')
  const title = track.name

  if (!artist && !title) return null

  const content = artist && title
    ? `${artist} - ${title}`
    : (artist || title)

  const reference = track.external_urls?.spotify ?? track.uri

  return {
    source: 'spotify',
    content,
    ...(reference ? { reference } : {}),
    expiresAt: nowSeconds + 5 * 60,
    signature: content,
  }
}
