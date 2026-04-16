/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SAFE_BROWSING_PROXY_URL?: string
  /**
   * Optional Feedsearch API base URL for fallback feed discovery.
   * Defaults to https://feedsearch.dev when unset.
   */
  readonly VITE_FEEDSEARCH_API_BASE?: string
  /**
   * Optional Spotify Client ID. When set, the Spotify Client ID input field
   * is hidden in Settings — the deployer has pre-configured it.
   */
  readonly VITE_SPOTIFY_CLIENT_ID?: string
  /**
   * Optional Apple MusicKit developer token (JWT, max 6 months validity).
   * Must be generated offline/server-side with the MusicKit private key from
   * the Apple Developer portal. When absent, Apple Music sign-in is disabled.
   */
  readonly VITE_APPLE_MUSIC_DEVELOPER_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface NostrNip04Api {
  encrypt(pubkey: string, plaintext: string): Promise<string>
  decrypt(pubkey: string, ciphertext: string): Promise<string>
}

interface NostrExtensionApi {
  getPublicKey?(): Promise<string>
  nip04?: NostrNip04Api
  nip44?: NostrNip04Api
}

interface Window {
  nostr?: NostrExtensionApi
}

declare module 'twemoji-parser' {
  export interface TwemojiEntity {
    type:    string
    text:    string
    url:     string
    indices: [number, number]
  }
  export interface ParseOptions {
    assetType?: 'svg' | 'png'
    buildUrl?:  (codepoints: string, assetType: string) => string
  }
  export function parse(text: string, options?: ParseOptions): TwemojiEntity[]
  export function toCodePoints(text: string): string[]
}
