import { withRetry } from '@/lib/retry'
import {
  type TranslationConfiguration,
  type TranslationProvider,
  loadTranslationConfiguration,
} from '@/lib/translation/storage'
import {
  batchTranslationSegments,
  hasMeaningfulTranslationText,
  joinTranslatedSegments,
  normalizeTranslationSourceText,
  splitTextForTranslation,
} from '@/lib/translation/text'
export { TranslationServiceError } from '@/lib/translation/errors'
import { TranslationServiceError } from '@/lib/translation/errors'
import { checkSmall100Health, listSmall100Languages, translateWithSmall100 } from '@/lib/translation/engines/small100'
import { listTranslangLanguages, translateWithTranslang } from '@/lib/translation/engines/translang'
import {
  detectLikelyLanguage,
  detectScriptLanguage,
  languagesProbablyMatch,
  looksLikeShortAsciiSnippet,
  normalizeLanguageCode,
} from '@/lib/translation/detect'
import { listLingvaLanguages, translateWithLingva } from '@/lib/translation/engines/lingva'
import { isRecord } from '@/lib/translation/utils'

export interface TranslationLanguage {
  code: string
  name: string
}

export interface TranslationResult {
  provider: TranslationProvider
  translatedText: string
  targetLanguage: string
  sourceLanguage: string
  detectedSourceLanguage?: string
}

export interface TranslationPreflight {
  targetLanguage: string
  likelySourceLanguage: string | null
  sameLanguage: boolean
  canAutoTranslate: boolean
}

type LanguageDirection = 'source' | 'target'

interface DeepLTranslationItem {
  text?: unknown
  detected_source_language?: unknown
}

const DEEPL_DEV_PROXY_URL = '/__dev/translate/deepl'
const LIBRE_DEV_PROXY_URL = '/__dev/translate/libre'
const DEEPL_PROD_PROXY_URL = import.meta.env.VITE_DEEPL_PROXY_URL as string | undefined
const LIBRE_PROD_PROXY_URL = import.meta.env.VITE_LIBRETRANSLATE_PROXY_URL as string | undefined

const DEEPL_MAX_SEGMENT_CHARS = 10_000
const DEEPL_MAX_SEGMENTS_PER_REQUEST = 40
const LIBRE_MAX_SEGMENT_CHARS = 2_000
const LIBRE_MAX_SEGMENTS_PER_REQUEST = 20

const CACHE_LIMIT = 150
const translationCache = new Map<string, TranslationResult>()
const inflightTranslations = new Map<string, Promise<TranslationResult>>()
let opusMtModulePromise: Promise<typeof import('@/lib/translation/engines/opusMt')> | null = null

function getDeepLProxyUrl(): string | null {
  return import.meta.env.DEV ? DEEPL_DEV_PROXY_URL : (DEEPL_PROD_PROXY_URL ?? null)
}

function getLibreProxyUrl(): string | null {
  return import.meta.env.DEV ? LIBRE_DEV_PROXY_URL : (LIBRE_PROD_PROXY_URL ?? null)
}

async function loadOpusMtModule(): Promise<typeof import('@/lib/translation/engines/opusMt')> {
  opusMtModulePromise ??= import('@/lib/translation/engines/opusMt')
  return opusMtModulePromise
}

function evictTranslationCacheIfNeeded(): void {
  if (translationCache.size <= CACHE_LIMIT) return
  const oldestKey = translationCache.keys().next().value
  if (oldestKey !== undefined) {
    translationCache.delete(oldestKey)
  }
}

function buildCacheKey(
  configuration: TranslationConfiguration,
  text: string,
): string {
  return JSON.stringify({
    provider: configuration.provider,
    deeplPlan: configuration.deeplPlan,
    deeplTargetLanguage: configuration.deeplTargetLanguage,
    deeplSourceLanguage: configuration.deeplSourceLanguage,
    libreBaseUrl: configuration.libreBaseUrl,
    libreTargetLanguage: configuration.libreTargetLanguage,
    libreSourceLanguage: configuration.libreSourceLanguage,
    translangBaseUrl: configuration.translangBaseUrl,
    translangTargetLanguage: configuration.translangTargetLanguage,
    translangSourceLanguage: configuration.translangSourceLanguage,
    lingvaBaseUrl: configuration.lingvaBaseUrl,
    lingvaTargetLanguage: configuration.lingvaTargetLanguage,
    lingvaSourceLanguage: configuration.lingvaSourceLanguage,
    small100BaseUrl: configuration.small100BaseUrl,
    small100TargetLanguage: configuration.small100TargetLanguage,
    small100SourceLanguage: configuration.small100SourceLanguage,
    opusMtTargetLanguage: configuration.opusMtTargetLanguage,
    opusMtSourceLanguage: configuration.opusMtSourceLanguage,
    text,
  })
}

function getConfiguredTargetLanguage(configuration: TranslationConfiguration): string {
  switch (configuration.provider) {
    case 'deepl': return configuration.deeplTargetLanguage
    case 'libretranslate': return configuration.libreTargetLanguage
    case 'translang': return configuration.translangTargetLanguage
    case 'lingva': return configuration.lingvaTargetLanguage
    case 'small100': return configuration.small100TargetLanguage
    case 'opusmt': return configuration.opusMtTargetLanguage
  }
}

function getConfiguredSourceLanguage(configuration: TranslationConfiguration): string {
  switch (configuration.provider) {
    case 'deepl': return configuration.deeplSourceLanguage
    case 'libretranslate': return configuration.libreSourceLanguage
    case 'translang': return configuration.translangSourceLanguage
    case 'lingva': return configuration.lingvaSourceLanguage
    case 'small100': return configuration.small100SourceLanguage
    case 'opusmt': return configuration.opusMtSourceLanguage
  }
}

function normalizeLanguageForOpusMt(code: string, fallback: string): string {
  const normalized = code.trim().toLowerCase()
  if (!normalized) return fallback
  const [primary] = normalized.split('-')
  return primary || fallback
}

function buildOpusMtFallbackConfiguration(
  configuration: TranslationConfiguration,
): TranslationConfiguration {
  const targetFromProvider = getConfiguredTargetLanguage(configuration)
  const fallbackTarget = normalizeLanguageForOpusMt(
    configuration.opusMtTargetLanguage,
    'en',
  )

  return {
    ...configuration,
    provider: 'opusmt',
    opusMtTargetLanguage: normalizeLanguageForOpusMt(targetFromProvider, fallbackTarget),
    opusMtSourceLanguage: configuration.opusMtSourceLanguage || 'auto',
  }
}

function shouldFallbackToOpusMt(
  configuration: TranslationConfiguration,
  error: unknown,
): error is TranslationServiceError {
  if (configuration.provider === 'opusmt') return false
  if (!(error instanceof TranslationServiceError)) return false
  return error.code === 'config' || error.code === 'unavailable'
}

export function inspectTranslationWithConfiguration(
  configuration: TranslationConfiguration,
  text: string,
): TranslationPreflight {
  const normalizedText = normalizeTranslationSourceText(text)
  const targetLanguage = getConfiguredTargetLanguage(configuration)
  const meaningfulText = hasMeaningfulTranslationText(normalizedText)
  const configuredSourceLanguage = getConfiguredSourceLanguage(configuration)
  const likelySourceLanguage = configuredSourceLanguage === 'auto'
    ? detectLikelyLanguage(normalizedText)
    : configuredSourceLanguage
  const sameLanguage = !meaningfulText ||
    languagesProbablyMatch(likelySourceLanguage, targetLanguage) ||
    (
      likelySourceLanguage === null &&
      normalizeLanguageCode(targetLanguage) === 'en' &&
      looksLikeShortAsciiSnippet(normalizedText)
    )
  const canAutoTranslate = meaningfulText && !sameLanguage && !(
    configuration.provider === 'opusmt' &&
    configuredSourceLanguage === 'auto' &&
    likelySourceLanguage === null
  )

  return {
    targetLanguage,
    likelySourceLanguage,
    sameLanguage,
    canAutoTranslate,
  }
}

export async function inspectConfiguredTranslation(text: string): Promise<TranslationPreflight> {
  const configuration = await loadTranslationConfiguration()
  return inspectTranslationWithConfiguration(configuration, text)
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return null

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function getProviderErrorMessage(
  payload: unknown,
  fallback: string,
): string {
  if (typeof payload === 'string' && payload.trim()) {
    const normalized = payload.replace(/\s+/g, ' ').trim()
    return normalized.slice(0, 240)
  }
  if (isRecord(payload) && typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error.trim()
  }
  if (isRecord(payload) && typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message.trim()
  }
  return fallback
}

async function requestJson(
  input: RequestInfo | URL,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<unknown> {
  return withRetry(
    async () => {
      let response: Response
      try {
        const requestInit: RequestInit = signal ? { ...init, signal } : init
        response = await globalThis.fetch(input, requestInit)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        throw new TranslationServiceError(
          error instanceof Error ? error.message : 'Translation request failed.',
          { code: 'network' },
        )
      }

      const payload = await readResponsePayload(response)
      if (response.ok) {
        if (typeof payload === 'string') {
          throw new TranslationServiceError(
            'Translation service returned invalid JSON.',
            { code: 'parse', status: response.status },
          )
        }
        return payload
      }

      const message = getProviderErrorMessage(
        payload,
        `Translation service returned HTTP ${response.status}.`,
      )

      if (response.status === 429 || response.status >= 500) {
        throw new TranslationServiceError(message, {
          code: 'network',
          status: response.status,
        })
      }

      throw new TranslationServiceError(message, {
        code: 'provider',
        status: response.status,
      })
    },
    signal ? {
      maxAttempts: 3,
      baseDelayMs: 750,
      maxDelayMs: 2_500,
      signal,
      shouldRetry: (error) => (
        error instanceof TranslationServiceError &&
        (error.code === 'network' || error.status === 429 || (error.status ?? 0) >= 500)
      ),
    } : {
      maxAttempts: 3,
      baseDelayMs: 750,
      maxDelayMs: 2_500,
      shouldRetry: (error) => (
        error instanceof TranslationServiceError &&
        (error.code === 'network' || error.status === 429 || (error.status ?? 0) >= 500)
      ),
    },
  )
}

function assertDeepLConfigured(configuration: TranslationConfiguration): void {
  if (!configuration.deeplAuthKey) {
    throw new TranslationServiceError('Enter a DeepL API key in Settings first.', {
      code: 'config',
    })
  }

  if (!getDeepLProxyUrl()) {
    throw new TranslationServiceError(
      'DeepL requires a same-origin proxy. Configure VITE_DEEPL_PROXY_URL for production builds.',
      { code: 'unavailable' },
    )
  }
}

function assertLibreConfigured(configuration: TranslationConfiguration): void {
  if (!configuration.libreBaseUrl) {
    throw new TranslationServiceError('Enter a LibreTranslate instance URL in Settings first.', {
      code: 'config',
    })
  }
}

function assertTranslangConfigured(configuration: TranslationConfiguration): void {
  if (!configuration.translangBaseUrl) {
    throw new TranslationServiceError('Enter a TransLang instance URL in Settings first.', {
      code: 'config',
    })
  }
}

function assertLingvaConfigured(configuration: TranslationConfiguration): void {
  if (!configuration.lingvaBaseUrl) {
    throw new TranslationServiceError('Enter a Lingva instance URL in Settings first.', {
      code: 'config',
    })
  }
}

function parseDeepLLanguages(payload: unknown): TranslationLanguage[] {
  if (!Array.isArray(payload)) {
    throw new TranslationServiceError('DeepL returned an invalid languages payload.', {
      code: 'parse',
    })
  }

  return payload
    .map((entry) => {
      if (!isRecord(entry) || typeof entry.language !== 'string' || typeof entry.name !== 'string') {
        return null
      }

      return {
        code: entry.language.trim().toUpperCase(),
        name: entry.name.trim(),
      } satisfies TranslationLanguage
    })
    .filter((entry): entry is TranslationLanguage => entry !== null)
}

function parseLibreLanguages(payload: unknown): TranslationLanguage[] {
  if (!Array.isArray(payload)) {
    throw new TranslationServiceError('LibreTranslate returned an invalid languages payload.', {
      code: 'parse',
    })
  }

  return payload
    .map((entry) => {
      if (!isRecord(entry) || typeof entry.code !== 'string' || typeof entry.name !== 'string') {
        return null
      }

      return {
        code: entry.code.trim().toLowerCase(),
        name: entry.name.trim(),
      } satisfies TranslationLanguage
    })
    .filter((entry): entry is TranslationLanguage => entry !== null)
}

async function listDeepLLanguages(
  configuration: TranslationConfiguration,
  direction: LanguageDirection,
  signal?: AbortSignal,
): Promise<TranslationLanguage[]> {
  assertDeepLConfigured(configuration)
  const proxyUrl = getDeepLProxyUrl()
  if (!proxyUrl) {
    throw new TranslationServiceError('DeepL proxy unavailable.', { code: 'unavailable' })
  }

  const payload = await requestJson(
    `${proxyUrl}/languages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        authKey: configuration.deeplAuthKey,
        plan: configuration.deeplPlan,
        type: direction,
      }),
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    },
    signal,
  )

  return parseDeepLLanguages(payload)
}

async function listLibreLanguages(
  configuration: TranslationConfiguration,
  signal?: AbortSignal,
): Promise<TranslationLanguage[]> {
  assertLibreConfigured(configuration)

  const proxyUrl = getLibreProxyUrl()
  if (proxyUrl) {
    const payload = await requestJson(
      `${proxyUrl}/languages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          baseUrl: configuration.libreBaseUrl,
          apiKey: configuration.libreApiKey,
        }),
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      },
      signal,
    )

    return parseLibreLanguages(payload)
  }

  const url = new URL(`${configuration.libreBaseUrl}/languages`)
  const payload = await requestJson(
    url,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
      referrerPolicy: 'no-referrer',
    },
    signal,
  )

  return parseLibreLanguages(payload)
}

function parseDeepLTranslatePayload(
  payload: unknown,
): { translated: string[]; detectedSourceLanguage?: string } {
  if (!isRecord(payload) || !Array.isArray(payload.translations)) {
    throw new TranslationServiceError('DeepL returned an invalid translation payload.', {
      code: 'parse',
    })
  }

  const translated: string[] = []
  let detectedSourceLanguage: string | undefined

  for (const item of payload.translations as DeepLTranslationItem[]) {
    if (!isRecord(item) || typeof item.text !== 'string') {
      throw new TranslationServiceError('DeepL returned malformed translation entries.', {
        code: 'parse',
      })
    }

    translated.push(item.text)
    if (
      detectedSourceLanguage === undefined &&
      typeof item.detected_source_language === 'string' &&
      item.detected_source_language.trim()
    ) {
      detectedSourceLanguage = item.detected_source_language.trim().toUpperCase()
    }
  }

  return detectedSourceLanguage
    ? { translated, detectedSourceLanguage }
    : { translated }
}

function parseLibreTranslatePayload(
  payload: unknown,
): { translated: string[]; detectedSourceLanguage?: string } {
  if (!isRecord(payload)) {
    throw new TranslationServiceError('LibreTranslate returned an invalid translation payload.', {
      code: 'parse',
    })
  }

  const translatedRaw = payload.translatedText
  const translated = Array.isArray(translatedRaw)
    ? translatedRaw.filter((entry): entry is string => typeof entry === 'string')
    : typeof translatedRaw === 'string'
      ? [translatedRaw]
      : null

  if (!translated || translated.length === 0) {
    throw new TranslationServiceError('LibreTranslate returned no translated text.', {
      code: 'parse',
    })
  }

  let detectedSourceLanguage: string | undefined
  const detectedLanguage = payload.detectedLanguage
  if (
    isRecord(detectedLanguage) &&
    typeof detectedLanguage.language === 'string' &&
    detectedLanguage.language.trim()
  ) {
    detectedSourceLanguage = detectedLanguage.language.trim().toLowerCase()
  }

  return detectedSourceLanguage
    ? { translated, detectedSourceLanguage }
    : { translated }
}

async function translateWithDeepL(
  configuration: TranslationConfiguration,
  text: string,
  signal?: AbortSignal,
): Promise<TranslationResult> {
  assertDeepLConfigured(configuration)
  const proxyUrl = getDeepLProxyUrl()
  if (!proxyUrl) {
    throw new TranslationServiceError('DeepL proxy unavailable.', { code: 'unavailable' })
  }

  const segments = splitTextForTranslation(text, DEEPL_MAX_SEGMENT_CHARS)
  const batches = batchTranslationSegments(segments, DEEPL_MAX_SEGMENTS_PER_REQUEST)
  const translatedSegments: string[] = []
  let detectedSourceLanguage: string | undefined

  for (const batch of batches) {
    const payload = await requestJson(
      `${proxyUrl}/translate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          authKey: configuration.deeplAuthKey,
          plan: configuration.deeplPlan,
          text: batch,
          targetLang: configuration.deeplTargetLanguage,
          ...(configuration.deeplSourceLanguage !== 'auto'
            ? { sourceLang: configuration.deeplSourceLanguage }
            : {}),
        }),
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      },
      signal,
    )

    const parsed = parseDeepLTranslatePayload(payload)
    translatedSegments.push(...parsed.translated)
    if (!detectedSourceLanguage && parsed.detectedSourceLanguage) {
      detectedSourceLanguage = parsed.detectedSourceLanguage
    }
  }

  return {
    provider: 'deepl',
    translatedText: joinTranslatedSegments(translatedSegments),
    targetLanguage: configuration.deeplTargetLanguage,
    sourceLanguage: configuration.deeplSourceLanguage,
    ...(detectedSourceLanguage ? { detectedSourceLanguage } : {}),
  }
}

async function translateWithLibreTranslate(
  configuration: TranslationConfiguration,
  text: string,
  signal?: AbortSignal,
): Promise<TranslationResult> {
  assertLibreConfigured(configuration)

  const proxyUrl = getLibreProxyUrl()
  const segments = splitTextForTranslation(text, LIBRE_MAX_SEGMENT_CHARS)
  const batches = batchTranslationSegments(segments, LIBRE_MAX_SEGMENTS_PER_REQUEST)
  const translatedSegments: string[] = []
  let detectedSourceLanguage: string | undefined

  for (const batch of batches) {
    if (proxyUrl) {
      const payload = await requestJson(
        `${proxyUrl}/translate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            baseUrl: configuration.libreBaseUrl,
            apiKey: configuration.libreApiKey,
            q: batch,
            source: configuration.libreSourceLanguage,
            target: configuration.libreTargetLanguage,
            format: 'text',
          }),
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        },
        signal,
      )

      const parsed = parseLibreTranslatePayload(payload)
      translatedSegments.push(...parsed.translated)
      if (!detectedSourceLanguage && parsed.detectedSourceLanguage) {
        detectedSourceLanguage = parsed.detectedSourceLanguage
      }
      continue
    }

    const formData = new FormData()
    for (const segment of batch) {
      formData.append('q', segment)
    }
    formData.set('source', configuration.libreSourceLanguage)
    formData.set('target', configuration.libreTargetLanguage)
    formData.set('format', 'text')
    if (configuration.libreApiKey) {
      formData.set('api_key', configuration.libreApiKey)
    }

    const payload = await requestJson(
      new URL(`${configuration.libreBaseUrl}/translate`),
      {
        method: 'POST',
        body: formData,
        cache: 'no-store',
        credentials: 'omit',
        mode: 'cors',
        referrerPolicy: 'no-referrer',
      },
      signal,
    )

    const parsed = parseLibreTranslatePayload(payload)
    translatedSegments.push(...parsed.translated)
    if (!detectedSourceLanguage && parsed.detectedSourceLanguage) {
      detectedSourceLanguage = parsed.detectedSourceLanguage
    }
  }

  return {
    provider: 'libretranslate',
    translatedText: joinTranslatedSegments(translatedSegments),
    targetLanguage: configuration.libreTargetLanguage,
    sourceLanguage: configuration.libreSourceLanguage,
    ...(detectedSourceLanguage ? { detectedSourceLanguage } : {}),
  }
}

export function getDeepLTransportSummary(): string {
  return getDeepLProxyUrl()
    ? (import.meta.env.DEV
      ? 'Using the built-in localhost proxy.'
      : 'Using the configured production DeepL proxy.')
    : 'Unavailable until VITE_DEEPL_PROXY_URL is configured.'
}

export function getLibreTransportSummary(): string {
  const proxyUrl = getLibreProxyUrl()
  if (proxyUrl) {
    return import.meta.env.DEV
      ? 'Using the built-in localhost proxy.'
      : 'Using the configured production LibreTranslate proxy.'
  }

  return 'Using direct browser requests to the configured LibreTranslate instance.'
}

export async function getSmall100TransportSummary(baseUrl: string): Promise<string> {
  if (!baseUrl) return 'Configure a SMaLL-100 daemon URL in Settings.'
  const reachable = await checkSmall100Health(baseUrl)
  return reachable
    ? `Connected to SMaLL-100 daemon at ${baseUrl}.`
    : `SMaLL-100 daemon not reachable at ${baseUrl}. Start the daemon with: python server/translate.py`
}

export function getOpusMtTransportSummary(): string {
  return 'Runs entirely in your browser via WebAssembly. Models (~50–300 MB each) download once from HuggingFace and are cached locally. Auto-detects many non-Latin scripts, but language-pair coverage is limited. For broader Asian-language support, use TransLang or SMaLL-100.'
}

export function getTranslangTransportSummary(baseUrl: string): string {
  if (!baseUrl) {
    return 'Configure a TransLang instance URL in Settings.'
  }

  return 'Uses direct browser requests to the configured TransLang instance. Phanpy uses TransLang as its current translation backend; the public default proxies Google Translate, so use an instance you trust or self-host.'
}

export function getLingvaTransportSummary(baseUrl: string): string {
  if (!baseUrl) {
    return 'Configure a Lingva instance URL in Settings.'
  }
  return 'Uses direct browser requests to the configured Lingva instance. Lingva proxies Google Translate, offering excellent support for Asian languages.'
}

export function getProviderDisplayName(provider: TranslationProvider): string {
  switch (provider) {
    case 'deepl': return 'DeepL'
    case 'libretranslate': return 'LibreTranslate'
    case 'translang': return 'TransLang'
    case 'lingva': return 'Lingva'
    case 'small100': return 'SMaLL-100 (local)'
    case 'opusmt': return 'Opus-MT (in-browser)'
  }
}

export async function listProviderLanguages(
  configuration: TranslationConfiguration,
  direction: LanguageDirection,
  signal?: AbortSignal,
): Promise<TranslationLanguage[]> {
  switch (configuration.provider) {
    case 'deepl':
      return listDeepLLanguages(configuration, direction, signal)
    case 'libretranslate':
      return listLibreLanguages(configuration, signal)
    case 'translang':
      return listTranslangLanguages(configuration.translangBaseUrl, direction, signal)
    case 'lingva':
      return listLingvaLanguages(configuration.lingvaBaseUrl, signal)
    case 'small100':
      return listSmall100Languages(configuration.small100BaseUrl, signal)
    case 'opusmt': {
      const { listOpusMtLanguages } = await loadOpusMtModule()
      return listOpusMtLanguages()
    }
  }
}

async function callTranslang(
  configuration: TranslationConfiguration,
  text: string,
  signal?: AbortSignal,
): Promise<TranslationResult> {
  assertTranslangConfigured(configuration)

  const segments = splitTextForTranslation(text, 2_000)
  const translatedSegments: string[] = []
  let detectedSourceLanguage: string | undefined

  for (const batch of batchTranslationSegments(segments, 10)) {
    for (const segment of batch) {
      const result = await translateWithTranslang(
        configuration.translangBaseUrl,
        segment,
        configuration.translangSourceLanguage,
        configuration.translangTargetLanguage,
        signal,
      )
      translatedSegments.push(result.translation)
      if (!detectedSourceLanguage && result.detectedSourceLang) {
        detectedSourceLanguage = result.detectedSourceLang
      }
    }
  }

  return {
    provider: 'translang',
    translatedText: joinTranslatedSegments(translatedSegments),
    targetLanguage: configuration.translangTargetLanguage,
    sourceLanguage: configuration.translangSourceLanguage,
    ...(detectedSourceLanguage ? { detectedSourceLanguage } : {}),
  }
}

async function callLingva(
  configuration: TranslationConfiguration,
  text: string,
  signal?: AbortSignal,
): Promise<TranslationResult> {
  assertLingvaConfigured(configuration)

  // Lingva uses GET requests, so we must be careful with URL length.
  // 1000 chars per segment is safe for most servers.
  const segments = splitTextForTranslation(text, 1_000)
  const translatedSegments: string[] = []
  let detectedSourceLanguage: string | undefined

  for (const segment of segments) {
    const result = await translateWithLingva(
      configuration.lingvaBaseUrl,
      segment,
      configuration.lingvaSourceLanguage,
      configuration.lingvaTargetLanguage,
      signal,
    )
    translatedSegments.push(result.translation)
    if (!detectedSourceLanguage && result.detectedSourceLang) {
      detectedSourceLanguage = result.detectedSourceLang
    }
  }

  return {
    provider: 'lingva',
    translatedText: joinTranslatedSegments(translatedSegments),
    targetLanguage: configuration.lingvaTargetLanguage,
    sourceLanguage: configuration.lingvaSourceLanguage,
    ...(detectedSourceLanguage ? { detectedSourceLanguage } : {}),
  }
}

async function callSmall100(
  configuration: TranslationConfiguration,
  text: string,
  signal?: AbortSignal,
): Promise<TranslationResult> {
  if (!configuration.small100BaseUrl) {
    throw new TranslationServiceError(
      'Configure a SMaLL-100 daemon URL in Settings first.',
      { code: 'config' },
    )
  }

  const segments = splitTextForTranslation(text, 5_000)
  const translatedSegments: string[] = []
  let detectedSourceLanguage: string | undefined

  for (const batch of batchTranslationSegments(segments, 5)) {
    for (const segment of batch) {
      const result = await translateWithSmall100(
        configuration.small100BaseUrl,
        segment,
        configuration.small100SourceLanguage,
        configuration.small100TargetLanguage,
        signal,
      )
      translatedSegments.push(result.translation)
      if (!detectedSourceLanguage && result.detectedSourceLang) {
        detectedSourceLanguage = result.detectedSourceLang
      }
    }
  }

  return {
    provider: 'small100',
    translatedText: joinTranslatedSegments(translatedSegments),
    targetLanguage: configuration.small100TargetLanguage,
    sourceLanguage: configuration.small100SourceLanguage,
    ...(detectedSourceLanguage ? { detectedSourceLanguage } : {}),
  }
}

async function callOpusMt(
  configuration: TranslationConfiguration,
  text: string,
  signal?: AbortSignal,
): Promise<TranslationResult> {
  const { translateWithOpusMt } = await loadOpusMtModule()

  // Resolve 'auto' source language via script detection before dispatching
  // to the engine, so we can surface the detected language in the result.
  let resolvedSource = configuration.opusMtSourceLanguage
  if (resolvedSource === 'auto') {
    const detected = detectLikelyLanguage(text) ?? detectScriptLanguage(text)
    if (!detected) {
      throw new TranslationServiceError(
        'Opus-MT could not determine the source language from the text script. Set a source language in Settings or switch to SMaLL-100.',
        { code: 'config' },
      )
    }
    resolvedSource = detected
  }

  const segments = splitTextForTranslation(text, 512)
  const translatedSegments: string[] = []

  for (const batch of batchTranslationSegments(segments, 5)) {
    for (const segment of batch) {
      const result = await translateWithOpusMt(
        segment,
        resolvedSource,
        configuration.opusMtTargetLanguage,
        signal,
      )
      translatedSegments.push(result.translation)
    }
  }

  return {
    provider: 'opusmt',
    translatedText: joinTranslatedSegments(translatedSegments),
    targetLanguage: configuration.opusMtTargetLanguage,
    sourceLanguage: configuration.opusMtSourceLanguage,
    // Surface the detected language so the UI can show "Translated from ru" etc.
    ...(configuration.opusMtSourceLanguage === 'auto'
      ? { detectedSourceLanguage: resolvedSource }
      : {}),
  }
}

export async function translateTextWithConfiguration(
  configuration: TranslationConfiguration,
  text: string,
  signal?: AbortSignal,
): Promise<TranslationResult> {
  const normalizedText = normalizeTranslationSourceText(text)
  if (!normalizedText) {
    throw new TranslationServiceError('Nothing to translate.', { code: 'config' })
  }

  const preflight = inspectTranslationWithConfiguration(configuration, normalizedText)
  if (preflight.sameLanguage) {
    throw new TranslationServiceError('Text already matches your target language.', {
      code: 'same-language',
    })
  }

  const cacheKey = buildCacheKey(configuration, normalizedText)
  const cached = translationCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const existing = inflightTranslations.get(cacheKey)
  if (existing) {
    return existing
  }

  const promise = (async () => {
    let result: TranslationResult
    switch (configuration.provider) {
      case 'deepl':
        result = await translateWithDeepL(configuration, normalizedText, signal)
        break
      case 'libretranslate':
        result = await translateWithLibreTranslate(configuration, normalizedText, signal)
        break
      case 'translang':
        result = await callTranslang(configuration, normalizedText, signal)
        break
      case 'lingva':
        result = await callLingva(configuration, normalizedText, signal)
        break
      case 'small100':
        result = await callSmall100(configuration, normalizedText, signal)
        break
      case 'opusmt':
        result = await callOpusMt(configuration, normalizedText, signal)
        break
    }

    evictTranslationCacheIfNeeded()
    translationCache.set(cacheKey, result)
    return result
  })().finally(() => {
    inflightTranslations.delete(cacheKey)
  })

  inflightTranslations.set(cacheKey, promise)
  return promise
}

export async function translateConfiguredText(
  text: string,
  signal?: AbortSignal,
): Promise<TranslationResult> {
  const configuration = await loadTranslationConfiguration()
  try {
    return await translateTextWithConfiguration(configuration, text, signal)
  } catch (error) {
    if (!shouldFallbackToOpusMt(configuration, error)) {
      throw error
    }

    const fallbackConfiguration = buildOpusMtFallbackConfiguration(configuration)
    try {
      return await translateTextWithConfiguration(fallbackConfiguration, text, signal)
    } catch {
      throw error
    }
  }
}
