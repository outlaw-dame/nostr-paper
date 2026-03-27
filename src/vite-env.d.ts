/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SAFE_BROWSING_PROXY_URL?: string
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
