import { generateText, isGemmaAvailable } from '@/lib/gemma/client'
import { detectLikelyLanguage, normalizeLanguageCode } from '@/lib/translation/detect'
import { TranslationServiceError } from '@/lib/translation/errors'
import { tTranslationUi } from '@/lib/translation/i18n'
import { withRetry } from '@/lib/retry'

const GEMMA_SUPPORTED_LANGUAGES = [
  { code: 'ar', name: 'Arabic' },
  { code: 'bn', name: 'Bengali' },
  { code: 'cs', name: 'Czech' },
  { code: 'de', name: 'German' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fi', name: 'Finnish' },
  { code: 'fr', name: 'French' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'id', name: 'Indonesian' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'km', name: 'Khmer' },
  { code: 'ko', name: 'Korean' },
  { code: 'lo', name: 'Lao' },
  { code: 'my', name: 'Burmese' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'sv', name: 'Swedish' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'th', name: 'Thai' },
  { code: 'tr', name: 'Turkish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'zh', name: 'Chinese' },
] as const

const LANGUAGE_NAME_BY_CODE = new Map<string, string>(
  GEMMA_SUPPORTED_LANGUAGES.map((language) => [language.code, language.name]),
)

const GEMMA_SYSTEM_PROMPT = [
  'You are a translation engine.',
  'Translate the user text accurately into the requested target language.',
  'Return only the translated text.',
  'Do not explain, summarize, add notes, add markdown fences, or label the output.',
  'Preserve URLs, hashtags, mentions, cashtags, punctuation, line breaks, and formatting intent.',
  'Preserve proper nouns unless they have an established target-language form.',
  'If the source text is already in the target language, return the text unchanged.',
].join(' ')

function getLanguageName(code: string): string {
  return LANGUAGE_NAME_BY_CODE.get(code) ?? code
}

function normalizeGemmaLanguage(code: string, fallback: string): string {
  const normalized = normalizeLanguageCode(code)
  if (!normalized) return fallback
  return LANGUAGE_NAME_BY_CODE.has(normalized) ? normalized : fallback
}

function stripWrappingQuotes(text: string): string {
  if (text.length < 2) return text
  const first = text[0]
  const last = text[text.length - 1]
  const matchingQuotes = (
    (first === '"' && last === '"') ||
    (first === '\'' && last === '\'') ||
    (first === '“' && last === '”') ||
    (first === '‘' && last === '’')
  )
  return matchingQuotes ? text.slice(1, -1).trim() : text
}

function sanitizeGemmaTranslation(output: string): string {
  let normalized = output.trim()
  normalized = normalized.replace(/^```(?:text|markdown)?\s*/i, '')
  normalized = normalized.replace(/\s*```$/i, '')
  normalized = normalized.replace(/^translation\s*:\s*/i, '')
  normalized = stripWrappingQuotes(normalized)
  return normalized.trim()
}

function shouldRetryGemmaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('timed out') ||
    message.includes('worker crashed') ||
    message.includes('unreadable message') ||
    message.includes('device lost')
  )
}

function buildPrompt(text: string, sourceLanguage: string, targetLanguage: string): string {
  return [
    GEMMA_SYSTEM_PROMPT,
    '',
    `Source language: ${getLanguageName(sourceLanguage)} (${sourceLanguage})`,
    `Target language: ${getLanguageName(targetLanguage)} (${targetLanguage})`,
    '',
    'Text to translate:',
    '<text>',
    text,
    '</text>',
  ].join('\n')
}

function buildAutoPrompt(text: string, targetLanguage: string): string {
  return [
    GEMMA_SYSTEM_PROMPT,
    '',
    'Source language: detect automatically from the text',
    `Target language: ${getLanguageName(targetLanguage)} (${targetLanguage})`,
    '',
    'Text to translate:',
    '<text>',
    text,
    '</text>',
  ].join('\n')
}

export function listGemmaLanguages(): Array<{ code: string; name: string }> {
  return [...GEMMA_SUPPORTED_LANGUAGES]
}

export function getGemmaTransportSummary(): string {
  if (!isGemmaAvailable()) {
    return tTranslationUi('gemmaUnavailableSummary')
  }

  return tTranslationUi('gemmaTransportSummary')
}

export async function translateWithGemma(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  signal?: AbortSignal,
): Promise<{ translation: string; detectedSourceLang?: string }> {
  if (!isGemmaAvailable()) {
    throw new TranslationServiceError(
      tTranslationUi('gemmaUnavailableError'),
      { code: 'unavailable' },
    )
  }

  const normalizedTarget = normalizeGemmaLanguage(targetLanguage, 'en')
  const detectedSource = sourceLanguage === 'auto'
    ? normalizeLanguageCode(detectLikelyLanguage(text))
    : normalizeGemmaLanguage(sourceLanguage, 'en')

  if (detectedSource && normalizedTarget === detectedSource) {
    throw new TranslationServiceError('Text already matches your target language.', {
      code: 'same-language',
    })
  }

  const prompt = detectedSource
    ? buildPrompt(text, normalizeGemmaLanguage(detectedSource, 'en'), normalizedTarget)
    : buildAutoPrompt(text, normalizedTarget)

  const retryOptions = {
    maxAttempts: 2,
    baseDelayMs: 300,
    maxDelayMs: 1_500,
    shouldRetry: (error: unknown) => shouldRetryGemmaError(error),
    ...(signal ? { signal } : {}),
  }

  const response = await withRetry(
    async () => generateText(prompt, signal ? { signal } : {}),
    retryOptions,
  ).catch((error) => {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new TranslationServiceError(
      error instanceof Error ? error.message : tTranslationUi('gemmaTranslationFailed'),
      { code: 'provider' },
    )
  })

  const translation = sanitizeGemmaTranslation(response)
  if (!translation) {
    throw new TranslationServiceError(tTranslationUi('gemmaReturnedEmpty'), { code: 'parse' })
  }

  return sourceLanguage === 'auto'
    ? (detectedSource ? { translation, detectedSourceLang: detectedSource } : { translation })
    : { translation }
}
