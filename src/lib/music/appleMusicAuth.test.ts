import { afterEach, describe, expect, it } from 'vitest'
import { clearAppleMusicUserToken, getAppleMusicUserToken } from './appleMusicAuth'

const APPLE_MUSIC_USER_TOKEN_KEY = 'nostr-paper:apple-music-user-token'

describe('apple music user token storage', () => {
  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('reads user tokens from sessionStorage', () => {
    sessionStorage.setItem(APPLE_MUSIC_USER_TOKEN_KEY, 'a'.repeat(32))

    expect(getAppleMusicUserToken()).toBe('a'.repeat(32))
  })

  it('purges legacy localStorage user tokens without restoring them', () => {
    localStorage.setItem(APPLE_MUSIC_USER_TOKEN_KEY, 'b'.repeat(32))

    expect(getAppleMusicUserToken()).toBeNull()
    expect(localStorage.getItem(APPLE_MUSIC_USER_TOKEN_KEY)).toBeNull()
  })

  it('clears session and legacy user tokens', () => {
    localStorage.setItem(APPLE_MUSIC_USER_TOKEN_KEY, 'legacy')
    sessionStorage.setItem(APPLE_MUSIC_USER_TOKEN_KEY, 'session')

    clearAppleMusicUserToken()

    expect(localStorage.getItem(APPLE_MUSIC_USER_TOKEN_KEY)).toBeNull()
    expect(sessionStorage.getItem(APPLE_MUSIC_USER_TOKEN_KEY)).toBeNull()
  })
})
