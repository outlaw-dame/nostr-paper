import { withRetry } from '@/lib/retry'
import { resolveAppUrl } from '@/lib/runtime/baseUrl'
import { TranslationServiceError } from '@/lib/translation/errors'
import { buildAbortController, cleanBaseUrl, isRecord } from '@/lib/translation/utils'

const LANGUAGE_TIMEOUT_MS = 4_000
const TRANSLATE_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 256_000
const DEV_PROXY_ENDPOINT = '/__dev/translate/lingva'

interface LingvaLanguageMap {
  [code: string]: string
}

interface LingvaTranslateResponse {
  translation?: unknown
  info?: {
    detectedSource?: unknown
  }
  error?: unknown
}

function normalizeCode(code: string): string {
  const normalized = code.trim().toLowerCase()
  return normalized || 'auto'
}

async function lingvaRequest<T>(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  const { controller, cleanup } = buildAbortController(timeoutMs, signal)

  let requestUrl = url
  if (import.meta.env.DEV) {
    const proxyUrl = resolveAppUrl(DEV_PROXY_ENDPOINT, { preferPublicOrigin: false })
    if (!proxyUrl) {
      throw new TranslationServiceError('Lingva proxy URL is not available in this runtime.', { code: 'unavailable' })
    }
    proxyUrl.searchParams.set('url', url)
    requestUrl = proxyUrl.toString()
  }

  let response: Response
  try {
    response = await withRetry(async () => {
      const res = await globalThis.fetch(requestUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'omit',
        mode: 'cors',
        referrerPolicy: 'no-referrer',
      })

      // Retry on rate limits (429) or server errors (5xx)
      if (res.status === 429 || res.status >= 500) {
        throw new TranslationServiceError(`HTTP ${res.status}`, { code: 'network', status: res.status })
      }

      return res
    }, {
      maxAttempts: 3,
      baseDelayMs: 1000,
      shouldRetry: (err) => err instanceof TranslationServiceError && (err.code === 'network'),
      signal: controller.signal,
    })
  } catch (error) {
    cleanup()
    if (error instanceof TranslationServiceError) throw error
    if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      throw new TranslationServiceError('Lingva request timed out.', { code: 'unavailable' })
    }
    throw new TranslationServiceError(
      'Lingva is not reachable. Check the instance URL in Settings.',
      { code: 'unavailable' },
    )
  } finally {
    cleanup()
  }

  const text = await response.text()
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new TranslationServiceError('Lingva response exceeded size limit.', { code: 'parse' })
  }

  let payload: unknown
  try {
    payload = text.trim() ? JSON.parse(text) : null
  } catch {
    throw new TranslationServiceError('Lingva returned invalid JSON.', { code: 'parse' })
  }

  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : `Lingva returned HTTP ${response.status}.`
    throw new TranslationServiceError(message, {
      code: response.status >= 500 ? 'network' : 'provider',
      status: response.status,
    })
  }

  return payload as T
}

export async function listLingvaLanguages(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<Array<{ code: string; name: string }>> {
  const url = `${cleanBaseUrl(baseUrl)}/api/v1/languages`
  const payload = await lingvaRequest<LingvaLanguageMap>(url, LANGUAGE_TIMEOUT_MS, signal)

  if (!isRecord(payload)) return []

  return Object.entries(payload)
    .map(([code, name]) => {
      if (typeof name !== 'string' || !name.trim()) return null
      return {
        code: normalizeCode(code),
        name: name.trim(),
      }
    })
    .filter((entry): entry is { code: string; name: string } => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name))
}

export async function translateWithLingva(
  baseUrl: string,
  text: string,
  sourceLang: string,
  targetLang: string,
  signal?: AbortSignal,
): Promise<{ translation: string; detectedSourceLang?: string }> {
  const cleanBase = cleanBaseUrl(baseUrl)
  const url = `${cleanBase}/api/v1/${normalizeCode(sourceLang)}/${normalizeCode(targetLang)}/${encodeURIComponent(text)}`
  const payload = await lingvaRequest<LingvaTranslateResponse>(url, TRANSLATE_TIMEOUT_MS, signal)

  if (typeof payload.error === 'string' && payload.error.trim()) {
    throw new TranslationServiceError(payload.error.trim(), { code: 'provider' })
  }

  if (typeof payload.translation !== 'string' || !payload.translation.trim()) {
    throw new TranslationServiceError('Lingva returned an invalid translation payload.', { code: 'parse' })
  }

  const detectedSourceLang =
    typeof payload.info?.detectedSource === 'string' && payload.info.detectedSource.trim()
      ? normalizeCode(payload.info.detectedSource)
      : undefined

  return {
    translation: payload.translation.trim(),
    ...(detectedSourceLang ? { detectedSourceLang } : {}),
  }
}
