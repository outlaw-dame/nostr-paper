/**
 * Spotify OAuth 2.0 PKCE flow for web apps.
 *
 * No client secret is used or needed — PKCE is the correct approach for
 * public (front-end only) apps. The Client ID is public by design.
 *
 * Security notes:
 *  - PKCE verifier/state stored in sessionStorage (same-tab only, cleared on close).
 *  - Access/refresh tokens stored in localStorage (standard SPA pattern).
 *  - state parameter guards against CSRF on the callback.
 */

const SPOTIFY_CLIENT_ID_STORAGE_KEY = 'nostr-paper:spotify-client-id'
const SPOTIFY_TOKENS_KEY = 'nostr-paper:spotify-tokens'
const PKCE_VERIFIER_KEY = 'nostr-paper:spotify-pkce-verifier'
const PKCE_STATE_KEY = 'nostr-paper:spotify-pkce-state'
const PKCE_STATE_ISSUED_AT_KEY = 'nostr-paper:spotify-pkce-state-issued-at'
const PKCE_REDIRECT_URI_KEY = 'nostr-paper:spotify-pkce-redirect-uri'

const SPOTIFY_AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize'
const SPOTIFY_TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token'
const SPOTIFY_SCOPES = 'user-read-currently-playing user-read-playback-state'
const TOKEN_REQUEST_TIMEOUT_MS = 12_000
const SPOTIFY_CLIENT_ID_PATTERN = /^[a-zA-Z0-9]{10,128}$/
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

function isSafeOAuthRedirectUri(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return true
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return true
    return false
  } catch {
    return false
  }
}

function isSecureRuntime(): boolean {
  if (typeof window === 'undefined') return false
  if (window.isSecureContext) return true
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1'
}

function isValidSpotifyClientId(value: string): boolean {
  return SPOTIFY_CLIENT_ID_PATTERN.test(value.trim())
}

function createTimeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs)
  }

  const controller = new AbortController()
  globalThis.setTimeout(() => controller.abort(), timeoutMs)
  return controller.signal
}

type SpotifyTokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
}

function isSpotifyTokenResponse(value: unknown): value is SpotifyTokenResponse {
  if (!value || typeof value !== 'object') return false

  const record = value as Record<string, unknown>
  const accessToken = record.access_token
  const refreshToken = record.refresh_token
  const expiresIn = record.expires_in

  if (typeof accessToken !== 'string' || accessToken.trim().length === 0) return false
  if (refreshToken !== undefined && (typeof refreshToken !== 'string' || refreshToken.trim().length === 0)) return false
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) return false

  return true
}

function shouldRetryTokenExchange(error: unknown, _attempt: number): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  if (!(error instanceof Error)) return false
  return error.message.startsWith('HTTP_429') || error.message.startsWith('HTTP_5') || error.message === 'NETWORK_ERROR'
}

async function tokenRequest(body: URLSearchParams): Promise<SpotifyTokenResponse | null> {
  const { withRetry, sleep } = await import('@/lib/retry')

  return withRetry(async () => {
    let response: Response
    try {
      response = await fetch(SPOTIFY_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: createTimeoutSignal(TOKEN_REQUEST_TIMEOUT_MS),
      })
    } catch {
      throw new Error('NETWORK_ERROR')
    }

    if (response.status === 429) {
      const retryAfterSeconds = Number.parseInt(response.headers.get('retry-after') ?? '0', 10)
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        await sleep(Math.min(retryAfterSeconds * 1_000, 15_000))
      }
      throw new Error('HTTP_429')
    }

    if (response.status >= 500) {
      throw new Error(`HTTP_${response.status}`)
    }

    if (!response.ok) {
      return null
    }

    const payload: unknown = await response.json()
    return isSpotifyTokenResponse(payload) ? payload : null
  }, {
    maxAttempts: 3,
    baseDelayMs: 400,
    maxDelayMs: 4_000,
    jitter: 'full',
    shouldRetry: shouldRetryTokenExchange,
  })
}

export interface SpotifyTokens {
  accessToken: string
  refreshToken: string
  /** Unix seconds when the access token expires (with 60 s buffer applied). */
  expiresAt: number
}

function clearPendingSpotifyAuthState(): void {
  window.sessionStorage.removeItem(PKCE_VERIFIER_KEY)
  window.sessionStorage.removeItem(PKCE_STATE_KEY)
  window.sessionStorage.removeItem(PKCE_STATE_ISSUED_AT_KEY)
  window.sessionStorage.removeItem(PKCE_REDIRECT_URI_KEY)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateRandomString(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Base64Url(plain: string): Promise<string> {
  const encoded = new TextEncoder().encode(plain)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  const bytes = new Uint8Array(digest)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// ── Client ID ─────────────────────────────────────────────────────────────────

/** Returns the Spotify Client ID from env var (preferred) or localStorage. */
export function getSpotifyClientId(): string {
  const envId = import.meta.env.VITE_SPOTIFY_CLIENT_ID
  if (typeof envId === 'string' && envId.trim().length > 0) {
    const trimmed = envId.trim()
    return isValidSpotifyClientId(trimmed) ? trimmed : ''
  }

  const stored = window.localStorage.getItem(SPOTIFY_CLIENT_ID_STORAGE_KEY) ?? ''
  return isValidSpotifyClientId(stored) ? stored : ''
}

/** Persists a user-supplied Spotify Client ID. Not needed when env var is set. */
export function setSpotifyClientId(id: string): void {
  const trimmed = id.trim()
  if (isValidSpotifyClientId(trimmed)) {
    window.localStorage.setItem(SPOTIFY_CLIENT_ID_STORAGE_KEY, trimmed)
  } else {
    window.localStorage.removeItem(SPOTIFY_CLIENT_ID_STORAGE_KEY)
  }
}

// ── Token storage ─────────────────────────────────────────────────────────────

export function getSpotifyTokens(): SpotifyTokens | null {
  const raw = window.localStorage.getItem(SPOTIFY_TOKENS_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SpotifyTokens>
    if (
      typeof parsed.accessToken !== 'string' || parsed.accessToken.trim().length === 0 ||
      typeof parsed.refreshToken !== 'string' || parsed.refreshToken.trim().length === 0 ||
      typeof parsed.expiresAt !== 'number' || !Number.isFinite(parsed.expiresAt)
    ) {
      clearSpotifyTokens()
      return null
    }

    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
    }
  } catch {
    clearSpotifyTokens()
    return null
  }
}

function saveSpotifyTokens(tokens: SpotifyTokens): void {
  window.localStorage.setItem(SPOTIFY_TOKENS_KEY, JSON.stringify(tokens))
}

export function clearSpotifyTokens(): void {
  window.localStorage.removeItem(SPOTIFY_TOKENS_KEY)
  clearPendingSpotifyAuthState()
}

// ── OAuth PKCE flow ───────────────────────────────────────────────────────────

/**
 * Begins the Spotify authorization flow. Redirects the page to Spotify's
 * authorization endpoint. After Spotify redirects back, call
 * `handleSpotifyCallback`.
 */
export async function initiateSpotifyAuth(clientId: string, redirectUri: string): Promise<void> {
  if (!isSecureRuntime()) {
    throw new Error('Spotify OAuth requires a secure context (HTTPS or localhost).')
  }
  if (!isValidSpotifyClientId(clientId)) {
    throw new Error('Invalid Spotify Client ID.')
  }
  if (!isSafeOAuthRedirectUri(redirectUri)) {
    throw new Error('Invalid Spotify redirect URI.')
  }

  const verifier = generateRandomString(64)
  const state = generateRandomString(16)
  const challenge = await sha256Base64Url(verifier)

  window.sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier)
  window.sessionStorage.setItem(PKCE_STATE_KEY, state)
  window.sessionStorage.setItem(PKCE_STATE_ISSUED_AT_KEY, Date.now().toString())
  window.sessionStorage.setItem(PKCE_REDIRECT_URI_KEY, redirectUri)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SPOTIFY_SCOPES,
    redirect_uri: redirectUri,
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  })

  window.location.assign(`${SPOTIFY_AUTH_ENDPOINT}?${params.toString()}`)
}

/**
 * Handles the OAuth callback after Spotify redirects back to the app.
 * Exchanges the authorization code for tokens.
 *
 * @returns `true` on success, `false` on CSRF mismatch or token exchange failure.
 */
export async function handleSpotifyCallback(
  code: string,
  state: string,
  redirectUri: string,
): Promise<boolean> {
  if (!isSecureRuntime()) return false
  if (code.trim().length === 0 || state.trim().length === 0) return false
  if (!isSafeOAuthRedirectUri(redirectUri)) return false

  const expectedState = window.sessionStorage.getItem(PKCE_STATE_KEY)
  const expectedRedirectUri = window.sessionStorage.getItem(PKCE_REDIRECT_URI_KEY)
  const issuedAtRaw = window.sessionStorage.getItem(PKCE_STATE_ISSUED_AT_KEY)
  const issuedAt = issuedAtRaw ? Number.parseInt(issuedAtRaw, 10) : NaN
  if (!expectedState || state !== expectedState) {
    clearPendingSpotifyAuthState()
    return false
  }
  if (!expectedRedirectUri || expectedRedirectUri !== redirectUri) {
    clearPendingSpotifyAuthState()
    return false
  }

  try {
    const parsedRedirect = new URL(redirectUri)
    if (parsedRedirect.origin !== window.location.origin) {
      clearPendingSpotifyAuthState()
      return false
    }
  } catch {
    clearPendingSpotifyAuthState()
    return false
  }

  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > OAUTH_STATE_TTL_MS) {
    clearPendingSpotifyAuthState()
    return false
  }

  const verifier = window.sessionStorage.getItem(PKCE_VERIFIER_KEY)
  if (!verifier) {
    clearPendingSpotifyAuthState()
    return false
  }

  const clientId = getSpotifyClientId()
  if (!clientId) {
    clearPendingSpotifyAuthState()
    return false
  }

  clearPendingSpotifyAuthState()

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  })

  const data = await tokenRequest(body)
  if (!data || typeof data.refresh_token !== 'string' || data.refresh_token.trim().length === 0) {
    return false
  }

  const now = Math.floor(Date.now() / 1000)
  saveSpotifyTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: now + data.expires_in - 60,
  })

  return true
}

// ── Token refresh ──────────────────────────────────────────────────────────────

async function refreshSpotifyToken(): Promise<SpotifyTokens | null> {
  const tokens = getSpotifyTokens()
  if (!tokens) return null

  const clientId = getSpotifyClientId()
  if (!clientId) return null

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: clientId,
  })

  const data = await tokenRequest(body)
  if (!data) {
    clearSpotifyTokens()
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  const newTokens: SpotifyTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? tokens.refreshToken,
    expiresAt: now + data.expires_in - 60,
  }

  saveSpotifyTokens(newTokens)
  return newTokens
}

/**
 * Returns a valid access token, refreshing it if expired.
 * Returns `null` if no tokens are stored or refresh fails.
 */
export async function getValidSpotifyAccessToken(): Promise<string | null> {
  const tokens = getSpotifyTokens()
  if (!tokens) return null

  const now = Math.floor(Date.now() / 1000)
  if (now < tokens.expiresAt) return tokens.accessToken

  const refreshed = await refreshSpotifyToken()
  return refreshed?.accessToken ?? null
}
