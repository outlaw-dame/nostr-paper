import { TranslationServiceError } from '@/lib/translation/errors'
import { buildAbortController, cleanBaseUrl, isRecord } from '@/lib/translation/utils'

const HEALTH_TIMEOUT_MS = 4_000
const TRANSLATE_TIMEOUT_MS = 20_000
const MAX_RESPONSE_BYTES = 512_000

interface TranslangLanguageMap {
  [code: string]: string
}

interface TranslangLanguagesPayload {
  sl?: unknown
  tl?: unknown
  source?: unknown
  target?: unknown
  languages?: unknown
}

function normalizeCode(code: string): string {
  const trimmed = code.trim()
  if (!trimmed) return 'auto'
  if (trimmed.toLowerCase() === 'auto') return 'auto'

  const [primary, ...rest] = trimmed.split('-')
  return [
    primary?.toLowerCase() ?? '',
    ...rest.map((part) => {
      if (part.length === 2) return part.toUpperCase()
      if (part.length === 4) return `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`
      return part.toLowerCase()
    }),
  ].join('-')
}

async function translangRequest(
  baseUrl: string,
  path: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const url = `${cleanBaseUrl(baseUrl)}${path}`
  const { controller, cleanup } = buildAbortController(timeoutMs, signal)

  let response: Response
  try {
    response = await globalThis.fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
      referrerPolicy: 'no-referrer',
    })
  } catch (error) {
    cleanup()
    if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      throw new TranslationServiceError(
        'TransLang did not respond in time.',
        { code: 'unavailable' },
      )
    }
    throw new TranslationServiceError(
      'TransLang is not reachable. Check the instance URL in Settings.',
      { code: 'unavailable' },
    )
  } finally {
    cleanup()
  }

  const text = await response.text()
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new TranslationServiceError('TransLang response exceeded size limit.', { code: 'parse' })
  }

  let payload: unknown
  try {
    payload = text.trim() ? JSON.parse(text) : null
  } catch {
    throw new TranslationServiceError('TransLang returned invalid JSON.', { code: 'parse' })
  }

  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : `TransLang returned HTTP ${response.status}.`
    throw new TranslationServiceError(message, {
      code: response.status >= 500 ? 'network' : 'provider',
      status: response.status,
    })
  }

  return payload
}

function parseLanguageCollection(payload: unknown): Array<{ code: string; name: string }> {
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => {
        if (!isRecord(entry)) return null

        const rawCode =
          typeof entry.code === 'string' ? entry.code
          : typeof entry.language === 'string' ? entry.language
          : null
        const rawName =
          typeof entry.name === 'string' ? entry.name
          : typeof entry.label === 'string' ? entry.label
          : null

        if (!rawCode || !rawName) return null
        return {
          code: normalizeCode(rawCode),
          name: rawName.trim(),
        }
      })
      .filter((entry): entry is { code: string; name: string } => entry !== null && Boolean(entry.code && entry.name))
  }

  if (!isRecord(payload)) return []

  return Object.entries(payload as TranslangLanguageMap)
    .map(([code, name]) => {
      if (typeof name !== 'string' || !name.trim()) return null
      return {
        code: normalizeCode(code),
        name: name.trim(),
      }
    })
    .filter((entry): entry is { code: string; name: string } => entry !== null && Boolean(entry.code && entry.name))
}

export async function listTranslangLanguages(
  baseUrl: string,
  direction: 'source' | 'target',
  signal?: AbortSignal,
): Promise<Array<{ code: string; name: string }>> {
  const payload = await translangRequest(baseUrl, '/api/v1/languages', { method: 'GET' }, HEALTH_TIMEOUT_MS, signal)
  if (!isRecord(payload)) return []

  const bucket =
    direction === 'source'
      ? (payload as TranslangLanguagesPayload).sl ?? (payload as TranslangLanguagesPayload).source ?? (payload as TranslangLanguagesPayload).languages ?? payload
      : (payload as TranslangLanguagesPayload).tl ?? (payload as TranslangLanguagesPayload).target ?? (payload as TranslangLanguagesPayload).languages ?? payload

  return parseLanguageCollection(bucket)
}

export async function translateWithTranslang(
  baseUrl: string,
  text: string,
  sourceLang: string,
  targetLang: string,
  signal?: AbortSignal,
): Promise<{ translation: string; detectedSourceLang?: string }> {
  const payload = await translangRequest(
    baseUrl,
    '/api/v1/translate',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        text,
        sl: normalizeCode(sourceLang),
        tl: normalizeCode(targetLang),
      }),
    },
    TRANSLATE_TIMEOUT_MS,
    signal,
  )

  if (!isRecord(payload) || typeof payload.translated_text !== 'string') {
    throw new TranslationServiceError('TransLang returned an invalid translation payload.', { code: 'parse' })
  }

  const detectedSourceLang =
    typeof payload.detected_language === 'string' && payload.detected_language.trim()
      ? normalizeCode(payload.detected_language)
      : undefined

  return {
    translation: payload.translated_text.trim(),
    ...(detectedSourceLang ? { detectedSourceLang } : {}),
  }
}
