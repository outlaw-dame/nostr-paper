/**
 * Script-based language detection.
 *
 * Uses Unicode block ranges to identify scripts that are unambiguously
 * non-Latin. Returns a BCP-47 language code or null when the text is
 * Latin-script or the script is unrecognised.
 *
 * Deliberately lightweight — no external dependencies, works in any
 * environment. Accurate enough for the non-Latin scripts that OpusMT
 * supports; Latin-script languages (Spanish, French, German, …) still
 * require a properly configured provider with a language-detection API.
 */

interface ScriptEntry {
  re:   RegExp
  lang: string
}

const ENGLISH_STOPWORDS = new Set([
  'a', 'about', 'all', 'am', 'an', 'and', 'are', 'as', 'at', 'be',
  'been', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'for',
  'from', 'had', 'has', 'have', 'he', 'her', 'him', 'his', 'how',
  'i', 'if', 'in', 'is', 'it', 'its', 'just', 'me', 'more', 'my',
  'new', 'no', 'not', 'of', 'on', 'or', 'our', 'she', 'so', 'than',
  'that', 'the', 'their', 'them', 'there', 'these', 'they', 'this',
  'those', 'to', 'up', 'us', 'was', 'we', 'were', 'what', 'when',
  'where', 'who', 'why', 'will', 'with', 'would', 'you', 'your',
])

// Order matters: Japanese (hiragana/katakana) must come before CJK so a
// Japanese post is not misclassified as Chinese.
const SCRIPT_LANGS: ScriptEntry[] = [
  { re: /[\u3040-\u309F\u30A0-\u30FF]/g, lang: 'ja' },  // Hiragana / Katakana → Japanese
  { re: /[\uAC00-\uD7A3\u1100-\u11FF]/g, lang: 'ko' },  // Hangul → Korean
  { re: /[\u4E00-\u9FFF\u3400-\u4DBF]/g, lang: 'zh' },  // CJK Unified Ideographs → Chinese
  { re: /[\u0E00-\u0E7F]/g,              lang: 'th' },  // Thai
  { re: /[\u0900-\u097F]/g,              lang: 'hi' },  // Devanagari → Hindi default
  { re: /[\u0980-\u09FF]/g,              lang: 'bn' },  // Bengali
  { re: /[\u0B80-\u0BFF]/g,              lang: 'ta' },  // Tamil
  { re: /[\u0C00-\u0C7F]/g,              lang: 'te' },  // Telugu
  { re: /[\u0A80-\u0AFF]/g,              lang: 'gu' },  // Gujarati
  { re: /[\u0A00-\u0A7F]/g,              lang: 'pa' },  // Gurmukhi / Punjabi
  { re: /[\u1000-\u109F]/g,              lang: 'my' },  // Myanmar / Burmese
  { re: /[\u1780-\u17FF]/g,              lang: 'km' },  // Khmer
  { re: /[\u0E80-\u0EFF]/g,              lang: 'lo' },  // Lao
  { re: /[\u0400-\u04FF]/g,              lang: 'ru' },  // Cyrillic → Russian (most common)
  { re: /[\u0600-\u06FF\u0750-\u077F]/g, lang: 'ar' },  // Arabic
  { re: /[\u0590-\u05FF]/g,              lang: 'he' },  // Hebrew — not in OpusMT pair list, silently falls through
]

/**
 * Threshold: at least this fraction of non-whitespace characters must
 * belong to the detected script to avoid false positives from stray
 * foreign characters in otherwise Latin-script text.
 */
const DENSITY_THRESHOLD = 0.08

/**
 * Detect the probable language of a text based on Unicode script ranges.
 *
 * Returns a BCP-47 language code when the text contains a sufficient
 * density of characters from a recognisable non-Latin script, or null
 * when the script is Latin / ambiguous.
 */
export function detectScriptLanguage(text: string): string | null {
  const sample    = text.slice(0, 400)
  const nonSpace  = sample.replace(/\s+/g, '')
  if (nonSpace.length < 5) return null

  for (const { re, lang } of SCRIPT_LANGS) {
    re.lastIndex = 0
    const hits = nonSpace.match(re)
    if ((hits?.length ?? 0) / nonSpace.length >= DENSITY_THRESHOLD) {
      return lang
    }
  }

  return null
}

export function normalizeLanguageCode(code: string | null | undefined): string | null {
  if (typeof code !== 'string') return null
  const trimmed = code.trim()
  if (!trimmed) return null

  const [primary] = trimmed.split('-')
  if (!primary) return null
  return primary.toLowerCase()
}

export function getBrowserLanguage(): string | null {
  if (typeof globalThis.navigator === 'undefined') return null

  const candidates = Array.isArray(globalThis.navigator.languages)
    ? globalThis.navigator.languages
    : []

  for (const candidate of [...candidates, globalThis.navigator.language]) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return null
}

function detectLikelyEnglish(text: string): boolean {
  const sample = text
    .slice(0, 400)
    .toLowerCase()
    .replace(/[^a-z\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!sample) return false

  const words = sample
    .split(' ')
    .map((word) => word.replace(/^'+|'+$/g, ''))
    .filter(Boolean)

  if (words.length < 5) return false

  const stopwordHits = words.reduce((count, word) => (
    ENGLISH_STOPWORDS.has(word) ? count + 1 : count
  ), 0)
  const asciiLetters = sample.replace(/[^a-z]/g, '').length
  const asciiDensity = asciiLetters / Math.max(1, sample.replace(/\s+/g, '').length)

  return asciiDensity >= 0.85 && (
    stopwordHits >= 3 ||
    stopwordHits / words.length >= 0.18
  )
}

export function detectLikelyLanguage(text: string): string | null {
  const scriptLanguage = detectScriptLanguage(text)
  if (scriptLanguage) return scriptLanguage
  if (detectLikelyEnglish(text)) return 'en'
  return null
}

export function looksLikeShortAsciiSnippet(text: string): boolean {
  const sample = text
    .slice(0, 120)
    .trim()

  if (!sample) return false
  if (/[^\x00-\x7F]/.test(sample)) return false

  const words = sample
    .toLowerCase()
    .replace(/[^a-z0-9\s'’-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

  if (words.length === 0 || words.length > 12) return false

  const letterCount = words.join('').replace(/[^a-z]/g, '').length
  return letterCount >= 2 && letterCount <= 32
}

export function languagesProbablyMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const normalizedLeft = normalizeLanguageCode(left)
  const normalizedRight = normalizeLanguageCode(right)
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight)
}
