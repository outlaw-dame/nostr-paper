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
