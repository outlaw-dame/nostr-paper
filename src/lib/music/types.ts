export type MusicSourceKind = 'media-session' | 'spotify' | 'apple-music'

export interface MusicSnapshot {
  source: MusicSourceKind
  content: string
  reference?: string
  expiresAt: number
  /** Opaque string used to detect track changes across polls. */
  signature: string
}
