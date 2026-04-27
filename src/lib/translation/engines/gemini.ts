import { detectLikelyLanguage, normalizeLanguageCode } from '@/lib/translation/detect'
import { TranslationServiceError } from '@/lib/translation/errors'
import { tTranslationUi } from '@/lib/translation/i18n'
import { withRetry } from '@/lib/retry'
import { isRecord } from '@/lib/translation/utils'

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

const GEMINI_SUPPORTED_LANGUAGES = [
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
  GEMINI_SUPPORTED_LANGUAGES.map((language) => [language.code, language.name]),
)

const GEMINI_SYSTEM_PROMPT = [
  'You are a translation engine.',
  'Translate the user text accurately into the requested target language.',
  'Return only the translated text.',
  'Do not explain, summarize, add notes, add markdown fences, or label the output.',
  'Preserve URLs, hashtags, mentions, cashtags, punctuation, line breaks, and formatting intent.',
  'Preserve proper nouns unless they have an established target-language form.',
  'If the source text is already in the target language, return the text unchanged.',
].join(' ')

function normalizeGeminiLanguage(code: string, fallback: string): string {
  const normalized = normalizeLanguageCode(code)
  if (!normalized) return fallback
  return LANGUAGE_NAME_BY_CODE.has(normalized) ? normalized : fallback
}

function getLanguageName(code: string): string {
  return LANGUAGE_NAME_BY_CODE.get(code) ?? code
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

function sanitizeGeminiTranslation(output: string): string {
  let normalized = output.trim()
  normalized = normalized.replace(/^```(?:text|markdown)?\s*/i, '')
  normalized = normalized.replace(/\s*```$/i, '')
  normalized = normalized.replace(/^translation\s*:\s*/i, '')
  normalized = stripWrappingQuotes(normalized)
  return normalized.trim()
}

function getProviderErrorMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string' && payload.error.message.trim()) {
    return payload.error.message.trim()
  }

  if (isRecord(payload) && typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message.trim()
  }

  return fallback
}

function buildTranslationPrompt(text: string, sourceLanguage: string, targetLanguage: string): string {
  return [
    `Source language: ${getLanguageName(sourceLanguage)} (${sourceLanguage})`,
    `Target language: ${getLanguageName(targetLanguage)} (${targetLanguage})`,
    '',
    'Text to translate:',
    '<text>',
    text,
    '</text>',
  ].join('\n')
}

function buildAutoTranslationPrompt(text: string, targetLanguage: string): string {
  return [
    'Source language: detect automatically from the text',
    `Target language: ${getLanguageName(targetLanguage)} (${targetLanguage})`,
    '',
    'Text to translate:',
    '<text>',
    text,
    '</text>',
  ].join('\n')
}

function extractTextFromGemini(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.candidates) || payload.candidates.length === 0) {
    throw new TranslationServiceError(tTranslationUi('geminiMalformedResponse'), { code: 'parse' })
  }

  for (const candidate of payload.candidates) {
    if (!isRecord(candidate)) continue
    if (!isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) continue

    const text = candidate.content.parts
      .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim()

    if (text) {
      return text
    }
  }

  if (isRecord(payload.promptFeedback) && typeof payload.promptFeedback.blockReason === 'string') {
    throw new TranslationServiceError(
      tTranslationUi('geminiPromptBlocked', { reason: payload.promptFeedback.blockReason }),
      { code: 'provider' },
    )
  }

  throw new TranslationServiceError(tTranslationUi('geminiReturnedEmpty'), { code: 'parse' })
}

export function listGeminiLanguages(): Array<{ code: string; name: string }> {
  return [...GEMINI_SUPPORTED_LANGUAGES]
}

export function getGeminiTransportSummary(): string {
  return tTranslationUi('geminiTransportSummary')
}

export async function translateWithGemini(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): Promise<{ translation: string; detectedSourceLang?: string }> {
  const key = apiKey.trim()
  if (!key) {
    throw new TranslationServiceError(tTranslationUi('geminiMissingApiKey'), { code: 'config' })
  }

  const normalizedTarget = normalizeGeminiLanguage(targetLanguage, 'en')
  const normalizedModel = model.trim() || DEFAULT_GEMINI_MODEL

  const detectedSource = sourceLanguage === 'auto'
    ? normalizeLanguageCode(detectLikelyLanguage(text))
    : normalizeGeminiLanguage(sourceLanguage, 'en')

  if (detectedSource && normalizedTarget === detectedSource) {
    throw new TranslationServiceError('Text already matches your target language.', {
      code: 'same-language',
    })
  }

  const prompt = detectedSource
    ? buildTranslationPrompt(text, normalizeGeminiLanguage(detectedSource, 'en'), normalizedTarget)
    : buildAutoTranslationPrompt(text, normalizedTarget)

  const url = new URL(`${GEMINI_API_BASE_URL}/models/${encodeURIComponent(normalizedModel)}:generateContent`)
  url.searchParams.set('key', key)

  const payload = await withRetry(
    async () => {
      let response: Response
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            systemInstruction: {
              role: 'system',
              parts: [{ text: GEMINI_SYSTEM_PROMPT }],
            },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
            },
          }),
          cache: 'no-store',
          credentials: 'omit',
          mode: 'cors',
          referrerPolicy: 'no-referrer',
          ...(signal ? { signal } : {}),
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        throw new TranslationServiceError(
          error instanceof Error ? error.message : tTranslationUi('geminiTranslationFailed'),
          { code: 'network' },
        )
      }

      const rawBody = await response.text()
      const parsed = rawBody.trim() ? JSON.parse(rawBody) : null

      if (!response.ok) {
        const message = getProviderErrorMessage(
          parsed,
          `Gemini API returned HTTP ${response.status}.`,
        )

        if (response.status === 429 || response.status >= 500) {
          throw new TranslationServiceError(message, { code: 'network', status: response.status })
        }

        throw new TranslationServiceError(message, { code: 'provider', status: response.status })
      }

      return parsed
    },
    {
      maxAttempts: 3,
      baseDelayMs: 750,
      maxDelayMs: 2_500,
      ...(signal ? { signal } : {}),
      shouldRetry: (error: unknown) => (
        error instanceof TranslationServiceError &&
        (error.code === 'network' || error.status === 429 || (error.status ?? 0) >= 500)
      ),
    },
  )

  const translation = sanitizeGeminiTranslation(extractTextFromGemini(payload))
  if (!translation) {
    throw new TranslationServiceError(tTranslationUi('geminiReturnedEmpty'), { code: 'parse' })
  }

  return sourceLanguage === 'auto'
    ? (detectedSource ? { translation, detectedSourceLang: detectedSource } : { translation })
    : { translation }
}
