import { afterEach, describe, expect, it } from 'vitest'
import { clearSpotifyTokens, getSpotifyTokens } from './spotifyAuth'

const SPOTIFY_TOKENS_KEY = 'nostr-paper:spotify-tokens'

describe('spotify token storage', () => {
  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('reads OAuth tokens from sessionStorage', () => {
    sessionStorage.setItem(SPOTIFY_TOKENS_KEY, JSON.stringify({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: 4_102_444_800,
    }))

    expect(getSpotifyTokens()).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: 4_102_444_800,
    })
  })

  it('purges legacy localStorage OAuth tokens without restoring them', () => {
    localStorage.setItem(SPOTIFY_TOKENS_KEY, JSON.stringify({
      accessToken: 'legacy-access-token',
      refreshToken: 'legacy-refresh-token',
      expiresAt: 4_102_444_800,
    }))

    expect(getSpotifyTokens()).toBeNull()
    expect(localStorage.getItem(SPOTIFY_TOKENS_KEY)).toBeNull()
  })

  it('clears session and legacy OAuth tokens', () => {
    localStorage.setItem(SPOTIFY_TOKENS_KEY, 'legacy')
    sessionStorage.setItem(SPOTIFY_TOKENS_KEY, 'session')

    clearSpotifyTokens()

    expect(localStorage.getItem(SPOTIFY_TOKENS_KEY)).toBeNull()
    expect(sessionStorage.getItem(SPOTIFY_TOKENS_KEY)).toBeNull()
  })
})
