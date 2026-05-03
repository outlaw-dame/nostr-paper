/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SAFE_BROWSING_PROXY_URL?: string
  /**
   * Path or URL to the Gemma 4 E2B model file (.task).
   * Download from: https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm
   * Place in public/models/ and set to e.g. /models/gemma-4-E2B-it-web.task
   */
  readonly VITE_GEMMA_E2B_MODEL_PATH?: string
  /**
   * Path or URL to the Gemma 4 E4B model file (.task).
   * Download from: https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm
   * Place in public/models/ and set to e.g. /models/gemma-4-E4B-it-web.task
   */
  readonly VITE_GEMMA_E4B_MODEL_PATH?: string
  /**
   * URL to the @mediapipe/tasks-genai WASM runtime directory.
   * Defaults to /vendor/mediapipe/tasks-genai/wasm, which is synced from
   * node_modules into public/ by scripts/sync-gemma-wasm.mjs.
   * Override to use CDN: https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm
   */
  readonly VITE_GEMMA_WASM_PATH?: string
  /** Maximum combined input + output tokens. Defaults to 1024. */
  readonly VITE_GEMMA_MAX_TOKENS?: string
  /** Sampling temperature (0–2). Defaults to 0.8. */
  readonly VITE_GEMMA_TEMPERATURE?: string
  /** Top-K sampling width. Defaults to 40. */
  readonly VITE_GEMMA_TOP_K?: string
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
  /**
   * Override the Tagr moderation relay URL. Defaults to wss://relay.nos.social.
   * In dev, set to ws://localhost:5173/__dev/relay-ws to route Tagr connections
   * through the Vite WebSocket relay proxy instead of directly to the relay.
   */
  readonly VITE_TAGR_RELAY_URL?: string
  /**
   * Optional comma-separated Tagr relay URL list.
   * Entries are prioritized before built-in Tagr defaults.
   */
  readonly VITE_TAGR_RELAY_URLS?: string
  /**
   * Optional override for the trusted Tagr bot pubkey (hex).
   * Defaults to the canonical Nos Social Tagr bot pubkey.
   */
  readonly VITE_TAGR_BOT_PUBKEY?: string
  /**
   * Optional Nostr-compatible platform search relay URL. When set, thread
   * views can hydrate root conversations through `thread_id` and
   * `thread_address` filters before falling back to public relays.
   */
  readonly VITE_PLATFORM_SEARCH_RELAY_URL?: string
  /**
   * Optional comma-separated Blossom server defaults. Useful for deployments
   * that provide a first-party Cloudflare/R2 + Filebase media edge.
   */
  readonly VITE_DEFAULT_BLOSSOM_SERVERS?: string
  /**
   * Optional comma-separated relay defaults prepended to the built-in relay set.
   */
  readonly VITE_DEFAULT_RELAY_URLS?: string
  /**
   * When true, only VITE_DEFAULT_RELAY_URLS is used as the default relay set.
   */
  readonly VITE_DEFAULT_RELAYS_EXCLUSIVE?: string
  /**
   * When true, init ignores stored relay preferences and always uses defaults.
   */
  readonly VITE_FORCE_DEFAULT_RELAYS?: string
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
