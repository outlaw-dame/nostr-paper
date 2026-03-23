/**
 * Tenor GIF API client
 *
 * Routes all requests through the Vite dev proxy (/__dev/tenor) in development
 * so the API key stays server-side. In production, VITE_TENOR_API_KEY is
 * embedded in the client bundle — Tenor explicitly allows this for web apps.
 *
 * If no key is configured the exported helpers return empty results silently,
 * leaving the GIF picker in a "no results" state rather than crashing.
 */

// ── Types ─────────────────────────────────────────────────────

export interface TenorGif {
  /** Stable Tenor ID — use as React key. */
  id: string
  /** Human-readable title from Tenor. */
  title: string
  /**
   * URL embedded in the published note (mediumgif preferred, falls back to gif).
   * Always ends in .gif so the NIP-92 / imeta pipeline infers image/gif correctly.
   */
  gifUrl: string
  /** Smaller preview URL (tinygif) used in the picker grid. */
  previewUrl: string
  /** Natural pixel dimensions of the preview format. */
  width: number
  height: number
}

export interface TenorResult {
  results: TenorGif[]
  /** Opaque pagination cursor; pass as `pos` to fetch the next page. */
  next: string
}

// ── Configuration ─────────────────────────────────────────────

const DEV_PROXY    = '/__dev/tenor'
const TENOR_BASE   = 'https://tenor.googleapis.com/v2'
const PROD_KEY     = import.meta.env.VITE_TENOR_API_KEY as string | undefined
const CLIENT_KEY   = 'nostr_paper'
const MEDIA_FILTER = 'gif,mediumgif,tinygif'

export function isTenorConfigured(): boolean {
  // Dev proxy is always available (returns empty results if no key is set)
  if (import.meta.env.DEV) return true
  return Boolean(PROD_KEY)
}

// ── Response parsing ──────────────────────────────────────────

interface RawMediaFormat {
  url:   string
  dims?: number[]
  size?: number
}

interface RawTenorGif {
  id:            string
  title?:        string
  media_formats: Record<string, RawMediaFormat>
}

function parseGif(raw: RawTenorGif): TenorGif | null {
  const { id, title, media_formats } = raw
  if (!id || typeof media_formats !== 'object') return null

  const gif       = media_formats['gif']
  const mediumgif = media_formats['mediumgif']
  const tinygif   = media_formats['tinygif']

  // Prefer mediumgif for publishing — same .gif format but smaller file size.
  const publishFmt = mediumgif ?? gif
  // Smallest format for the picker grid thumbnails.
  const previewFmt = tinygif ?? mediumgif ?? gif

  if (!publishFmt?.url || !previewFmt?.url) return null

  const [width = 220, height = 124] = previewFmt.dims ?? []

  return {
    id,
    title:      title ?? '',
    gifUrl:     publishFmt.url,
    previewUrl: previewFmt.url,
    width,
    height,
  }
}

function parseResponse(data: unknown): TenorResult {
  if (typeof data !== 'object' || data === null) return { results: [], next: '' }
  const raw  = data as Record<string, unknown>
  const next = typeof raw['next'] === 'string' ? raw['next'] : ''
  const gifs: TenorGif[] = []

  if (Array.isArray(raw['results'])) {
    for (const item of raw['results']) {
      const gif = parseGif(item as RawTenorGif)
      if (gif) gifs.push(gif)
    }
  }

  return { results: gifs, next }
}

// ── Fetch helper ──────────────────────────────────────────────

async function tenorFetch(
  endpoint: 'search' | 'featured',
  params: Record<string, string>,
): Promise<TenorResult> {
  let url: string

  if (import.meta.env.DEV) {
    const qs = new URLSearchParams({ endpoint, ...params }).toString()
    url = `${DEV_PROXY}?${qs}`
  } else {
    if (!PROD_KEY) return { results: [], next: '' }
    const qs = new URLSearchParams({
      key:          PROD_KEY,
      client_key:   CLIENT_KEY,
      media_filter: MEDIA_FILTER,
      ...params,
    }).toString()
    url = `${TENOR_BASE}/${endpoint}?${qs}`
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
  if (!res.ok) throw new Error(`Tenor API error: ${res.status}`)
  return parseResponse(await res.json())
}

// ── Public API ────────────────────────────────────────────────

export async function searchGifs(
  query: string,
  limit = 20,
  pos?: string,
): Promise<TenorResult> {
  const params: Record<string, string> = {
    q:     query.trim(),
    limit: String(limit),
  }
  if (pos) params['pos'] = pos
  return tenorFetch('search', params)
}

export async function fetchFeaturedGifs(
  limit = 20,
  pos?: string,
): Promise<TenorResult> {
  const params: Record<string, string> = { limit: String(limit) }
  if (pos) params['pos'] = pos
  return tenorFetch('featured', params)
}
