export type SourceOrientation =
  | 'left'
  | 'lean-left'
  | 'center'
  | 'lean-right'
  | 'right'
  | 'unknown'

export interface SourceLens {
  orientation: SourceOrientation
  confidence: number
  source: 'curated'
  asOf: string
}

const SOURCE_LENSES: Record<string, SourceLens> = {
  'nytimes.com': { orientation: 'lean-left', confidence: 0.72, source: 'curated', asOf: '2026-05' },
  'washingtonpost.com': { orientation: 'lean-left', confidence: 0.7, source: 'curated', asOf: '2026-05' },
  'cnn.com': { orientation: 'lean-left', confidence: 0.74, source: 'curated', asOf: '2026-05' },
  'msnbc.com': { orientation: 'left', confidence: 0.76, source: 'curated', asOf: '2026-05' },
  'huffpost.com': { orientation: 'left', confidence: 0.74, source: 'curated', asOf: '2026-05' },
  'theguardian.com': { orientation: 'left', confidence: 0.77, source: 'curated', asOf: '2026-05' },

  'bbc.com': { orientation: 'center', confidence: 0.64, source: 'curated', asOf: '2026-05' },
  'bbc.co.uk': { orientation: 'center', confidence: 0.64, source: 'curated', asOf: '2026-05' },
  'reuters.com': { orientation: 'center', confidence: 0.78, source: 'curated', asOf: '2026-05' },
  'apnews.com': { orientation: 'center', confidence: 0.76, source: 'curated', asOf: '2026-05' },
  'wsj.com': { orientation: 'lean-right', confidence: 0.66, source: 'curated', asOf: '2026-05' },
  'economist.com': { orientation: 'center', confidence: 0.63, source: 'curated', asOf: '2026-05' },

  'foxnews.com': { orientation: 'right', confidence: 0.8, source: 'curated', asOf: '2026-05' },
  'nypost.com': { orientation: 'right', confidence: 0.78, source: 'curated', asOf: '2026-05' },
  'dailycaller.com': { orientation: 'right', confidence: 0.78, source: 'curated', asOf: '2026-05' },
  'breitbart.com': { orientation: 'right', confidence: 0.82, source: 'curated', asOf: '2026-05' },
  'theblaze.com': { orientation: 'right', confidence: 0.8, source: 'curated', asOf: '2026-05' },

  'telegraph.co.uk': { orientation: 'lean-right', confidence: 0.72, source: 'curated', asOf: '2026-05' },
  'ft.com': { orientation: 'center', confidence: 0.66, source: 'curated', asOf: '2026-05' },
  'independent.co.uk': { orientation: 'lean-left', confidence: 0.62, source: 'curated', asOf: '2026-05' },
  'dailymail.co.uk': { orientation: 'right', confidence: 0.8, source: 'curated', asOf: '2026-05' },
  'thesun.co.uk': { orientation: 'lean-right', confidence: 0.67, source: 'curated', asOf: '2026-05' },
}

const UNKNOWN_LENS: SourceLens = {
  orientation: 'unknown',
  confidence: 0,
  source: 'curated',
  asOf: '2026-05',
}

const TWO_LABEL_PUBLIC_SUFFIXES = new Set(['co.uk', 'com.au', 'co.jp'])

function trimSubdomain(hostname: string): string {
  if (!hostname) return hostname
  const host = hostname.toLowerCase()
  const parts = host.split('.').filter(Boolean)
  if (parts.length <= 2) return host
  const candidateSuffix = parts.slice(-2).join('.')
  if (TWO_LABEL_PUBLIC_SUFFIXES.has(candidateSuffix) && parts.length >= 3) {
    return parts.slice(-3).join('.')
  }
  return candidateSuffix
}

export function normalizeNewsDomain(input: string): string {
  const value = input.trim().toLowerCase()
  if (!value) return ''
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    return trimSubdomain(url.hostname)
  } catch {
    return trimSubdomain(value)
  }
}

export function resolveSourceLens(domainOrUrl: string): SourceLens {
  const normalized = normalizeNewsDomain(domainOrUrl)
  if (!normalized) return UNKNOWN_LENS
  return SOURCE_LENSES[normalized] ?? UNKNOWN_LENS
}

export function orientationLabel(orientation: SourceOrientation): string {
  switch (orientation) {
    case 'left':
      return 'Left'
    case 'lean-left':
      return 'Leans left'
    case 'center':
      return 'Center'
    case 'lean-right':
      return 'Leans right'
    case 'right':
      return 'Right'
    default:
      return 'Unknown'
  }
}
