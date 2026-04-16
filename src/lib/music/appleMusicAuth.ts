/**
 * Apple Music integration via MusicKit JS.
 *
 * IMPORTANT CONSTRAINTS:
 *  1. A MusicKit Developer Token (JWT) must be provided via the
 *     `VITE_APPLE_MUSIC_DEVELOPER_TOKEN` environment variable. This token is
 *     signed with a private MusicKit key from the Apple Developer portal and
 *     has a maximum validity of 6 months. The private key MUST NOT be
 *     embedded in frontend code — generate the JWT server-side or offline
 *     and supply the resulting token as a build-time env var.
 *
 *  2. The MusicKit JS `nowPlayingItem` only reports music playing through
 *     this app's MusicKit player instance. It does NOT read from the macOS
 *     Music app, the iOS Music app, or any other browser tab. For music
 *     playing on music.apple.com in another tab, the Media Session API
 *     (already integrated) captures that passively without any auth.
 *
 * When the developer token is not configured, the UI surfaces a "Requires
 * setup" notice and the connection flow is disabled.
 */

const APPLE_MUSIC_USER_TOKEN_KEY = 'nostr-paper:apple-music-user-token'
const MUSICKIT_CDN = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js'
const APPLE_DEVELOPER_TOKEN_EXPIRY_SKEW_SECONDS = 60

export type AppleMusicDeveloperTokenStatus =
  | { valid: true; expiresAt?: number }
  | { valid: false; reason: 'missing' | 'invalid-format' | 'expired' }

function isSecureRuntime(): boolean {
  if (typeof window === 'undefined') return false
  if (window.isSecureContext) return true
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1'
}

// ── Developer token ───────────────────────────────────────────────────────────

export function getAppleMusicDeveloperToken(): string {
  const token = import.meta.env.VITE_APPLE_MUSIC_DEVELOPER_TOKEN
  return typeof token === 'string' ? token.trim() : ''
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const payload = parts[1]
  if (!payload) return null

  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const paddingLength = (4 - (normalized.length % 4)) % 4
    const padded = normalized + '='.repeat(paddingLength)
    const decoded = atob(padded)
    const parsed: unknown = JSON.parse(decoded)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export function getAppleMusicDeveloperTokenStatus(nowSeconds: number = Math.floor(Date.now() / 1000)): AppleMusicDeveloperTokenStatus {
  const token = getAppleMusicDeveloperToken()
  if (!token) {
    return { valid: false, reason: 'missing' }
  }

  const payload = decodeJwtPayload(token)
  if (!payload) {
    return { valid: false, reason: 'invalid-format' }
  }

  const expRaw = payload.exp
  if (expRaw === undefined) {
    return { valid: true }
  }

  const exp = typeof expRaw === 'number'
    ? expRaw
    : typeof expRaw === 'string'
      ? Number.parseInt(expRaw, 10)
      : NaN

  if (!Number.isFinite(exp)) {
    return { valid: false, reason: 'invalid-format' }
  }

  if (exp <= nowSeconds + APPLE_DEVELOPER_TOKEN_EXPIRY_SKEW_SECONDS) {
    return { valid: false, reason: 'expired' }
  }

  return { valid: true, expiresAt: exp }
}

export function isAppleMusicConfigured(): boolean {
  return getAppleMusicDeveloperTokenStatus().valid
}

// ── User token storage ────────────────────────────────────────────────────────

export function getAppleMusicUserToken(): string | null {
  const token = window.localStorage.getItem(APPLE_MUSIC_USER_TOKEN_KEY)
  if (!token) return null
  const trimmed = token.trim()
  if (trimmed.length < 20) {
    clearAppleMusicUserToken()
    return null
  }
  return trimmed
}

export function clearAppleMusicUserToken(): void {
  window.localStorage.removeItem(APPLE_MUSIC_USER_TOKEN_KEY)
}

// ── MusicKit JS loader ────────────────────────────────────────────────────────

function isMusicKitLoaded(): boolean {
  return typeof window !== 'undefined' && 'MusicKit' in window
}

function loadMusicKitScript(): Promise<void> {
  if (isMusicKitLoaded()) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${MUSICKIT_CDN}"]`)
    if (existing) {
      // Script tag already added — wait for the musickitloaded event
      document.addEventListener('musickitloaded', () => resolve(), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = MUSICKIT_CDN
    script.crossOrigin = 'anonymous'
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => reject(new Error('MusicKit JS failed to load')), { once: true })
    document.head.appendChild(script)
  })
}

// ── MusicKit instance ─────────────────────────────────────────────────────────

export async function initAppleMusic(): Promise<boolean> {
  if (!isSecureRuntime()) return false
  const developerToken = getAppleMusicDeveloperToken()
  if (!developerToken) return false

  try {
    await loadMusicKitScript()

    const mk = (window as AppleMusicWindow).MusicKit
    if (!mk) return false

    await mk.configure({
      developerToken,
      app: { name: 'Nostr Paper', build: '1.0.0' },
    })
    return true
  } catch {
    return false
  }
}

/**
 * Prompts the user to authorize Apple Music. Returns the user token on
 * success, or `null` if the user declines or auth fails.
 */
export async function authorizeAppleMusic(): Promise<string | null> {
  if (!isSecureRuntime()) return null
  if (!isAppleMusicConfigured()) return null

  const initialized = await initAppleMusic()
  if (!initialized) return null

  try {
    const mk = (window as AppleMusicWindow).MusicKit
    if (!mk) return null
    const instance = mk.getInstance()
    const userToken = await instance.authorize()
    if (typeof userToken === 'string' && userToken.length > 0) {
      window.localStorage.setItem(APPLE_MUSIC_USER_TOKEN_KEY, userToken)
      return userToken
    }
    return null
  } catch {
    return null
  }
}

/**
 * Revokes the Apple Music authorization and removes the stored user token.
 */
export async function unauthorizeAppleMusic(): Promise<void> {
  try {
    if (isMusicKitLoaded()) {
      const mk = (window as AppleMusicWindow).MusicKit
      await mk?.getInstance().unauthorize()
    }
  } catch {
    // Best-effort; always clear local token
  }
  clearAppleMusicUserToken()
}

// ── Minimal MusicKit JS type shims ────────────────────────────────────────────

export interface MusicKitNowPlayingItem {
  title?: string
  artistName?: string
  albumName?: string
  songURL?: string
}

export interface MusicKitInstance {
  authorize(): Promise<string>
  unauthorize(): Promise<void>
  readonly nowPlayingItem: MusicKitNowPlayingItem | null
}

export interface MusicKitStatic {
  configure(config: { developerToken: string; app: { name: string; build: string } }): Promise<void>
  getInstance(): MusicKitInstance
}

export interface AppleMusicWindow extends Window {
  MusicKit?: MusicKitStatic
}
