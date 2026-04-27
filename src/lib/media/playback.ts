import { isSafeURL } from '@/lib/security/sanitize'
import type { Nip92MediaAttachment } from '@/types'

export type MediaPlaybackKind = 'video' | 'audio'
export type MediaPlaybackProfile = 'open' | 'compatibility' | 'streaming' | 'unknown'
export type MediaPlayability = 'probably' | 'maybe' | 'unknown' | 'unsupported'

export interface PlaybackSourceDescriptor {
  url: string
  type?: string
}

export interface PlaybackCandidateLike {
  url: string
  mimeType?: string
  fallbacks?: string[]
  dim?: string
  bitrate?: number
  durationSeconds?: number
}

export interface RankedPlaybackCandidate<T extends PlaybackCandidateLike> {
  candidate: T
  sources: PlaybackSourceDescriptor[]
  profile: MediaPlaybackProfile
  playability: MediaPlayability
}

type MediaCanPlayResult = 'probably' | 'maybe' | ''
type MediaCanPlayEvaluator = (kind: MediaPlaybackKind, type: string) => MediaCanPlayResult | undefined

const STREAMING_BASE_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'application/dash+xml',
])

const OPEN_BASE_TYPES = new Set([
  'video/webm',
  'audio/webm',
  'video/ogg',
  'audio/ogg',
  'audio/opus',
  'audio/flac',
  // Matroska container — commonly carries AV1, VP9, Opus
  'video/x-matroska',
  'video/matroska',
])

const COMPATIBILITY_BASE_TYPES = new Set([
  'video/mp4',
  'audio/mp4',
  'audio/aac',
  'audio/mpeg',
])

const OPEN_CODEC_PREFIXES = ['av01', 'av1', 'vp08', 'vp8', 'vp09', 'vp9', 'opus', 'vorbis', 'flac', 'theora']
const COMPATIBILITY_CODEC_PREFIXES = ['avc1', 'avc3', 'h264', 'mp4a', 'aac', 'hev1', 'hvc1']

const supportCache = new Map<string, MediaCanPlayResult | undefined>()

function normalizeMimeType(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function getBaseMimeType(value: string | undefined): string | undefined {
  const normalized = normalizeMimeType(value)
  if (!normalized) return undefined
  return normalized.split(';', 1)[0]?.trim().toLowerCase() || undefined
}

function getCodecTokens(value: string | undefined): string[] {
  const normalized = normalizeMimeType(value)
  if (!normalized) return []
  const match = normalized.match(/codecs\s*=\s*"?([^";]+)"?/i)
  if (!match?.[1]) return []
  return match[1]
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
}

function inferMimeTypeFromUrl(url: string, kind: MediaPlaybackKind): string | undefined {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    if (pathname.endsWith('.webm')) return kind === 'audio' ? 'audio/webm' : 'video/webm'
    if (pathname.endsWith('.mp4') || pathname.endsWith('.m4v')) return kind === 'audio' ? 'audio/mp4' : 'video/mp4'
    if (pathname.endsWith('.m4a')) return 'audio/mp4'
    if (pathname.endsWith('.mp3')) return 'audio/mpeg'
    if (pathname.endsWith('.aac')) return 'audio/aac'
    if (pathname.endsWith('.opus')) return 'audio/opus'
    if (pathname.endsWith('.oga') || pathname.endsWith('.ogg')) return kind === 'audio' ? 'audio/ogg' : 'video/ogg'
    if (pathname.endsWith('.ogv')) return 'video/ogg'
    if (pathname.endsWith('.flac')) return 'audio/flac'
    if (pathname.endsWith('.mkv')) return 'video/x-matroska'
    if (pathname.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl'
    if (pathname.endsWith('.mpd')) return 'application/dash+xml'
  } catch {
    return undefined
  }

  return undefined
}

function buildProbeTypes(
  kind: MediaPlaybackKind,
  mimeType: string | undefined,
  url: string,
): string[] {
  const normalized = normalizeMimeType(mimeType)
  const base = getBaseMimeType(normalized) ?? inferMimeTypeFromUrl(url, kind)
  const probes = new Set<string>()

  if (normalized) probes.add(normalized)
  if (base && base !== normalized) probes.add(base)

  switch (base) {
    case 'video/webm':
      // VP9 + Opus (best cross-platform open profile)
      probes.add('video/webm; codecs="vp9,opus"')
      // AV1 + Opus (highest quality open profile, Chrome 70+, Firefox 67+)
      probes.add('video/webm; codecs="av01.0.05M.08,opus"')
      // VP8 + Vorbis (widest legacy open support)
      probes.add('video/webm; codecs="vp8,vorbis"')
      break
    case 'audio/webm':
      probes.add('audio/webm; codecs="opus"')
      break
    case 'video/mp4':
      // AV1 in ISOBMFF — supported in Chrome 70+, Firefox 67+, Safari 17+ (AVIF decoder shares)
      probes.add('video/mp4; codecs="av01.0.05M.08,opus"')
      probes.add('video/mp4; codecs="av01.0.05M.08,mp4a.40.2"')
      // VP9 in MP4 — supported in Chrome/Edge/Firefox
      probes.add('video/mp4; codecs="vp09.00.10.08,mp4a.40.2"')
      // H.264 + AAC — compatibility baseline
      probes.add('video/mp4; codecs="avc1.42E01E,mp4a.40.2"')
      break
    case 'audio/mp4':
      probes.add('audio/mp4; codecs="mp4a.40.2"')
      probes.add('audio/mp4; codecs="opus"')
      break
    case 'video/x-matroska':
    case 'video/matroska':
      // Matroska probed via WebM as browsers map MKV parsing through the same engine
      probes.add('video/webm; codecs="av01.0.05M.08,opus"')
      probes.add('video/webm; codecs="vp9,opus"')
      break
    case 'application/vnd.apple.mpegurl':
      probes.add('application/x-mpegurl')
      break
    case 'application/x-mpegurl':
      probes.add('application/vnd.apple.mpegurl')
      break
  }

  return [...probes]
}

function defaultCanPlay(kind: MediaPlaybackKind, type: string): MediaCanPlayResult | undefined {
  if (typeof document === 'undefined') return undefined

  const cacheKey = `${kind}\u0000${type}`
  if (supportCache.has(cacheKey)) return supportCache.get(cacheKey)

  let result: MediaCanPlayResult | undefined
  try {
    const element = document.createElement(kind)
    const rawResult = typeof element.canPlayType === 'function'
      ? element.canPlayType(type)
      : ''
    result = rawResult === 'probably' || rawResult === 'maybe' ? rawResult : ''
  } catch {
    result = undefined
  }

  supportCache.set(cacheKey, result)
  return result
}

function getPlayabilityRank(value: MediaPlayability): number {
  switch (value) {
    case 'probably':
      return 3
    case 'maybe':
      return 2
    case 'unknown':
      return 1
    default:
      return 0
  }
}

function getProfileRank(value: MediaPlaybackProfile): number {
  switch (value) {
    case 'open':
      return 3
    case 'compatibility':
      return 2
    case 'streaming':
      return 1
    default:
      return 0
  }
}

function getSourcePlaybackSummary(
  kind: MediaPlaybackKind,
  source: PlaybackSourceDescriptor,
  evaluator?: MediaCanPlayEvaluator,
): {
  profile: MediaPlaybackProfile
  playability: MediaPlayability
} {
  return {
    profile: getMediaPlaybackProfile(source.type, source.url, kind),
    playability: getMediaPlayability(kind, source.type, source.url, evaluator),
  }
}

function getPixelArea(dim: string | undefined): number {
  if (!dim || !/^\d{1,6}x\d{1,6}$/.test(dim)) return 0
  const [width, height] = dim.split('x').map(Number)
  return width && height ? width * height : 0
}

function isPlaylistCandidate(candidate: PlaybackCandidateLike): boolean {
  const baseMimeType = getBaseMimeType(candidate.mimeType) ?? inferMimeTypeFromUrl(candidate.url, 'video')
  return baseMimeType ? STREAMING_BASE_TYPES.has(baseMimeType) : false
}

export function getMediaPlaybackProfile(
  mimeType: string | undefined,
  url: string,
  kind: MediaPlaybackKind = 'video',
): MediaPlaybackProfile {
  const baseMimeType = getBaseMimeType(mimeType) ?? inferMimeTypeFromUrl(url, kind)
  const codecTokens = getCodecTokens(mimeType)

  const hasOpenCodec = codecTokens.some((token) => OPEN_CODEC_PREFIXES.some(prefix => token.startsWith(prefix)))
  const hasCompatibilityCodec = codecTokens.some((token) => COMPATIBILITY_CODEC_PREFIXES.some(prefix => token.startsWith(prefix)))

  if (hasOpenCodec && !hasCompatibilityCodec) return 'open'
  if (hasCompatibilityCodec && !hasOpenCodec) return 'compatibility'
  if (baseMimeType && STREAMING_BASE_TYPES.has(baseMimeType)) return 'streaming'
  if (baseMimeType && OPEN_BASE_TYPES.has(baseMimeType)) return 'open'
  if (baseMimeType && COMPATIBILITY_BASE_TYPES.has(baseMimeType)) return 'compatibility'

  return 'unknown'
}

export function getMediaPlaybackProfileLabel(profile: MediaPlaybackProfile): string {
  switch (profile) {
    case 'open':
      return 'Open Profile'
    case 'compatibility':
      return 'Compatibility Profile'
    case 'streaming':
      return 'Streaming Profile'
    default:
      return 'Unknown Profile'
  }
}

export function getMediaPlayability(
  kind: MediaPlaybackKind,
  mimeType: string | undefined,
  url: string,
  evaluator?: MediaCanPlayEvaluator,
): MediaPlayability {
  const canPlay = evaluator ?? defaultCanPlay
  const probes = buildProbeTypes(kind, mimeType, url)
  if (probes.length === 0) return 'unknown'

  let best: MediaPlayability = 'unsupported'
  let sawDefinitiveSignal = false

  for (const probe of probes) {
    const result = canPlay(kind, probe)
    if (result === undefined) continue
    sawDefinitiveSignal = true
    if (result === 'probably') return 'probably'
    if (result === 'maybe') best = 'maybe'
  }

  return sawDefinitiveSignal ? best : 'unknown'
}

export function buildPlaybackSourceList(
  kind: MediaPlaybackKind,
  candidate: Pick<PlaybackCandidateLike, 'url' | 'mimeType' | 'fallbacks'>,
): PlaybackSourceDescriptor[] {
  const urls = [candidate.url, ...(candidate.fallbacks ?? [])]
    .filter((value): value is string => typeof value === 'string' && isSafeURL(value))

  return [...new Set(urls)].map((url) => {
    const type = url === candidate.url
      ? (normalizeMimeType(candidate.mimeType) ?? inferMimeTypeFromUrl(url, kind))
      : inferMimeTypeFromUrl(url, kind)

    return {
      url,
      ...(type ? { type } : {}),
    }
  })
}

function rankPlaybackSources(
  kind: MediaPlaybackKind,
  sources: PlaybackSourceDescriptor[],
  evaluator?: MediaCanPlayEvaluator,
): PlaybackSourceDescriptor[] {
  return sources
    .map((source, index) => ({
      source,
      index,
      summary: getSourcePlaybackSummary(kind, source, evaluator),
    }))
    .sort((left, right) => {
      const playabilityDelta = getPlayabilityRank(right.summary.playability) - getPlayabilityRank(left.summary.playability)
      if (playabilityDelta !== 0) return playabilityDelta

      const profileDelta = getProfileRank(right.summary.profile) - getProfileRank(left.summary.profile)
      if (profileDelta !== 0) return profileDelta

      return left.index - right.index
    })
    .map((entry) => entry.source)
}

function summarizePlaybackSources(
  kind: MediaPlaybackKind,
  sources: PlaybackSourceDescriptor[],
  evaluator?: MediaCanPlayEvaluator,
): {
  sources: PlaybackSourceDescriptor[]
  profile: MediaPlaybackProfile
  playability: MediaPlayability
} {
  const rankedSources = rankPlaybackSources(kind, sources, evaluator)
  const bestSource = rankedSources[0]

  if (!bestSource) {
    return {
      sources: [],
      profile: 'unknown',
      playability: 'unsupported',
    }
  }

  const bestSummary = getSourcePlaybackSummary(kind, bestSource, evaluator)
  return {
    sources: rankedSources,
    profile: bestSummary.profile,
    playability: bestSummary.playability,
  }
}

export function buildAttachmentPlaybackPlan(
  attachment: Pick<Nip92MediaAttachment, 'url' | 'mimeType' | 'fallbacks'>,
  kind: MediaPlaybackKind,
  evaluator?: MediaCanPlayEvaluator,
): RankedPlaybackCandidate<Pick<Nip92MediaAttachment, 'url' | 'mimeType' | 'fallbacks'>> {
  const summary = summarizePlaybackSources(kind, buildPlaybackSourceList(kind, attachment), evaluator)
  return {
    candidate: attachment,
    sources: summary.sources,
    profile: summary.profile,
    playability: summary.playability,
  }
}

export function rankVideoPlaybackCandidates<T extends PlaybackCandidateLike>(
  candidates: T[],
  evaluator?: MediaCanPlayEvaluator,
): RankedPlaybackCandidate<T>[] {
  return candidates
    .map((candidate) => {
      const summary = summarizePlaybackSources('video', buildPlaybackSourceList('video', candidate), evaluator)
      return {
        candidate,
        sources: summary.sources,
        profile: summary.profile,
        playability: summary.playability,
      }
    })
    .sort((left, right) => {
      const playabilityDelta = getPlayabilityRank(right.playability) - getPlayabilityRank(left.playability)
      if (playabilityDelta !== 0) return playabilityDelta

      const profileDelta = getProfileRank(right.profile) - getProfileRank(left.profile)
      if (profileDelta !== 0) return profileDelta

      const areaDelta = getPixelArea(right.candidate.dim) - getPixelArea(left.candidate.dim)
      if (areaDelta !== 0) return areaDelta

      const bitrateDelta = (right.candidate.bitrate ?? 0) - (left.candidate.bitrate ?? 0)
      if (bitrateDelta !== 0) return bitrateDelta

      const durationDelta = (right.candidate.durationSeconds ?? 0) - (left.candidate.durationSeconds ?? 0)
      if (durationDelta !== 0) return durationDelta

      const playlistDelta = Number(isPlaylistCandidate(left.candidate)) - Number(isPlaylistCandidate(right.candidate))
      if (playlistDelta !== 0) return playlistDelta

      return left.candidate.url.localeCompare(right.candidate.url)
    })
}
