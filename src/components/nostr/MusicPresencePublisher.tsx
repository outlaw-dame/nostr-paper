import { useEffect, useRef, useState } from 'react'
import { useApp } from '@/contexts/app-context'
import {
  MUSIC_PRESENCE_SETTINGS_UPDATED_EVENT,
  getMediaSessionMusicSnapshot,
  getMusicPresenceAutopublishEnabled,
  isMediaSessionPlaying,
} from '@/lib/nostr/musicPresence'
import { clearMusicStatus, publishMusicStatus } from '@/lib/nostr/status'
import { getSpotifyTokens } from '@/lib/music/spotifyAuth'
import { getSpotifySnapshot } from '@/lib/music/spotifyPresence'
import { getAppleMusicUserToken } from '@/lib/music/appleMusicAuth'
import { getAppleMusicSnapshot } from '@/lib/music/appleMusicPresence'
import type { MusicSnapshot } from '@/lib/music/types'

const POLL_MS = 15_000
/** Minimum interval between Spotify/Apple Music API calls (more expensive than local reads). */
const API_SOURCE_POLL_SECONDS = 30
const REPUBLISH_SECONDS = 2 * 60
const CLEAR_GRACE_SECONDS = 45

export function MusicPresencePublisher() {
  const { currentUser } = useApp()
  const [enabled, setEnabled] = useState(() => getMusicPresenceAutopublishEnabled())
  const lastSignatureRef = useRef<string | null>(null)
  const lastPublishAtRef = useRef<number>(0)
  const lastPlayingAtRef = useRef<number>(0)
  const hasPublishedRef = useRef(false)
  const lastApiPollAtRef = useRef<number>(0)
  const apiSnapshotRef = useRef<MusicSnapshot | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const syncPreference = () => {
      setEnabled(getMusicPresenceAutopublishEnabled())
    }

    window.addEventListener(MUSIC_PRESENCE_SETTINGS_UPDATED_EVENT, syncPreference)
    window.addEventListener('storage', syncPreference)
    return () => {
      window.removeEventListener(MUSIC_PRESENCE_SETTINGS_UPDATED_EVENT, syncPreference)
      window.removeEventListener('storage', syncPreference)
    }
  }, [])

  useEffect(() => {
    if (!currentUser?.pubkey || !enabled) return

    let cancelled = false

    const tick = async () => {
      if (cancelled) return

      const now = Math.floor(Date.now() / 1000)

      // Poll API-backed sources at a slower rate to respect rate limits.
      const shouldPollApi = now - lastApiPollAtRef.current >= API_SOURCE_POLL_SECONDS
      if (shouldPollApi) {
        lastApiPollAtRef.current = now

        // Priority: Spotify > Apple Music. First one that returns a track wins.
        let apiSnapshot: MusicSnapshot | null = null

        if (getSpotifyTokens()) {
          apiSnapshot = await getSpotifySnapshot(now)
        }

        if (!apiSnapshot && getAppleMusicUserToken()) {
          apiSnapshot = await getAppleMusicSnapshot(now)
        }

        if (!cancelled) {
          apiSnapshotRef.current = apiSnapshot
        }
      }

      // Resolve the best available snapshot: prefer API sources over Media Session.
      const apiSnapshot = apiSnapshotRef.current
      const mediaSnapshot = getMediaSessionMusicSnapshot(now)
      const mediaPlaying = isMediaSessionPlaying()

      const snapshot: MusicSnapshot | null = apiSnapshot
        ?? (mediaPlaying && mediaSnapshot
          ? { ...mediaSnapshot, source: 'media-session' as const }
          : null)

      if (snapshot) {
        lastPlayingAtRef.current = now

        const needsRepublish =
          snapshot.signature !== lastSignatureRef.current
          || now - lastPublishAtRef.current >= REPUBLISH_SECONDS

        if (!needsRepublish) return

        try {
          await publishMusicStatus({
            content: snapshot.content,
            ...(snapshot.reference ? { reference: snapshot.reference } : {}),
            expiresAt: snapshot.expiresAt,
          })
          if (cancelled) return
          lastSignatureRef.current = snapshot.signature
          lastPublishAtRef.current = now
          hasPublishedRef.current = true
        } catch {
          // Silent degradation: auto-publish should never interrupt user flow.
        }

        return
      }

      if (!hasPublishedRef.current) return
      if (now - lastPlayingAtRef.current < CLEAR_GRACE_SECONDS) return

      try {
        await clearMusicStatus()
      } catch {
        // Ignore clear failures; next tick may succeed.
      } finally {
        if (!cancelled) {
          hasPublishedRef.current = false
          lastSignatureRef.current = null
          lastPublishAtRef.current = now
          apiSnapshotRef.current = null
        }
      }
    }

    void tick()
    const intervalId = window.setInterval(() => {
      void tick()
    }, POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [currentUser?.pubkey, enabled])

  return null
}